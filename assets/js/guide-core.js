/* Guide kit — subject-neutral canvas/DOM helpers for NEW interactive guide pages.
 * Promoted from assets/js/llm-guide.js (which is untouched — the existing LLM-training
 * pages keep using window.LLMG; new pages should use window.Guide instead).
 * Load before any page-specific <script>. */
(function (global) {
  "use strict";

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // ---------------------------------------------------------------------------
  // THEME LAYER
  // ---------------------------------------------------------------------------
  // Every canvas colour on this site comes from here. The rule the whole layer
  // exists to keep is the one the old code broke in three ways at once:
  //
  //   1. Colour is read at DRAW time, never cached into module state. A draw
  //      routine calls colors() once per repaint and the repaint is re-run on a
  //      theme change, so a canvas cannot end up holding a light-mode palette
  //      after the reader has flipped to dark.
  //   2. No literal colour survives. The hexes that are left are *fallbacks*,
  //      used only on a page where theme.css never loaded; each one is the
  //      light-mode value of the token it stands in for, so a page with no
  //      stylesheet looks like the new theme rather than the old one.
  //   3. No literal font size survives either. The four --chart-*-size tokens
  //      are the reader's text-size preference reaching canvas text, which is
  //      otherwise the one thing on the page a preference cannot touch.
  //
  // The fallbacks are the *light* scheme's values. That is deliberate: a
  // missing stylesheet is not a dark page, and guessing dark would be a lie
  // about which theme is active.

  // The categorical series slots, in the order theme.css declares them. Index 0
  // is the series a reader is meant to be looking at; the order is a convention,
  // not a scale, which is why these tokens deliberately do NOT flip in dark — a
  // series that changed colour when the theme changed would be a different series.
  var SERIES_VARS = ['--chart-series-1', '--chart-series-2', '--chart-series-3', '--chart-series-4',
    '--chart-series-5', '--chart-series-6', '--chart-series-7'];
  var SERIES_FALLBACK = ['#0369a1', '#0d9488', '#b45309', '#7c3aed', '#c91340', '#4d7c0f', '#0e7490'];

  // The chart type sizes, as the numbers they resolve to when nothing is asked
  // of them. Kept here so fontAt() can stand in for a hand-built colour object a
  // page passed in (see `opts.colors` throughout this kit).
  var SIZE_FALLBACK = { tick: 11, axisLabel: 11, legend: 12, tooltip: 12 };

  var hasDocument = function () { return typeof document !== 'undefined' && !!document.documentElement; };

  // Split a comma-separated list, ignoring commas nested in parentheses — enough
  // for the math functions the size tokens use, and nothing more.
  function splitTop(str) {
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out;
  }

  // The root font size, which is where the reader's text-size preference lands
  // (theme.css: `font-size: calc(16px * var(--pref-text-scale, 1))`). Everything
  // in rem is converted through it, so a chart's tick label grows with the page.
  function rootPx() {
    if (!hasDocument()) return 16;
    var fs = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return isFinite(fs) && fs > 0 ? fs : 16;
  }

  // Evaluate a CSS length to a number of px. Handles px/rem/em/pt, a bare
  // number, and the max()/min()/clamp() the --chart-*-size tokens are written
  // with — a canvas `ctx.font` string cannot carry `max()`, so the arithmetic has
  // to happen here. Returns null for anything it does not understand, which is
  // the caller's cue to use its own fallback rather than draw a 0px font.
  function evalSize(raw, rp) {
    if (!raw) return null;
    raw = String(raw).trim();
    var fn = /^(max|min|clamp)\s*\(([\s\S]*)\)$/i.exec(raw);
    if (fn) {
      var parts = splitTop(fn[2]);
      if (!parts.length) return null;
      var vals = [], i, v;
      if (/^clamp$/i.test(fn[1]) && parts.length >= 3) {
        v = evalSize(parts[1], rp);
        var lo = evalSize(parts[0], rp), hi = evalSize(parts[2], rp);
        if (v == null) return null;
        if (lo != null) v = Math.max(lo, v);
        if (hi != null) v = Math.min(hi, v);
        return v;
      }
      for (i = 0; i < parts.length; i++) { v = evalSize(parts[i], rp); if (v != null) vals.push(v); }
      if (!vals.length) return null;
      return /^min$/i.test(fn[1]) ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
    }
    var u = /^(-?[\d.]+)(px|rem|em|pt)?$/.exec(raw);
    if (!u) return null;
    var num = parseFloat(u[1]);
    if (!isFinite(num)) return null;
    var unit = u[2] || 'px';
    if (unit === 'rem' || unit === 'em') num *= rp;
    else if (unit === 'pt') num *= 4 / 3;
    return num;
  }

  // A --chart-*-size token, in px. This is the ONLY place a chart font size is
  // allowed to come from, so a reader who turns text size up gets a bigger tick
  // label rather than a chart that is suddenly the only thing on the page still
  // set at its old size.
  function sizePx(name, which) {
    var v = hasDocument() ? evalSize(css(name), rootPx()) : null;
    if (v == null || !(v > 0)) v = SIZE_FALLBACK[which];
    return v;
  }

  // A ready-made CSS font shorthand at the token's size, in the site family.
  // `px` overrides the token when a caller passes one explicitly (every
  // `opts.fontSize` in this kit), and `c` may be a page-built colour object, so
  // every field falls back rather than throwing on a partial one.
  function fontAt(c, px, which) {
    c = c || {};
    var family = c.font || 'sans-serif';
    var n = px != null ? px : (c[which] != null ? c[which] : SIZE_FALLBACK[which || 'tick']);
    return n + 'px ' + family;
  }

  // Compose an alpha from a `-ch` channel token: theme.css stores colour as
  // space-separated RGB channels precisely so a consumer can write its own
  // alpha (`rgb(var(--c-accent-ch) / 0.12)`). Canvas gets the same thing as a
  // string, and a wash of the accent is then a wash of *this* accent in this
  // theme rather than a frozen rgba() from the palette it used to be.
  function alpha(c, key, a) {
    c = c || {};
    // Accepts either the base name ('accent') or the channel field ('accentCh'),
    // because both read naturally at a call site and only one can be right. The
    // channel form is preferred; the resolved colour is the fallback, for a
    // hand-built colour object that never carried channels.
    var isCh = /Ch$/.test(key);
    var ch = c[isCh ? key : key + 'Ch'];
    if (ch && typeof ch === 'string') return 'rgb(' + ch + ' / ' + a + ')';
    var v = toRgb(c[isCh ? key.slice(0, -2) : key]);
    if (v) return 'rgba(' + Math.round(v[0]) + ',' + Math.round(v[1]) + ',' + Math.round(v[2]) + ',' + a + ')';
    return 'rgba(0,0,0,' + a + ')';
  }

  // The whole resolved palette for one repaint. Every field is read fresh, so
  // the object a draw routine holds is true for exactly as long as that repaint
  // lasts and no longer.
  function themeColors() {
    if (colorCache) return colorCache;
    var family = css('--font-body') || 'sans-serif';
    var mono = css('--font-mono') || 'monospace';
    var tick = sizePx('--chart-tick-size', 'tick');
    var axisLabel = sizePx('--chart-axis-label-size', 'axisLabel');
    var legend = sizePx('--chart-legend-size', 'legend');
    var tooltip = sizePx('--chart-tooltip-size', 'tooltip');
    var series = SERIES_VARS.map(function (v, i) { return css(v) || SERIES_FALLBACK[i]; });
    var c = {
      // The nine fields this kit has always returned. Unchanged names, because
      // ~260 pages and every other module in assets/js read exactly these.
      accent: css('--color-accent') || '#0069d6',
      accent2: css('--color-accent-2') || '#0d9488',
      accent400: css('--color-accent-400') || '#2a89e0',
      accent500: css('--color-accent-500') || '#0069d6',
      accent700: css('--color-accent-700') || '#004aa8',
      text: css('--color-text') || '#0c1118',
      divider: css('--color-divider') || '#d9dee6',
      font: family,
      mono: mono,
      // Surfaces and the plot. `--plot-bg` is the canvas colour, so a plot is a
      // well in both themes (theme.css section 9).
      bg: css('--color-bg') || '#f2f5fa',
      surface: css('--color-surface') || '#ffffff',
      surface2: css('--color-surface-2') || '#edf0f4',
      border: css('--color-border') || '#d9dee6',
      borderStrong: css('--color-border-strong') || '#b9c1cd',
      grid: css('--c-grid') || css('--color-divider') || '#e3e7ed',
      muted: css('--color-text-muted') || '#3f4854',
      subtle: css('--color-text-subtle') || '#636c7a',
      // Status semantics, which are deliberately NOT series colours.
      ok: css('--color-ok') || '#15803d',
      warn: css('--color-warn') || '#b45309',
      bad: css('--color-bad') || '#be123c',
      onAccent: css('--c-accent-fg') || '#ffffff',
      // The accent at 100 — the pale wash a sequential ramp starts from, and the
      // only value in the palette that is a *tint* rather than a step.
      tint: css('--color-accent-tint') || '#e2f0fd',
      // The seven categorical slots.
      series: series,
      // The reader's text-size preference, resolved to px.
      tick: tick, axisLabel: axisLabel, legend: legend, tooltip: tooltip,
      tickFont: tick + 'px ' + family,
      axisFont: axisLabel + 'px ' + family,
      legendFont: legend + 'px ' + family,
      titleFont: '600 ' + legend + 'px ' + family,
      // The `-ch` channel strings, for alpha(). `--color-*-ch` are the site's
      // own aliases over the palette's channel layer.
      accentCh: css('--color-accent-ch'),
      accent2Ch: css('--color-accent-2-ch'),
      textCh: css('--color-text-ch'),
      bgCh: css('--color-bg-ch'),
      surfaceCh: css('--color-surface-ch'),
      dividerCh: css('--color-divider-ch')
    };
    colorCache = c;
    return c;
  }

  // `colors()` is the historical name and stays, with the same nine fields, so
  // nothing that already calls it changes. It now also carries the rest of the
  // palette, which is why every module can move to it instead of keeping a
  // second copy of the same getComputedStyle block.
  function colors() { return themeColors(); }

  // The palette is memoised for the length of one repaint batch and dropped at
  // the start of the next one, and again the instant a theme or preferences
  // event lands. A repaint is a batch of draw routines reading the same object,
  // which is what "resolved once per repaint" means; the invalidation points are
  // the only two places a stale palette could survive, and neither can.
  var colorCache = null;
  function invalidateColors() { colorCache = null; }

  // ---------------------------------------------------------------------------
  // Repaint scheduling
  // ---------------------------------------------------------------------------
  // A theme change has to reach every canvas on the page, and a page can carry a
  // lot of them. Doing that naively — one listener per canvas, one redraw each,
  // scheduled the instant the event fires — is how a preference toggle ends up
  // costing two hundred animation frames. So:
  //
  //   * ONE requestAnimationFrame, not one per canvas. Every event that lands
  //     in the same tick coalesces into a single frame.
  //   * ONE pass over the registry in that frame, with each repaint isolated so
  //     one page's throw cannot take the other 199 with it.
  //   * IntersectionObserver gates the work. A canvas scrolled out of view has a
  //     0x0 backing store; repainting it is pure waste. A skipped canvas is
  //     marked dirty instead, and the observer pays the debt the moment the
  //     canvas comes back on screen — which is before paint, because
  //     IntersectionObserver records are delivered earlier in the frame than
  //     rAF callbacks, so a canvas scrolling in never flashes its old colours.
  //   * The gate is optimistic. A canvas is assumed visible until the observer
  //     says otherwise, so the one failure mode is a redundant repaint rather
  //     than a canvas left in the previous theme.

  var jobs = [];          // {run, target, visible, queued, dirty}
  var pending = null;     // jobs queued for the current frame
  var frameId = null;
  var observer = null;    // null = not built yet, false = unavailable
  var watching = false;
  var lastMode = null;    // last resolved theme, so the OS listener can no-op

  function raf(fn) {
    if (typeof window.requestAnimationFrame === 'function') return window.requestAnimationFrame(fn);
    return window.setTimeout(fn, 16);
  }

  function getObserver() {
    if (observer !== null) return observer;
    // Read off `window` rather than as a bare global, for the same reason the
    // DPR and ResizeObserver reads in setupCanvas are: this file is handed a
    // `window` and everything it touches should come from that one object.
    if (typeof window.IntersectionObserver === 'undefined') { observer = false; return observer; }
    observer = new window.IntersectionObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i], j = r.target.__icRepaint;
        if (!j) continue;
        j.visible = !!r.isIntersecting && r.intersectionRatio > 0;
        if (j.visible && j.dirty) { j.dirty = false; queue(j); }
      }
    });
    return observer;
  }

  function observe(j) {
    var io = getObserver();
    if (!io || !j.target) return;
    io.observe(j.target);
  }

  function queue(j) {
    if (j.queued) return;
    if (!j.visible) { j.dirty = true; return; }   // IntersectionObserver pays it back later
    j.queued = true;
    (pending || (pending = [])).push(j);
    if (frameId == null) frameId = raf(flush);
  }

  function flush() {
    frameId = null;
    invalidateColors();
    var list = pending || [];
    pending = null;
    for (var i = 0; i < list.length; i++) {
      var j = list[i];
      j.queued = false;
      if (!j.visible) { j.dirty = true; continue; }
      try { j.run(); }
      catch (err) { if (window.console && console.error) console.error('[guide] repaint failed', err); }
    }
    if (pending && pending.length && frameId == null) frameId = raf(flush);
  }

  // Repaint every registered canvas. This is the single entry point every
  // signal below funnels into, so there is exactly one place that decides what
  // a theme change costs.
  function repaintAll() {
    for (var i = 0; i < jobs.length; i++) queue(jobs[i]);
  }

  // The theme currently in force, in the order the sources are trusted:
  // `data-theme` on <html> is the source of truth and always holds a resolved
  // value; ICTheme is consulted next for a page whose boot script has not run;
  // the media query is the no-JavaScript-preference fallback.
  function resolvedMode() {
    if (!hasDocument()) return 'light';
    var attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
    var T = window.ICTheme;
    if (T && typeof T.get === 'function') {
      try {
        var p = T.get() || {};
        if (p.resolved === 'dark' || p.resolved === 'light') return p.resolved;
        if (p.theme === 'dark' || p.theme === 'light') return p.theme;
      } catch (e) { /* fall through to the media query */ }
    }
    if (typeof window.matchMedia === 'function') {
      try { if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'; } catch (e) { /* ignore */ }
    }
    return 'light';
  }

  // The two events the preferences module dispatches. Both are handled the
  // same way and neither is filtered: `ic:prefs` carries the text-size and
  // density preferences, and a chart that ignored them would be a chart the
  // reader's settings do not reach.
  function onThemeSignal() {
    lastMode = resolvedMode();
    invalidateColors();
    repaintAll();
  }

  // The system case, for a reader with no stored preference. The guard is the
  // point: the OS flipping to dark must not repaint a page whose reader chose
  // light, because nothing about that page changed — and it must not
  // double-fire with `ic:theme`, which the same flip also dispatches. Comparing
  // the resolved mode is what makes both true at once, and because the events
  // coalesce into one frame even when both do arrive, the redundant half costs
  // nothing.
  function onSystemTheme() {
    var mode = resolvedMode();
    if (mode === lastMode) return;
    lastMode = mode;
    invalidateColors();
    repaintAll();
  }

  // Registered unconditionally at load, not on first canvas: the point is that a
  // page which grows a canvas later still has a live listener. On a page with no
  // canvas the registry is empty and repaintAll() iterates nothing.
  function watch() {
    if (watching || !hasDocument()) return;
    watching = true;
    lastMode = resolvedMode();
    document.addEventListener('ic:theme', onThemeSignal, false);
    document.addEventListener('ic:prefs', onThemeSignal, false);
    if (typeof window.matchMedia === 'function') {
      var mq = null;
      try { mq = window.matchMedia('(prefers-color-scheme: dark)'); } catch (e) { mq = null; }
      if (mq) {
        // addListener is Safari 13 and older; addEventListener is everything else.
        if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onSystemTheme);
        else if (typeof mq.addListener === 'function') mq.addListener(onSystemTheme);
      }
    }
  }
  watch();

  // Register a canvas to be repainted on a theme or preferences change.
  // `repaint` is called with no arguments and should redraw from current state.
  // Returns an unregister function.
  function registerCanvas(canvas, repaint) {
    if (!canvas || typeof repaint !== 'function') return function () {};
    var existing = canvas.__icRepaint;
    if (existing) { existing.run = repaint; return function () { unregisterCanvas(canvas); }; }
    var j = { run: repaint, target: canvas, visible: true, queued: false, dirty: false };
    canvas.__icRepaint = j;
    jobs.push(j);
    observe(j);
    watch();
    return function () { unregisterCanvas(canvas); };
  }

  function unregisterCanvas(canvas) {
    var j = canvas && canvas.__icRepaint;
    if (!j) return;
    var io = getObserver();
    if (io && j.target) io.unobserve(j.target);
    var i = jobs.indexOf(j);
    if (i >= 0) jobs.splice(i, 1);
    delete canvas.__icRepaint;
  }

  // Subscribe to a theme or preferences change without a canvas — a Plotly
  // scene, a DOM legend, a table of swatches. Shares the same single frame, so
  // adding one of these does not add a frame.
  function onTheme(fn) {
    if (typeof fn !== 'function') return function () {};
    var j = { run: fn, target: null, visible: true, queued: false, dirty: false };
    jobs.push(j);
    watch();
    return function () {
      var i = jobs.indexOf(j);
      if (i >= 0) jobs.splice(i, 1);
    };
  }

  // DPR-aware canvas: sets backing resolution to CSS-size * devicePixelRatio,
  // scales the context so drawing code keeps using the "logical" width/height
  // passed in, and re-runs `onResize(logicalW, logicalH)` when the element resizes.
  function setupCanvas(canvas, logicalW, logicalH, onResize) {
    var ctx = canvas.getContext('2d');
    function resize() {
      var rect = canvas.getBoundingClientRect();
      var cssW = rect.width || logicalW;
      var cssH = cssW * (logicalH / logicalW);
      var dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.height = cssH + 'px';
      ctx.setTransform(dpr * (cssW / logicalW), 0, 0, dpr * (cssW / logicalW), 0, 0);
      if (onResize) onResize(logicalW, logicalH);
    }
    var ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(canvas); else window.addEventListener('resize', resize);
    resize();
    // Remember the logical coordinate system so hitTest() can map pointer events
    // back into it (setupCanvas applies a DPR + CSS-scale transform, so raw
    // offsetX is in backing-store pixels, not logical units).
    canvas.__gLogW = logicalW;
    canvas.__gLogH = logicalH;
    // A theme change repaints through THIS path rather than a second one, so the
    // switch re-reads the CSS box and the device pixel ratio as well as the
    // colour — and there is still exactly one resize path in the file. `resize`
    // clears the backing store by construction (setting width/height does), so
    // the repaint cannot inherit a frame drawn in the previous theme.
    registerCanvas(canvas, resize);
    return { ctx: ctx, resize: resize };
  }

  // Map a pointer/mouse event to logical canvas coordinates. `canvas` must be one
  // passed through setupCanvas (which records __gLogW/__gLogH).
  function hitTest(canvas, ev) {
    var rect = canvas.getBoundingClientRect();
    var logW = canvas.__gLogW || rect.width || 1;
    var logH = canvas.__gLogH || rect.height || 1;
    var clientX = ev.clientX != null ? ev.clientX : (ev.touches && ev.touches[0] ? ev.touches[0].clientX : 0);
    var clientY = ev.clientY != null ? ev.clientY : (ev.touches && ev.touches[0] ? ev.touches[0].clientY : 0);
    return {
      x: (clientX - rect.left) * (logW / (rect.width || logW)),
      y: (clientY - rect.top) * (logH / (rect.height || logH))
    };
  }

  // Numerically-stable softmax (copied from llm-guide.js so a stochastic demo can
  // sample deterministically from a seeded RNG).
  function softmax(xs, temperature) {
    temperature = temperature || 1.0;
    var scaled = xs.map(function (x) { return x / temperature; });
    var max = Math.max.apply(null, scaled);
    var exps = scaled.map(function (x) { return Math.exp(x - max); });
    var sum = exps.reduce(function (a, b) { return a + b; }, 0);
    return exps.map(function (e) { return e / sum; });
  }

  // Deterministic 32-bit LCG (copied from llm-guide.js). Every stochastic demo in
  // the serving series must use this, never Math.random(), so a reload is stable.
  function seededRandom(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function fmtBytes(n, digits) {
    digits = digits == null ? 1 : digits;
    var abs = Math.abs(n);
    var units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    var i = 0;
    while (abs >= 1024 && i < units.length - 1) { abs /= 1024; n /= 1024; i++; }
    return (i === 0 ? Math.round(n) : n.toFixed(digits)) + ' ' + units[i];
  }

  function fmtNum(n, digits) {
    digits = digits == null ? 0 : digits;
    return n.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // Fraction -> percent string: fmtPct(0.952, 1) === "95.2%".
  function fmtPct(x, digits) {
    digits = digits == null ? 0 : digits;
    return (x * 100).toFixed(digits) + '%';
  }

  // One standard normal drawn from a *seeded* stream (Box–Muller). The seeded
  // counterpart to GuideMath.gaussianNoise, which calls Math.random().
  function gaussianFrom(rng) {
    var u = Math.max(rng(), 1e-9), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function fmtMs(ms) {
    if (ms == null) return '—';
    if (ms < 1) return (ms * 1000).toFixed(0) + ' µs';
    if (ms < 1000) return (ms < 10 ? ms.toFixed(2) : ms.toFixed(0)) + ' ms';
    if (ms < 60000) return (ms / 1000).toFixed(2) + ' s';
    var m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000);
    return m + 'm ' + s + 's';
  }

  // Horizontal stacked bars, one row per entry. rows: [{label, segments:[{value,color,name}]}].
  // Used by every memory/latency breakdown. Returns {scale, barH, padL} so callers can
  // draw a capacity line or a legend on top of the same geometry.
  function drawStacked(ctx, W, H, rows, opts) {
    opts = opts || {};
    var c = colors();
    ctx.clearRect(0, 0, W, H);
    if (!rows || !rows.length) return { scale: 1, barH: 0, padL: 0 };
    var padL = opts.padL != null ? opts.padL : 110, padR = opts.padR != null ? opts.padR : 16;
    var padT = opts.padT != null ? opts.padT : 10, padB = opts.padB != null ? opts.padB : 24;
    var gap = opts.gap != null ? opts.gap : 12;
    var totals = rows.map(function (r) {
      return r.segments.reduce(function (a, s) { return a + Math.max(0, s.value); }, 0);
    });
    var maxTotal = opts.maxTotal != null ? opts.maxTotal : Math.max.apply(null, totals) || 1;
    var plotW = W - padL - padR;
    var barH = Math.max(6, (H - padT - padB - gap * (rows.length - 1)) / rows.length);
    ctx.font = fontAt(c, opts.fontSize, 'legend');
    // The seven categorical slots, in the order theme.css declares them. A
    // memory breakdown with nine segments wraps the seventh rather than
    // inventing an eighth colour, and the wrap is stable across a theme change.
    var palette = opts.palette || c.series;
    rows.forEach(function (r, i) {
      var y = padT + i * (barH + gap);
      var x = padL;
      r.segments.forEach(function (s, j) {
        var w = plotW * (Math.max(0, s.value) / maxTotal);
        ctx.fillStyle = s.color || palette[j % palette.length];
        ctx.fillRect(x, y, w, barH);
        if (opts.showSegmentLabels && w > 34) {
          // The accent-fg token, not white: it is the on-accent ink in light and
          // a near-black in dark, which is the only thing legible on series 1–3
          // in one theme and on series 4–7 in the other.
          ctx.fillStyle = opts.segmentLabelColor || c.onAccent;
          ctx.textAlign = 'center';
          ctx.fillText(fmtBytes(s.value), x + w / 2, y + barH * 0.68);
        }
        x += w;
      });
      ctx.fillStyle = c.text;
      ctx.textAlign = 'right';
      ctx.fillText(r.label, padL - 8, y + barH * 0.72);
    });
    ctx.textAlign = 'right';
    ctx.fillStyle = c.text;
    ctx.font = c.tickFont;
    if (opts.axisLabel) {
      ctx.textAlign = 'center';
      ctx.fillText(opts.axisLabel, padL + plotW / 2, H - 4);
    }
    return { scale: plotW / maxTotal, barH: barH, padL: padL, padT: padT };
  }

  // Linear interpolation between two colours, t in [0,1]. `a`/`b` may be
  // [r,g,b] arrays or any CSS colour string the browser would have accepted.
  // Promoted out of drawHeatmap's inline interpolation: the generative-media and
  // multimodal guides recolour almost every demo with it.
  //
  // The string arm has to understand `rgb(0 105 214)` and not just `#rrggbb`,
  // because the tokens resolve to the space-separated form (that is what the
  // `-ch` layer is for) and a parser that only knew hex would silently return
  // black. It handles the four shapes a token can take here: #rgb, #rrggbb,
  // rgb()/rgba() with either comma or space separators, and bare `r g b`.
  function toRgb(c) {
    if (typeof c !== 'string') return c;
    var s = c.trim();
    if (s.charAt(0) === '#') {
      var h = s.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    var p = s.indexOf('(');
    if (p >= 0) s = s.slice(p + 1, s.lastIndexOf(')') >= 0 ? s.lastIndexOf(')') : s.length);
    // Strip an alpha component: a token read through a filter can carry one, and
    // these callers are all asking for the opaque colour.
    if (s.indexOf('/') >= 0) s = s.slice(0, s.indexOf('/'));
    s = s.replace(/rgba?\s*|\s*,\s*|\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    var parts = s ? s.split(' ') : [];
    return [parseFloat(parts[0]) || 0, parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0];
  }
  function lerpColor(a, b, t) {
    t = Math.max(0, Math.min(1, t));
    var ca = toRgb(a), cb = toRgb(b);
    return 'rgb(' + Math.round(ca[0] + (cb[0] - ca[0]) * t) + ',' +
      Math.round(ca[1] + (cb[1] - ca[1]) * t) + ',' +
      Math.round(ca[2] + (cb[2] - ca[2]) * t) + ')';
  }

  // Heatmap for expert loads, attention masks and block tables. `matrix` is a 2D
  // array of numbers (rows x cols). opts: {min, max, colorLow, colorHigh, rowLabels, colLabels}.
  function drawHeatmap(ctx, W, H, matrix, opts) {
    opts = opts || {};
    var c = colors();
    ctx.clearRect(0, 0, W, H);
    if (!matrix || !matrix.length) return;
    var rows = matrix.length, cols = matrix[0].length;
    var padL = opts.padL != null ? opts.padL : (opts.rowLabels ? 54 : 4);
    var padB = opts.padB != null ? opts.padB : (opts.colLabels ? 26 : 4);
    var padT = opts.padT != null ? opts.padT : 6, padR = 6;
    var cellW = (W - padL - padR) / cols, cellH = (H - padT - padB) / rows;
    var vals = [];
    matrix.forEach(function (row) { row.forEach(function (v) { vals.push(v); }); });
    var min = opts.min != null ? opts.min : Math.min.apply(null, vals);
    var max = opts.max != null ? opts.max : Math.max.apply(null, vals) || 1;
    // The default ramp is the accent's own tint -> accent, which is the ramp the
    // old [234,240,255] -> [43,95,255] pair was reaching for by hand: pale at the
    // low end, saturated at the high end. Written as tokens it is a ramp on
    // whatever accent the active theme installed, and in dark the tint is a dark
    // step so the ramp runs dark -> bright instead of staying a pale wash that
    // every cell disappears into.
    var lo = toRgb(opts.colorLow || c.tint || '#e2f0fd');
    var hi = toRgb(opts.colorHigh || c.accent);
    function color(v) {
      var t = (max === min) ? 0 : (v - min) / (max - min);
      return lerpColor(lo, hi, Math.max(0, Math.min(1, t)));
    }
    for (var r = 0; r < rows; r++) {
      for (var q = 0; q < cols; q++) {
        ctx.fillStyle = color(matrix[r][q]);
        ctx.fillRect(padL + q * cellW, padT + r * cellH, Math.max(1, cellW + 0.5), Math.max(1, cellH + 0.5));
      }
    }
    ctx.fillStyle = c.text;
    ctx.font = fontAt(c, opts.fontSize, 'tick');
    if (opts.rowLabels) {
      ctx.textAlign = 'right';
      for (var i = 0; i < rows; i++) {
        if (rows <= 24 || i % Math.ceil(rows / 24) === 0) {
          ctx.fillText(opts.rowLabels[i] != null ? opts.rowLabels[i] : i,
            padL - 6, padT + i * cellH + cellH * 0.7);
        }
      }
    }
    if (opts.colLabels) {
      ctx.textAlign = 'center';
      for (var k = 0; k < cols; k++) {
        if (cols <= 24 || k % Math.ceil(cols / 24) === 0) {
          ctx.fillText(opts.colLabels[k] != null ? opts.colLabels[k] : k,
            padL + k * cellW + cellW / 2, H - padB + 14);
        }
      }
    }
    return { cellW: cellW, cellH: cellH, padL: padL, padT: padT };
  }

  // Horizontal bar chart. data: [{label, value}], sorted by caller if desired.
  function drawBars(ctx, W, H, data, opts) {
    opts = opts || {};
    var c = colors();
    ctx.clearRect(0, 0, W, H);
    var padL = opts.padL != null ? opts.padL : 90, padR = opts.padR != null ? opts.padR : 40;
    var padT = opts.padT != null ? opts.padT : 12, padB = opts.padB != null ? opts.padB : 10;
    var maxV = opts.maxV != null ? opts.maxV : Math.max.apply(null, data.map(function (d) { return d.value; })) || 1;
    var barH = (H - padT - padB) / data.length - (opts.gap != null ? opts.gap : 8);
    var gap = opts.gap != null ? opts.gap : 8;
    ctx.font = fontAt(c, opts.fontSize, 'legend');
    data.forEach(function (d, i) {
      var y = padT + i * (barH + gap);
      var w = Math.max(0, (W - padL - padR) * (d.value / maxV));
      // Index 0 is the series the reader is meant to be looking at, so it takes
      // slot 1 of the categorical palette and the rest take the next slot —
      // rather than the first bar being the accent and every other one a lighter
      // step of the same hue, which is one series with a highlight.
      ctx.fillStyle = d.color || c.series[i % c.series.length];
      ctx.fillRect(padL, y, w, barH);
      ctx.fillStyle = c.text;
      ctx.textAlign = 'right';
      ctx.fillText(d.label, padL - 8, y + barH * 0.7);
      ctx.textAlign = 'left';
      ctx.fillText(d.valueLabel != null ? d.valueLabel : d.value, padL + w + 6, y + barH * 0.7);
    });
  }

  // Simple line chart. series: [{points:[{x,y}], color}], x/y in data units; xRange/yRange = [min,max].
  function drawLines(ctx, W, H, series, xRange, yRange, opts) {
    opts = opts || {};
    var c = colors();
    ctx.clearRect(0, 0, W, H);
    var padL = opts.padL != null ? opts.padL : 44, padR = opts.padR != null ? opts.padR : 16;
    var padT = opts.padT != null ? opts.padT : 12, padB = opts.padB != null ? opts.padB : 28;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    function px(x) { return padL + plotW * (x - xRange[0]) / (xRange[1] - xRange[0]); }
    function py(y) { return padT + plotH * (1 - (y - yRange[0]) / (yRange[1] - yRange[0])); }
    ctx.strokeStyle = c.divider; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH); ctx.stroke();
    ctx.fillStyle = c.text; ctx.font = c.tickFont;
    if (opts.xLabel) { ctx.textAlign = 'center'; ctx.fillText(opts.xLabel, padL + plotW / 2, H - 4); }
    if (opts.yLabel) {
      ctx.save(); ctx.translate(12, padT + plotH / 2); ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.fillText(opts.yLabel, 0, 0); ctx.restore();
    }
    series.forEach(function (s) {
      ctx.strokeStyle = s.color || c.accent; ctx.lineWidth = s.width || 2;
      ctx.beginPath();
      s.points.forEach(function (p, i) {
        var X = px(p.x), Y = py(Math.max(yRange[0], Math.min(yRange[1], p.y)));
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      });
      ctx.stroke();
      if (s.dashed) ctx.setLineDash([]);
    });
    return { px: px, py: py, padL: padL, padT: padT, plotW: plotW, plotH: plotH };
  }

  // Vertical bar / histogram chart (drawBars is horizontal only). data is either
  // [{x, y}] with x a bucket centre, or [{x0, x1, y}] with explicit edges.
  // Returns the same mapper bundle as drawLines so a caller can overlay a curve.
  function drawColumns(ctx, W, H, data, opts) {
    opts = opts || {};
    var c = colors();
    ctx.clearRect(0, 0, W, H);
    data = data || [];
    var padL = opts.padL != null ? opts.padL : 44, padR = opts.padR != null ? opts.padR : 16;
    var padT = opts.padT != null ? opts.padT : 12, padB = opts.padB != null ? opts.padB : 28;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var xs = [], ys = [0];
    data.forEach(function (d) {
      if (d.x0 != null) { xs.push(d.x0); xs.push(d.x1); } else { xs.push(d.x); }
      ys.push(d.y);
    });
    if (!xs.length) xs = [0, 1];
    var xRange = opts.xRange || [Math.min.apply(null, xs), Math.max.apply(null, xs)];
    if (xRange[0] === xRange[1]) xRange = [xRange[0] - 0.5, xRange[0] + 0.5];
    var yRange = opts.yRange || [opts.minY != null ? opts.minY : Math.min(0, Math.min.apply(null, ys)),
      opts.maxY != null ? opts.maxY : Math.max.apply(null, ys) || 1];
    if (yRange[0] === yRange[1]) yRange = [0, yRange[0] || 1];
    function px(x) { return padL + plotW * (x - xRange[0]) / (xRange[1] - xRange[0]); }
    function py(y) { return padT + plotH * (1 - (y - yRange[0]) / (yRange[1] - yRange[0])); }
    var baseY = py(0);
    var autoW = (xRange[1] - xRange[0]) / Math.max(1, data.length);
    data.forEach(function (d) {
      var x0, x1;
      if (d.x0 != null) { x0 = px(d.x0); x1 = px(d.x1); }
      else { var half = px(xRange[0] + autoW / 2) - px(xRange[0]); x0 = px(d.x) - half; x1 = px(d.x) + half; }
      var y1 = py(d.y);
      ctx.fillStyle = d.color || opts.color || c.accent;
      ctx.fillRect(x0, Math.min(baseY, y1), Math.max(1, x1 - x0), Math.max(1, Math.abs(baseY - y1)));
    });
    ctx.strokeStyle = c.divider; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, baseY); ctx.lineTo(padL + plotW, baseY); ctx.stroke();
    if (opts.xLabel) { ctx.fillStyle = c.text; ctx.font = c.axisFont; ctx.textAlign = 'center'; ctx.fillText(opts.xLabel, padL + plotW / 2, H - 4); }
    return { px: px, py: py, padL: padL, padT: padT, plotW: plotW, plotH: plotH };
  }

  // requestAnimationFrame-driven loop with a play/pause button.
  // opts: { onStep(dt), button: <el>, interval: ms-between-steps (default: every frame) }
  // Returns { start, stop, toggle, running }.
  function loop(opts) {
    opts = opts || {};
    var running = false;
    var rafId = null;
    var last = null;
    var acc = 0;
    var interval = opts.interval || 0;

    function frame(t) {
      if (!running) return;
      if (last == null) last = t;
      var dt = t - last;
      last = t;
      acc += dt;
      if (interval <= 0) {
        opts.onStep && opts.onStep(dt);
      } else {
        while (acc >= interval) {
          opts.onStep && opts.onStep(interval);
          acc -= interval;
        }
      }
      rafId = window.requestAnimationFrame(frame);
    }

    function start() {
      if (running) return;
      running = true;
      last = null;
      acc = 0;
      rafId = window.requestAnimationFrame(frame);
      if (opts.button) opts.button.textContent = opts.pauseLabel || 'Pause';
    }
    function stop() {
      running = false;
      if (rafId != null) window.cancelAnimationFrame(rafId);
      rafId = null;
      if (opts.button) opts.button.textContent = opts.playLabel || 'Play';
    }
    function toggle() { running ? stop() : start(); }

    if (opts.button) {
      opts.button.textContent = opts.playLabel || 'Play';
      opts.button.addEventListener('click', toggle);
    }

    return { start: start, stop: stop, toggle: toggle, running: function () { return running; } };
  }

  // Wire up a NodeList/array of <input type=range> elements (each with a data-val
  // sibling <span class="val"> to mirror into, optionally) so `update()` runs on
  // every input event, and the displayed value is kept current.
  function bindSliders(els, update) {
    Array.prototype.forEach.call(els, function (el) {
      var valEl = el.parentElement ? el.parentElement.querySelector('.val') : null;
      function sync() {
        if (valEl) valEl.textContent = el.value;
        update(el);
      }
      el.addEventListener('input', sync);
      sync();
    });
  }

  // "Nice" tick locations for a numeric axis: multiples of 1, 2 or 5 times a
  // power of ten, spaced so that roughly `target` ticks fall in [min, max].
  // The standard algorithm `drawLines` should always have had. Returns an array
  // of values (possibly empty when the range is degenerate or non-finite).
  function niceTicks(min, max, target) {
    target = Math.max(1, target || 6);
    if (!isFinite(min) || !isFinite(max) || max <= min) return [];
    var raw = (max - min) / target;
    if (!isFinite(raw) || raw <= 0) return [];
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = (norm < 1.5 ? 1 : (norm < 3 ? 2 : (norm < 7 ? 5 : 10))) * mag;
    var ticks = [];
    var v = Math.ceil(min / step) * step;
    for (var i = 0; i < 1000 && v <= max + step * 1e-9; i++) {
      ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
      v += step;
    }
    return ticks;
  }

  // Arrow from (x0,y0) to (x1,y1) with a filled head and an optional label.
  // opts: {color, width=2, head=9, dashed, label, labelColor, labelOffset}.
  function drawArrow(ctx, x0, y0, x1, y1, opts) {
    opts = opts || {};
    var c = colors();
    var color = opts.color || c.accent;
    var dx = x1 - x0, dy = y1 - y0;
    var len = Math.hypot(dx, dy);
    if (len < 0.5) return;
    var head = Math.min(opts.head || 9, len * 0.6);
    var ux = dx / len, uy = dy / len;
    var bx = x1 - ux * head, by = y1 - uy * head;
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = opts.width || 2;
    ctx.lineCap = 'round';
    if (opts.dashed) ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(bx - uy * head * 0.45, by + ux * head * 0.45);
    ctx.lineTo(bx + uy * head * 0.45, by - ux * head * 0.45);
    ctx.closePath(); ctx.fill();
    if (opts.label) {
      var off = opts.labelOffset || 12;
      ctx.fillStyle = opts.labelColor || c.text;
      ctx.font = c.legendFont;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(opts.label, x1 + ux * off, y1 + uy * off);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  }

  // Pointer-drag manager over Guide.hitTest. getHandles() returns the current
  // handles in *logical canvas coordinates*: [{x, y, r, id}]. onDrag(id, x, y, ev)
  // fires on pointermove; the canvas cursor is set to grab/grabbing. Returns
  // {destroy()}. Pages that need a plane's world coordinates convert inside
  // onDrag via plane.wx/wy.
  function dragHandles(canvas, getHandles, onDrag, opts) {
    opts = opts || {};
    var activeId = null;

    function findHandle(ev) {
      var p = hitTest(canvas, ev);
      var hs = getHandles() || [];
      var best = null, bestD = Infinity;
      for (var i = 0; i < hs.length; i++) {
        var h = hs[i];
        var d = Math.hypot(p.x - h.x, p.y - h.y);
        var r = h.r == null ? 12 : h.r;
        if (d <= r && d < bestD) { best = h; bestD = d; }
      }
      return best;
    }

    function down(ev) {
      var h = findHandle(ev);
      if (!h) return;
      activeId = h.id;
      canvas.style.cursor = 'grabbing';
      if (ev.preventDefault) ev.preventDefault();
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      if (opts.onStart) opts.onStart(h.id, ev);
    }
    function move(ev) {
      if (activeId == null) return;
      var p = hitTest(canvas, ev);
      if (onDrag) onDrag(activeId, p.x, p.y, ev);
      if (ev.preventDefault) ev.preventDefault();
    }
    function up(ev) {
      if (activeId == null) return;
      var id = activeId; activeId = null;
      canvas.style.cursor = opts.cursor || 'grab';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (opts.onEnd) opts.onEnd(id, ev);
    }

    canvas.addEventListener('pointerdown', down);
    canvas.style.touchAction = 'none';
    canvas.style.cursor = opts.cursor || 'grab';

    return {
      destroy: function () {
        canvas.removeEventListener('pointerdown', down);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      }
    };
  }

  // Horizontal step / trace track: a sequence of connected nodes with labels,
  // used by a ReAct trace player, a cache-simulator timeline and an agent film
  // strip. steps: [{id?, label, state?('done'|'active'|'pending'|'error'), color?}].
  // opts: {active (index), nodeR, padL, padR, padT, padB, labelEvery, labelColor}.
  // Returns {nodes:[{id, index, x, y, r}], x(i), y} in logical canvas coords, so a
  // page can hit-test a node with Guide.hitTest and advance `active`.
  function drawTraceTrack(ctx, W, H, steps, opts) {
    opts = opts || {};
    var c = colors();
    ctx.clearRect(0, 0, W, H);
    steps = steps || [];
    if (!steps.length) return { nodes: [], x: function () { return 0; }, y: 0 };
    var padL = opts.padL != null ? opts.padL : 34, padR = opts.padR != null ? opts.padR : 34;
    var padT = opts.padT != null ? opts.padT : 28, padB = opts.padB != null ? opts.padB : 44;
    var plotW = W - padL - padR;
    var n = steps.length;
    var gap = n > 1 ? plotW / (n - 1) : 0;
    var y = padT + (H - padT - padB) / 2;
    var nodeR = opts.nodeR || 9;
    var active = opts.active != null ? opts.active : -1;
    var labelEvery = opts.labelEvery || (n > 14 ? Math.ceil(n / 8) : 1);

    ctx.strokeStyle = c.divider; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gap * (n - 1), y); ctx.stroke();

    var stateColor = {
      done: c.accent700 || c.accent, active: c.accent2, pending: c.divider, error: c.bad || c.accent2
    };
    var nodes = steps.map(function (s, i) {
      var x = padL + i * gap;
      var isActive = i === active;
      var col = s.color || stateColor[s.state] || (isActive ? c.accent2 : c.accent400);
      if (i < active && !s.color && !s.state) col = c.accent700 || c.accent;
      ctx.beginPath(); ctx.arc(x, y, isActive ? nodeR + 2 : nodeR, 0, 2 * Math.PI);
      ctx.fillStyle = col; ctx.fill();
      if (isActive) { ctx.strokeStyle = c.accent2; ctx.lineWidth = 2; ctx.stroke(); }
      if (i % labelEvery === 0 || isActive) {
        ctx.fillStyle = opts.labelColor || c.text;
        ctx.font = (isActive ? '600 ' : '') + c.tickFont;
        ctx.textAlign = 'center';
        ctx.fillText(String(s.label == null ? i : s.label).slice(0, 12), x, y + nodeR + 16);
      }
      return { id: s.id != null ? s.id : i, index: i, x: x, y: y, r: nodeR + 6 };
    });
    if (opts.axisLabel) {
      ctx.fillStyle = c.text; ctx.font = c.axisFont; ctx.textAlign = 'left';
      ctx.fillText(opts.axisLabel, padL, H - 4);
    }
    return { nodes: nodes, x: function (i) { return padL + i * gap; }, y: y, nodeR: nodeR };
  }

  // Stacked-column timeline: one vertical stacked bar per step, read left to
  // right. The counterpart to drawStacked (horizontal rows) for anything with a
  // time axis — an agent's per-step context composition, a per-request cost
  // breakdown. columns: [{label, segments:[{value,color,name}], marker?}].
  // opts: {maxTotal, gap, padL, padR, padT, padB, plotH, labelEvery, palette}.
  // Returns {px(i), py(v), colW, padT, plotH, maxTotal}.
  function drawStackedColumns(ctx, W, H, columns, opts) {
    opts = opts || {};
    var c = colors();
    ctx.clearRect(0, 0, W, H);
    columns = columns || [];
    if (!columns.length) return { px: function () { return 0; }, py: function () { return 0; }, colW: 0, padT: 0, plotH: 0, maxTotal: 1 };
    var padL = opts.padL != null ? opts.padL : 34, padR = opts.padR != null ? opts.padR : 12;
    var padT = opts.padT != null ? opts.padT : 12, padB = opts.padB != null ? opts.padB : 26;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var gap = opts.gap == null ? 2 : opts.gap;
    var totals = columns.map(function (col) {
      return col.segments.reduce(function (a, s) { return a + Math.max(0, s.value); }, 0);
    });
    var maxTotal = opts.maxTotal != null ? opts.maxTotal : (Math.max.apply(null, totals) || 1);
    var colW = (plotW - gap * (columns.length - 1)) / columns.length;
    var palette = opts.palette || c.series;
    var labelEvery = opts.labelEvery || (columns.length > 16 ? Math.ceil(columns.length / 8) : 1);

    columns.forEach(function (col, i) {
      var x = padL + i * (colW + gap);
      var y = padT + plotH;
      col.segments.forEach(function (s, j) {
        var h = plotH * (Math.max(0, s.value) / maxTotal);
        y -= h;
        ctx.fillStyle = s.color || palette[j % palette.length];
        ctx.fillRect(x, y, Math.max(1, colW), Math.max(0, h));
      });
      if (col.marker) {
        ctx.fillStyle = col.marker.color || c.accent2;
        ctx.fillRect(x, padT - 6, Math.max(1, colW), 4);
      }
      ctx.fillStyle = c.text; ctx.font = c.tickFont; ctx.textAlign = 'center';
      if (i % labelEvery === 0 || i === columns.length - 1) {
        ctx.fillText(String(col.label == null ? i : col.label), x + colW / 2, H - 8);
      }
    });
    ctx.strokeStyle = c.divider; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH); ctx.stroke();
    function px(i) { return padL + i * (colW + gap) + colW / 2; }
    function py(v) { return padT + plotH * (1 - v / maxTotal); }
    return { px: px, py: py, colW: colW, padT: padT, plotH: plotH, maxTotal: maxTotal, padL: padL };
  }

  global.Guide = {
    css: css, colors: colors, themeColors: themeColors, setupCanvas: setupCanvas, hitTest: hitTest,
    drawBars: drawBars, drawLines: drawLines, drawColumns: drawColumns, drawStacked: drawStacked, drawHeatmap: drawHeatmap,
    drawArrow: drawArrow, dragHandles: dragHandles, niceTicks: niceTicks,
    lerpColor: lerpColor, toRgb: toRgb, alpha: alpha, fontAt: fontAt, sizePx: sizePx,
    // Theme plumbing, for the modules in assets/js that draw something this kit
    // does not own (a Plotly scene, a table of swatches) and for pages that want
    // to opt a bespoke canvas in without re-deriving the scheduling rules.
    onTheme: onTheme, registerCanvas: registerCanvas, unregisterCanvas: unregisterCanvas,
    resolvedMode: resolvedMode, repaintAll: repaintAll,
    drawTraceTrack: drawTraceTrack, drawStackedColumns: drawStackedColumns,
    softmax: softmax, seededRandom: seededRandom, gaussianFrom: gaussianFrom,
    fmtBytes: fmtBytes, fmtNum: fmtNum, fmtPct: fmtPct, fmtMs: fmtMs,
    loop: loop, bindSliders: bindSliders
  };
})(window);
