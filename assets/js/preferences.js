/* ==========================================================================
   ICTheme — reading preferences for the guides.

   One store, one validator, one writer onto the document. The same mapping
   tables are restated in three places on purpose, and this is the only one of
   the three that is a real module:

     _includes/theme-boot.html   the inline no-flash script, before first paint
     assets/js/preferences.js    this file
     assets/css/theme.css        the `:root` defaults for a visitor with no
                                 stored value and no JavaScript

   All three have to agree, so the numbers live in the tables below and are
   restated in the other two rather than derived. theme.css is the contract:
   it is what a reader with no storage, a reader whose JavaScript never runs,
   and a reader who arrives before this file loads all get — the identical
   page. That is the entire reason the defaults are declared in CSS at all.

   THE PUBLIC API. Other files on this site read preferences through exactly
   these four members and through the two events below:

     ICTheme.get()                    the resolved current prefs (a copy)
     ICTheme.set(patch)               merge, validate, persist, apply
     ICTheme.reset()                  back to the defaults
     ICTheme.resolved()               'light' | 'dark' — the mode in force

   THE EVENTS. Both are bubbling CustomEvents dispatched on `document`, and
   `ic:theme` is load-bearing: the canvas routines in assets/js re-read the
   CSS custom properties and repaint when it fires, because a canvas cannot
   resolve a custom property itself. It fires on every change AND once at
   load, so a routine that registers late still gets a chance to sync.

     ic:prefs   detail = the full Prefs object
     ic:theme   detail = { theme, resolved }   // raw choice, concrete mode
   ========================================================================== */

(function (window, document) {
  'use strict';

  if (!window || !document) return;

  /* The chrome colour the mobile address bar takes. Deliberately derived from
     theme.css's own `--c-bg-ch` — 242 245 250 light, 9 12 17 dark.

     The upstream original this was ported from (macro-economics) carries a
     five-point drift on the light value: its THEME_COLOR.light is #f7f8fa
     against its own identical #f2f5fa canvas. That is not copied. A stale
     literal here shows up as a wrong-coloured mobile address bar, which is
     invisible in every desktop screenshot. */
  var THEME_COLOR = { light: '#f2f5fa', dark: '#090c11' };
  var STORAGE_KEY = 'ic-prefs';
  var DARK_QUERY = '(prefers-color-scheme: dark)';
  var REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

  /* ---------------------------------------------------------------- *
   * The preference set
   * ---------------------------------------------------------------- */

  var DEFAULTS = {
    theme: 'system',
    text: 100,
    measure: 'normal',
    leading: 'normal',
    density: 'normal',
    motion: 'system',
    focusMode: false,
    chartGrid: true
  };

  /* Preference value -> CSS custom property value. These tables ARE the
     contract with theme.css and with the inline boot script. The `normal`
     entries are the values the site used before preferences existed, so a
     visitor with nothing stored sees no change at all.

     `text` is stored as the PERCENTAGE the reader picked in the panel, because
     that is what the control shows and what they will recognise in the stored
     JSON; it resolves here to a unitless multiplier on the root font size.
     theme.css multiplies the root font size by it, and every type and space
     step on the site is a `rem`, so one number moves the whole page. */
  var TEXT_SCALE = { 90: 0.9, 100: 1, 115: 1.15, 130: 1.3 };
  var MEASURE = { narrow: '58ch', normal: '70ch', wide: '82ch' };
  var LINE_HEIGHT = { tight: '1.4', normal: '1.6', relaxed: '1.8' };
  var SPACE_SCALE = { compact: '0.85', normal: '1', spacious: '1.15' };

  var KEYS = [
    'theme', 'text', 'measure', 'leading',
    'density', 'motion', 'focusMode', 'chartGrid'
  ];

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function oneOf(allowed) {
    return function (value) {
      for (var i = 0; i < allowed.length; i++) {
        if (allowed[i] === value) return true;
      }
      return false;
    };
  }

  function isBool(value) { return typeof value === 'boolean'; }

  /* Per-key validation. This table is the gate: nothing reaches the document
     or the stylesheet without passing through it, which is what stops a
     hand-edited `ic-prefs` value from producing, say, a measure the
     stylesheet has no mapping for. A key that fails falls back to its default
     rather than being dropped, so the stored object always has the full
     shape even if it was written by an older build. */
  var VALIDATORS = {
    theme: oneOf(['light', 'dark', 'system']),
    text: function (value) { return typeof value === 'number' && has(TEXT_SCALE, value); },
    measure: oneOf(['narrow', 'normal', 'wide']),
    leading: oneOf(['tight', 'normal', 'relaxed']),
    density: oneOf(['compact', 'normal', 'spacious']),
    motion: oneOf(['system', 'reduced', 'full']),
    focusMode: isBool,
    chartGrid: isBool
  };

  function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /** Copy of `prefs`, safe to hand out. Callers must not mutate the store. */
  function copy(prefs) {
    var out = {};
    for (var i = 0; i < KEYS.length; i++) out[KEYS[i]] = prefs[KEYS[i]];
    return out;
  }

  /** Merge an untrusted object over the defaults. Unknown keys are dropped. */
  function sanitize(source) {
    var out = {};
    for (var i = 0; i < KEYS.length; i++) {
      var key = KEYS[i];
      var value = isRecord(source) ? source[key] : undefined;
      out[key] = VALIDATORS[key](value) ? value : DEFAULTS[key];
    }
    return out;
  }

  /* ---------------------------------------------------------------- *
   * Persistence — total on read, best-effort on write
   * ---------------------------------------------------------------- */

  function readRaw() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      /* Storage blocked outright. Preferences are not worth an exception; the
         session still works, it just will not be remembered. */
      return null;
    }
  }

  function writeRaw(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (e) {
      /* private mode, quota, disabled store — same reasoning */
    }
  }

  function load() {
    var raw = readRaw();
    if (raw === null) return sanitize(null);

    var parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      /* Corrupt means forget. Forgetting is honest; guessing at a shape we
         cannot read is not. */
      return sanitize(null);
    }
    if (!isRecord(parsed)) return sanitize(null);
    /* A versioned envelope when one is present, a bare object when not, so a
         value written by a build that predates the envelope still loads. */
    return sanitize(has(parsed, 'prefs') ? parsed.prefs : parsed);
  }

  function persist(prefs) {
    writeRaw(JSON.stringify({ v: 1, prefs: prefs }));
  }

  /* ---------------------------------------------------------------- *
   * The environment
   * ---------------------------------------------------------------- */

  function matches(query) {
    try {
      if (typeof window.matchMedia !== 'function') return false;
      return window.matchMedia(query).matches;
    } catch (e) {
      return false;
    }
  }

  /** `'system'` resolved against the OS. This is the ONLY place it happens. */
  function resolveTheme(pref) {
    if (pref === 'dark' || pref === 'light') return pref;
    return matches(DARK_QUERY) ? 'dark' : 'light';
  }

  /**
   * Motion as a number, for `--pref-motion-scale`.
   *
   * The OS query wins for ALL THREE settings, including `full`:
   *
   *   reduced  the reader asked, here, at this site  -> 0
   *   system   nobody asked; the OS decides         -> 0 if it says reduce
   *   full     the reader asked for motion           -> 0 if it says reduce
   *
   * `full` being subject to the query is not a close call. theme.css already
   * zeroes every duration under `@media (prefers-reduced-motion: reduce)` with
   * `!important`, so returning '1' here did not restore motion — it only made
   * the panel claim a setting was in force that the stylesheet had already
   * overridden. The number has to agree with what the page actually does, and
   * "what the page actually does" is the accessibility setting.
   *
   * It also matches the copy. prefs-panel.html tells the reader, when the OS
   * asks, that System and Full both render a still page and that choosing Full
   * does not override their operating system. That was true of the CSS and
   * false of this function, so the panel contradicted itself depending on the
   * OS setting — and it was the wrong half of the contradiction that appeared
   * for exactly the readers who had asked for less motion.
   *
   * A per-site toggle does not get to overrule a system-level accessibility
   * setting. `reduced` is still worth keeping as an explicit choice: it is the
   * only way to get a still page on a system that does not offer the query.
   */
  function resolveMotionScale(prefs) {
    if (prefs.motion === 'reduced') return '0';
    if (matches(REDUCED_MOTION_QUERY)) return '0';
    return '1';
  }

  /* ---------------------------------------------------------------- *
   * The DOM contract
   * ---------------------------------------------------------------- */

  var current = load();

  function root() { return document.documentElement; }

  /**
   * Write a preference set onto <html>. Everything the stylesheet and every
   * canvas routine can read is written here, once.
   *
   * `data-theme` is always RESOLVED — 'light' or 'dark', never 'system'.
   * The mode is also handed to `color-scheme` so native controls and the
   * scrollbar follow, and to every `theme-color` meta so the browser chrome
   * does. The media attribute is stripped from those metas: they were emitted
   * with `prefers-color-scheme` variants so a reader with no JavaScript still
   * gets the right address bar, and once this module has run the mode is
   * decided by the preference rather than by the query, so the variants are
   * no longer the truth and setting `content` on both keeps the result
   * order-independent.
   */
  function apply(prefs) {
    var el = root();
    if (!el) return;

    var resolved = resolveTheme(prefs.theme);
    var motionScale = resolveMotionScale(prefs);

    el.setAttribute('data-theme', resolved);
    /* Not part of the required contract, and documented as such: the raw
       choice, so the theme toggle can show the PREFERENCE rather than the
       mode. A reader who picked System can see that they have. */
    el.setAttribute('data-pref-theme', prefs.theme);
    el.setAttribute('data-focus-mode', prefs.focusMode ? 'on' : 'off');
    el.setAttribute('data-chart-grid', prefs.chartGrid ? 'on' : 'off');
    if (motionScale === '0') el.setAttribute('data-pref-motion', 'reduced');
    else el.removeAttribute('data-pref-motion');

    el.style.setProperty('--pref-text-scale', String(TEXT_SCALE[prefs.text]));
    el.style.setProperty('--pref-measure', MEASURE[prefs.measure]);
    el.style.setProperty('--pref-line-height', LINE_HEIGHT[prefs.leading]);
    el.style.setProperty('--pref-space', SPACE_SCALE[prefs.density]);
    el.style.setProperty('--pref-motion-scale', motionScale);
    el.style.setProperty('color-scheme', resolved);

    var metas = document.getElementsByTagName('meta');
    for (var i = 0; i < metas.length; i++) {
      if (!metas[i].getAttribute) continue;
      if (metas[i].getAttribute('name') !== 'theme-color') continue;
      metas[i].setAttribute('content', resolved === 'dark' ? THEME_COLOR.dark : THEME_COLOR.light);
      metas[i].removeAttribute('media');
    }
  }

  /* CustomEvent with a constructor fallback, because the constructor is the
     only part of it that is not universal and this file is served to
     everything. */
  function makeEvent(name, detail) {
    var event;
    try {
      event = new window.CustomEvent(name, { bubbles: true, cancelable: false, detail: detail });
    } catch (e) {
      event = document.createEvent('CustomEvent');
      event.initCustomEvent(name, true, false, detail);
    }
    return event;
  }

  function emit(prefs) {
    document.dispatchEvent(makeEvent('ic:prefs', copy(prefs)));
    document.dispatchEvent(makeEvent('ic:theme', {
      theme: prefs.theme,
      resolved: resolveTheme(prefs.theme)
    }));
  }

  /** Store, persist, apply, announce. The single write path. */
  function commit(prefs) {
    current = sanitize(prefs);
    persist(current);
    apply(current);
    emit(current);
    return copy(current);
  }

  /* ---------------------------------------------------------------- *
   * The public API
   * ---------------------------------------------------------------- */

  var ICTheme = {
    get: function () { return copy(current); },

    /**
     * Merge a patch, validate, persist, apply. Invalid values are ignored
     * rather than stored, so the DOM can never receive something the
     * stylesheet has no mapping for. Returns the full resulting prefs.
     */
    set: function (patch) {
      if (!isRecord(patch)) return copy(current);
      var next = copy(current);
      for (var i = 0; i < KEYS.length; i++) {
        var key = KEYS[i];
        if (has(patch, key) && VALIDATORS[key](patch[key])) next[key] = patch[key];
      }
      return commit(next);
    },

    reset: function () {
      return commit(sanitize(null));
    },

    /** The mode actually in force, for a reader asking rather than storing. */
    resolved: function () { return resolveTheme(current.theme); },

    /* The two tables above, read by the panel to build its labels and its
       live readouts. Exposed so the mapping is written down once and the
       panel cannot drift from it. */
    MAP: {
      TEXT_SCALE: TEXT_SCALE,
      MEASURE: MEASURE,
      LINE_HEIGHT: LINE_HEIGHT,
      SPACE_SCALE: SPACE_SCALE,
      THEME_COLOR: THEME_COLOR
    },
    DEFAULTS: copy(DEFAULTS)
  };

  window.ICTheme = ICTheme;

  /* Apply at load, even though the boot script already did. On the ~30
     standalone pages whose hand-written <head> never loads it, this is the
     first write; everywhere else it is a no-op that costs one style flush and
     guarantees the module and the boot script agree. */
  apply(current);

  /* The same `matchMedia` object twice, two listeners, both fanned out
     through `emit` so a live OS change is announced exactly like a manual
     one. `addEventListener` is checked first because Safari below 14 only has
     the deprecated `addListener`. */
  function onQueryChange() {
    if (current.theme === 'system' || current.motion === 'system') {
      apply(current);
      emit(current);
    }
  }

  (function watch(query) {
    try {
      if (typeof window.matchMedia !== 'function') return;
      var mql = window.matchMedia(query);
      if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onQueryChange);
      else if (typeof mql.addListener === 'function') mql.addListener(onQueryChange);
    } catch (e) { /* nothing to watch */ }
  })(DARK_QUERY);
  (function watch(query) {
    try {
      if (typeof window.matchMedia !== 'function') return;
      var mql = window.matchMedia(query);
      if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onQueryChange);
      else if (typeof mql.addListener === 'function') mql.addListener(onQueryChange);
    } catch (e) { /* nothing to watch */ }
  })(REDUCED_MOTION_QUERY);

  document.addEventListener('ic:prefs', function () { syncChrome(); });

  /* ================================================================== *
   * Everything below here is the control surface. It is all null-guarded:
   * this file is loaded by every page, and a page with no chrome (a bare
   * markdown page, a redirect stub) must simply skip it.
   * ================================================================== */

  function el(id) { return document.getElementById(id); }

  /** Text for the text-size row's helper line, which reads as a sentence. */
  var TEXT_SIZE_WORD = { 90: 'Small', 100: 'Default', 115: 'Large', 130: 'Largest' };

  function countChanged(prefs) {
    var n = 0;
    for (var i = 0; i < KEYS.length; i++) {
      if (prefs[KEYS[i]] !== DEFAULTS[KEYS[i]]) n++;
    }
    return n;
  }

  /* ---- the theme toggle: one button, three states ------------------ */

  var THEME_ORDER = ['light', 'dark', 'system'];
  var THEME_HINT = {
    light: 'always light',
    dark: 'always dark',
    system: 'follows your system'
  };

  function nextTheme(pref) {
    var i = THEME_ORDER.indexOf(pref);
    return THEME_ORDER[(i + 1) % THEME_ORDER.length];
  }

  function syncThemeToggle() {
    var btn = el('ic-theme-toggle');
    if (!btn) return;
    var pref = current.theme;
    var next = nextTheme(pref);
    btn.setAttribute('aria-label', 'Theme: ' + pref + ', ' + THEME_HINT[pref] + '. Switch to ' + next + '.');
    btn.setAttribute('title', 'Theme: ' + pref + ' — switch to ' + next);
  }

  /* ---- the settings panel ------------------------------------------ */

  var panel = null;
  var panelToggle = null;

  function prefersReducedMotion() { return matches(REDUCED_MOTION_QUERY); }

  function syncChrome() {
    syncThemeToggle();
    if (!panel) return;
    var prefs = current;

    /* Radio groups: set `checked` on the matching input, and let the native
       grouping do the rest. Writing `checked` rather than `defaultChecked`
       keeps the control's state in step after a reset, which is the case
       where a `defaultChecked` would be visibly wrong. */
    var radios = panel.querySelectorAll('input[type="radio"][data-pref]');
    for (var i = 0; i < radios.length; i++) {
      var key = radios[i].getAttribute('data-pref');
      if (has(prefs, key)) radios[i].checked = String(prefs[key]) === radios[i].value;
    }

    var boxes = panel.querySelectorAll('input[type="checkbox"][data-pref]');
    for (var j = 0; j < boxes.length; j++) {
      var bkey = boxes[j].getAttribute('data-pref');
      if (has(prefs, bkey)) boxes[j].checked = !!prefs[bkey];
    }

    /* The two live readouts. They are the reason a segmented control beats a
       select here: the number the preference produces is the thing a reader
       cannot otherwise predict, and showing it next to the label is what
       makes the choice reversible in their head. */
    var chOut = panel.querySelector('[data-readout="measure"]');
    if (chOut) chOut.textContent = MEASURE[prefs.measure];
    var lhOut = panel.querySelector('[data-readout="leading"]');
    if (lhOut) lhOut.textContent = LINE_HEIGHT[prefs.leading];
    var pctOut = panel.querySelector('[data-readout="text"]');
    if (pctOut) pctOut.textContent = prefs.text + '%';

    var sizeDesc = panel.querySelector('[data-desc="text"]');
    if (sizeDesc) {
      sizeDesc.textContent = (TEXT_SIZE_WORD[prefs.text] || 'Default') +
        '. Scales every text size on the site, equations and tables included.';
    }

    /* Motion says out loud what `full` cannot do, rather than letting a
       control look like it has overridden the OS while quietly not doing so. */
    var osReduced = prefersReducedMotion();
    var motionDesc = panel.querySelector('[data-desc="motion"]');
    if (motionDesc) {
      motionDesc.textContent = osReduced
        ? 'Your system is asking for reduced motion, so this setting cannot turn animation off.'
        : 'System follows your operating system. Reduced removes every transition on this site. Full keeps them on even where your system asks for less.';
    }
    var motionNote = panel.querySelector('[data-note="motion"]');
    if (motionNote) {
      motionNote.hidden = !osReduced;
    }

    var n = countChanged(prefs);
    var count = panel.querySelector('[data-prefs-count]');
    if (count) {
      count.textContent = n === 0 ? 'Using the defaults' : n + ' changed';
    }
    var reset = panel.querySelector('[data-prefs-reset]');
    /* Reset disables the button that was just pressed, and a disabled button
       cannot hold focus — so focus would drop to the body and the reader
       would have to tab back in from the top. Hand it to the close button,
       which is the first thing in the panel and is always there. */
    if (reset) {
      reset.disabled = n === 0;
      if (n === 0) {
        var close = panel.querySelector('[data-prefs-close]');
        if (close && panel.contains(document.activeElement)) close.focus();
      }
    }
  }

  function openPanel() {
    if (!panel) return;
    syncChrome();
    if (typeof panel.showModal === 'function') panel.showModal();
    else panel.setAttribute('open', ''); /* an ancient browser: still usable */
    if (panelToggle) panelToggle.setAttribute('aria-expanded', 'true');
    var close = panel.querySelector('[data-prefs-close]');
    if (close) close.focus();
  }

  function closePanel() {
    if (!panel) return;
    if (typeof panel.close === 'function') panel.close();
    else panel.removeAttribute('open');
  }

  function onPanelToggle() {
    if (panel && panel.open) closePanel();
    else openPanel();
  }

  /**
   * A click on the scrim closes. A `<dialog>` in its top layer delivers a
   * click on the backdrop as a click on the dialog element itself, so the
   * target test is the mechanism; the bounding-rect test is the guarantee, for
   * a browser that gets the hit-testing subtly wrong.
   */
  function onPanelClick(event) {
    if (!panel || !panel.open) return;
    if (event.target !== panel) return;
    var rect = panel.getBoundingClientRect();
    var inside = event.clientX >= rect.left && event.clientX <= rect.right &&
      event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (inside) return;
    closePanel();
  }

  /* Escape is the dialog's own default action, so it is only worth handling
     for the browsers without `close()`. Focus returning to the toggle is not
     a default, though, and it is the part a reader notices: the control they
     pressed should be the control they land back on. */
  function onPanelClose() {
    if (panelToggle) {
      panelToggle.setAttribute('aria-expanded', 'false');
      panelToggle.focus();
    }
  }

  function initPanel() {
    panel = el('ic-prefs-panel');
    panelToggle = el('ic-prefs-toggle');
    if (!panel) return;

    if (panelToggle) {
      panelToggle.addEventListener('click', onPanelToggle);
      panelToggle.setAttribute('aria-expanded', panel.open ? 'true' : 'false');
    }

    var close = panel.querySelector('[data-prefs-close]');
    if (close) close.addEventListener('click', closePanel);

    panel.addEventListener('click', onPanelClick);
    if (typeof panel.addEventListener === 'function') panel.addEventListener('close', onPanelClose);

    /* One delegated listener for the whole panel rather than one per input:
     * the panel is rendered by an include and a reader may add a row to it
     * without wanting to remember to rebind anything. */
    panel.addEventListener('change', function (event) {
      var input = event.target;
      if (!input || !input.getAttribute) return;
      var key = input.getAttribute('data-pref');
      if (!has(current, key)) return;
      var patch = {};
      patch[key] = input.type === 'checkbox' ? !!input.checked : coerce(key, input.value);
      ICTheme.set(patch);
    });

    /* Arrow keys across a radio group. The native walk already moves
       selection between radios; what it does not do is wrap at the ends, and
       what it does not do visibly here is move the focus ring, because the
       input is clipped out of sight. This moves both, and it is scoped to the
       group so two adjacent rows of the panel cannot bleed into each other. */
    panel.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowDown' &&
          event.key !== 'ArrowLeft' && event.key !== 'ArrowUp' &&
          event.key !== 'Home' && event.key !== 'End') return;
      var input = event.target;
      if (!input || !input.getAttribute || input.getAttribute('data-pref') === null) return;
      if (input.type !== 'radio') return;

      var fieldset = input.closest ? input.closest('.prefs__group') : null;
      if (!fieldset) return;
      var inputs = fieldset.querySelectorAll('input[type="radio"]');
      if (!inputs.length) return;

      var index = -1;
      for (var i = 0; i < inputs.length; i++) if (inputs[i] === input) index = i;
      if (index < 0) return;

      var end = inputs.length - 1;
      var next;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown': next = index === end ? 0 : index + 1; break;
        case 'ArrowLeft':
        case 'ArrowUp': next = index === 0 ? end : index - 1; break;
        case 'Home': next = 0; break;
        case 'End': next = end; break;
        default: return;
      }
      event.preventDefault();
      inputs[next].focus();
      inputs[next].click();
    });

    var reset = panel.querySelector('[data-prefs-reset]');
    if (reset) {
      reset.addEventListener('click', function () {
        ICTheme.reset();
        var first = panel.querySelector('input[type="radio"]');
        if (first) first.focus();
      });
    }
  }

  /** The DOM carries strings; the store carries the typed value. */
  function coerce(key, value) {
    if (key === 'text') {
      var n = parseInt(value, 10);
      return has(TEXT_SCALE, n) ? n : DEFAULTS.text;
    }
    return value;
  }

  /* ---- the skip link's target -------------------------------------- */

  /**
   * Every layout this repo owns declares `<main id="main">` in its own markup.
   * The ~570 standalone guide pages do not: they each carry a complete
   * hand-written document and CLAUDE.md is explicit that their markup is not
   * to be migrated opportunistically. Rather than leave a skip link that
   * goes nowhere on most of the site, the id is stamped onto the first
   * `<main>` that lacks one. It happens on every load, so it is a no-op on
   * the pages that already have it, and a broken link only for a reader whose
   * JavaScript is off AND who is on a legacy page.
   */
  function initSkipTarget() {
    if (document.getElementById('main')) return;
    var main = document.querySelector('main');
    if (main) main.id = 'main';
  }

  function init() {
    /* The gate for the chrome that only works with this module: the theme
       toggle, the settings toggle and the footer's settings button are
       `display: none` in chrome.css until this class lands, so a reader whose
       JavaScript never runs is never handed a control that does nothing.
       theme.css's own `prefers-color-scheme` block is what decides the mode
       for that reader, so they lose nothing but the ability to change a
       preference they have not expressed. */
    var el0 = root();
    if (el0 && el0.classList) el0.classList.add('ic-js');

    initSkipTarget();
    initPanel();
    syncThemeToggle();
    syncChrome();

    var themeBtn = el('ic-theme-toggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        ICTheme.set({ theme: nextTheme(current.theme) });
      });
    }

    /* The footer carries a second way into the panel, because a reader who
       has scrolled to the end of a long part and wants a different text size
       should not have to find the header again. */
    var footerToggle = el('ic-prefs-toggle-footer');
    if (footerToggle) {
      footerToggle.addEventListener('click', function () { openPanel(); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* One announce after the control surface exists, so a canvas routine that
     registered a listener during its own module evaluation gets the first
     ic:theme rather than having to wait for the reader to touch something.
     It is a real repaint for those routines and they are written to be
     idempotent; the alternative is a canvas that can be permanently one
     scheme out of step with the page. */
  emit(current);
})(window, document);
