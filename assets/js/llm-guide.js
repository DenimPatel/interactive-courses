/* Shared helpers for the LLM Training guide demos. Load before page-specific <script>s.
 *
 * This file predates guide-core.js and the existing LLM-training pages load it
 * ALONE — none of them also loads guide-core. So the theme layer cannot simply be
 * imported here: when guide-core is on the page its `themeColors()` is the single
 * reader of the tokens, and when it is not, this file has to resolve them itself.
 * Both paths land on the same object shape, so a draw routine below does not
 * branch, and the local copy is a strict subset of the shared one. */
(function (global) {
  "use strict";

  function css(name) {
    if (typeof document === 'undefined' || !document.documentElement) return '';
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  var LLMG_LOCAL = { accent: '#0069d6', accent2: '#0d9488', accent400: '#2a89e0', accent500: '#0069d6', accent700: '#004aa8', text: '#0c1118', divider: '#d9dee6', font: 'sans-serif', mono: 'monospace' };

  function localColors() {
    // Resolved at call time, exactly as the shared version is: a read cached at
    // module scope is the defect this layer exists to remove.
    var c = {
      accent: css('--color-accent') || LLMG_LOCAL.accent,
      accent2: css('--color-accent-2') || LLMG_LOCAL.accent2,
      accent400: css('--color-accent-400') || LLMG_LOCAL.accent400,
      accent500: css('--color-accent-500') || LLMG_LOCAL.accent500,
      accent700: css('--color-accent-700') || LLMG_LOCAL.accent700,
      text: css('--color-text') || LLMG_LOCAL.text,
      divider: css('--color-divider') || LLMG_LOCAL.divider,
      font: css('--font-body') || LLMG_LOCAL.font,
      mono: css('--font-mono') || LLMG_LOCAL.mono
    };
    // The chart type sizes, as ready-made font shorthands. A canvas cannot carry
    // the `max(11px, 0.6875rem)` the tokens are written with, so the arithmetic
    // happens here; a page that never loaded the tokens simply keeps 11px.
    var rp = parseFloat(css('font-size')) || 16;
    c.tickFont = sizeFrom(css('--chart-tick-size'), rp, 11) + 'px ' + c.font;
    c.axisFont = sizeFrom(css('--chart-axis-label-size'), rp, 11) + 'px ' + c.font;
    c.legendFont = sizeFrom(css('--chart-legend-size'), rp, 12) + 'px ' + c.font;
    return c;
  }

  function sizeFrom(raw, rp, fallback) {
    var m = /max\s*\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)rem\s*\)/.exec(raw || '');
    if (!m) return fallback;
    return Math.max(parseFloat(m[1]), parseFloat(m[2]) * rp);
  }

  // Prefers the shared layer when guide-core.js is loaded; falls back to the
  // local resolution when it is not. Both are read fresh on every call.
  function colors() {
    if (global.Guide && global.Guide.themeColors) return global.Guide.themeColors();
    return localColors();
  }

  // Numerically-stable softmax.
  function softmax(xs, temperature) {
    temperature = temperature || 1.0;
    var scaled = xs.map(function (x) { return x / temperature; });
    var max = Math.max.apply(null, scaled);
    var exps = scaled.map(function (x) { return Math.exp(x - max); });
    var sum = exps.reduce(function (a, b) { return a + b; }, 0);
    return exps.map(function (e) { return e / sum; });
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
    // A theme change repaints through the SAME path as a resize, so the switch
    // re-reads the CSS box and the device pixel ratio as well as the colour, and
    // there is still only one resize path. When guide-core.js is loaded it owns
    // the scheduling (one frame, coalesced, gated on visibility); without it the
    // canvas simply repaints on the next signal, one frame per canvas, which is
    // the old behaviour and no worse.
    if (global.Guide && global.Guide.registerCanvas) global.Guide.registerCanvas(canvas, resize);
    else watchLocally(canvas, resize);
    return { ctx: ctx, resize: resize };
  }

  // The fallback half of the repaint plumbing for a page that loads this file
  // without guide-core.js. Same two signals, same coalescing to a single frame,
  // no IntersectionObserver gate: an older browser with no guide-core is not a
  // browser to assume an observer into. Registered once, on first canvas.
  var localWatchers = null;
  function watchLocally(canvas, repaint) {
    if (typeof document === 'undefined') return;
    if (!localWatchers) {
      localWatchers = [];
      var frame = null, queued = [];
      function flush() {
        frame = null;
        var list = queued; queued = [];
        for (var i = 0; i < list.length; i++) list[i]();
      }
      function repaintAll() {
        for (var i = 0; i < localWatchers.length; i++) if (queued.indexOf(localWatchers[i]) < 0) queued.push(localWatchers[i]);
        if (frame == null) frame = (window.requestAnimationFrame || function (f) { return window.setTimeout(f, 16); })(flush);
      }
      document.addEventListener('ic:theme', repaintAll, false);
      document.addEventListener('ic:prefs', repaintAll, false);
      if (typeof window.matchMedia === 'function') {
        var mq = null;
        try { mq = window.matchMedia('(prefers-color-scheme: dark)'); } catch (e) { mq = null; }
        if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', repaintAll);
        else if (mq && typeof mq.addListener === 'function') mq.addListener(repaintAll);
      }
    }
    if (localWatchers.indexOf(repaint) < 0) localWatchers.push(repaint);
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
    // The legend size token, unless the caller pinned one. Not `opts.fontSize ||`
    // so an explicit 0 is not silently replaced by the default.
    ctx.font = (opts.fontSize != null ? opts.fontSize : c.legend || 12) + 'px ' + c.font;
    data.forEach(function (d, i) {
      var y = padT + i * (barH + gap);
      var w = Math.max(0, (W - padL - padR) * (d.value / maxV));
      ctx.fillStyle = d.color || c.accent;
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

  // ---- Tiny linear-algebra kit for the architecture demos ----
  function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  function vadd(a, b) { return a.map(function (v, i) { return v + b[i]; }); }
  function vscale(a, k) { return a.map(function (v) { return v * k; }); }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  // matrix as array-of-rows; matmul(A, B) with A: m x k, B: k x n -> m x n
  function matmul(A, B) {
    var m = A.length, k = A[0].length, n = B[0].length;
    var out = [];
    for (var i = 0; i < m; i++) {
      var row = new Array(n).fill(0);
      for (var kk = 0; kk < k; kk++) {
        var a = A[i][kk];
        for (var j = 0; j < n; j++) row[j] += a * B[kk][j];
      }
      out.push(row);
    }
    return out;
  }
  function transpose(A) {
    var m = A.length, n = A[0].length, out = [];
    for (var j = 0; j < n; j++) { var row = []; for (var i = 0; i < m; i++) row.push(A[i][j]); out.push(row); }
    return out;
  }
  function seededRandom(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  function randMatrix(rows, cols, rng, scale) {
    scale = scale == null ? 1 : scale;
    var out = [];
    for (var i = 0; i < rows; i++) {
      var row = [];
      for (var j = 0; j < cols; j++) row.push((rng() * 2 - 1) * scale);
      out.push(row);
    }
    return out;
  }

  global.LLMG = {
    css: css, colors: colors, softmax: softmax, setupCanvas: setupCanvas,
    drawBars: drawBars, drawLines: drawLines,
    dot: dot, vadd: vadd, vscale: vscale, norm: norm, matmul: matmul, transpose: transpose,
    seededRandom: seededRandom, randMatrix: randMatrix
  };
})(window);
