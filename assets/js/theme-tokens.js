/* ==========================================================================
   theme-tokens.js — the old-palette bridge
   --------------------------------------------------------------------------
   Every part page paints its own canvas from its own inline <script>, and for
   two decades of editing those scripts accumulated their own colour constants:
   a copy of the core palette, plus per-page categorical hues. Those literals
   are invisible to the theme, so a reader who chose Dark got charts drawn in
   the light scheme's ink.

   Replacing each literal at its ~700 call sites would mean ~700 decisions
   about which token a given hue meant, spread across 216 files, none of them
   reviewable as a whole. So the decision is made ONCE, here, and the call
   sites become a mechanical swap:

       ctx.fillStyle = '#2b5fff';            ->  ctx.fillStyle = THEME.ink('#2b5fff');
       stroke: '#2b5fff';                    ->  stroke: THEME.ink('#2b5fff');

   One map, one review, and the diff on any page is a substitution rather than
   a judgement.

   WHAT THE MAP IS, AND WHY IT IS A MAP RATHER THAN A SEARCH-AND-REPLACE
   ----------------------------------------------------------------------
   Three tiers, and the difference matters:

   1. CORE — the hues that WERE the design system's own values. These have an
      obvious correct target, and leaving them would mean the migration is
      half-done in the one place a reader is most likely to notice.

   2. CATEGORICAL — a page's own series colours, a dozen golds and violets and
      olives. They are page content, not chrome, and several are semantically
      meaningful (a green that means "converged", a red that means "diverged").
      These are mapped to the nearest theme token, or left alone where a fixed
      hue IS the content. A page whose fifth series is olive does not get a
      better chart by being handed the azure ramp; it gets a worse one.

   3. UNKNOWN — anything not in the map passes through UNCHANGED. That is the
      safety property: an unmapped literal is a bug we can see in the report,
      not a silently wrong colour on a page.

   WHY A BRIDGE RATHER THAN AN INLINE VAR()
   `var(--token)` cannot be assigned to `ctx.fillStyle` — canvas paint is not
   CSS, and the string is handed to a rasteriser that knows nothing about
   custom properties. So the value has to be read at draw time. Reading
   `getComputedStyle` on every one of ~700 paint calls per frame would be
   absurd, hence the cache, and hence the invalidation on the theme events.

   WHY IT IS A PLAIN SYNCHRONOUS <script src> AND NOT defer
   A page's inline <script> can paint during parse, and a deferred module is
   not defined until after parse. A reader who landed on a page that paints at
   parse time would hit `THEME is not defined` on the first frame. The file is
   ~2 kB and same-origin; blocking on it is the correct trade for being
   defined before anything that uses it.

   NOT A BUILD STEP. The repo's house rule is self-contained pages with no
   bundler and no preprocessor. This is one small file, loaded the same way
   every other shared script is.
   ========================================================================== */
(function (global) {
  "use strict";

  /* --- Tier 1: the old core palette. -------------------------------------
     Values are the literals the previous stylesheet actually used. Each maps
     to the token that now owns that role. */
  var CORE = {
    /* accent */
    "#2b5fff": "--c-accent",        /* the old blue           */
    "#2b5bff": "--c-accent",
    "#0b3cd0": "--c-accent-ink",     /* a pressed / hovered step */
    "#5d85fd": "--c-accent-300",
    "#93aefe": "--c-accent-200",
    "#eaf0ff": "--c-accent-100",
    /* second series hue */
    "#d6006c": "--c-accent-2",       /* the old crimson        */
    "#d6336c": "--c-accent-2",
    /* ink */
    "#201e1d": "--c-fg",             /* the old near-black text */
    "#2b2b2b": "--c-fg",
    /* canvas and surfaces */
    "#fbfaf7": "--c-bg",             /* the old warm page      */
    "#fbfaf9": "--c-bg",
    "#f2f5fa": "--c-surface-2",      /* the old card tint      */
    "#e7e2d9": "--c-surface-2",
    "#e8f4f8": "--c-surface-2",
    "#ffffff": "--c-surface",        /* a plate / a fill       */
    "#fff":    "--c-surface",
    /* rules and structure */
    "#e2ded6": "--c-border",
    "#9b9797": "--c-fg-subtle",      /* the old mid grey       */
    "#9a9a9a": "--c-fg-subtle",
    "#9aa4ab": "--c-fg-subtle",
    "#8a8a8a": "--c-fg-muted",
    "#6b6963": "--c-fg-muted",
    "#4a545b": "--c-fg-muted",
    /* The old scheme's second set of light steps. A page that kept a bare
       literal from one of these stayed visibly light in dark mode, which is the
       whole failure this bridge exists to remove — so they are mapped rather
       than left for a per-page decision. */
    "#e2ddd4": "--c-surface-2",
    "#e9e5df": "--c-surface-2",
    "#eeeae2": "--c-surface-2",
    "#f2efe9": "--c-surface-2",
    "#dbe9f0": "--c-surface-2",
    "#eef3f6": "--c-surface-2",
    "#e7ebee": "--c-surface-2",
    "#eef1f3": "--c-surface-2",
    /* Faint cell fills and hairlines: a border step, not a surface step. */
    "#ccc": "--c-border-strong",
    "#ddd": "--c-border-strong",
    "#dddddd": "--c-border-strong",
    "#e9e9e9": "--c-border-strong",
    "#cdd5da": "--c-border-strong",
    "#999": "--c-fg-subtle",
    /* A dark teal used as ink rather than as a fill. */
    "#08343f": "--c-accent-2-ink",
    /* Near-black used as a plot marker. Unmapped, it stays near-black in dark
       mode and vanishes into the canvas — a marker you cannot see is worse
       than a marker in the wrong colour. */
    "#111111": "--c-fg",
    "#1c1c1c": "--c-fg",
    "#2a2826": "--c-fg",
    "#555555": "--c-fg-muted",
    /* Deep saturated ramp ends, all of which were the "high" end of a
       sequential heatmap and therefore invisible against a dark canvas. They
       are the accent and the second series slot, not new colours: a ramp end
       that is a fixed hue cannot follow the theme, which is the whole defect
       these are here to fix. */
    "#1432a0": "--c-accent-ink",
    "#3c1496": "--c-accent-2",
    "#c82878": "--c-accent-2",
    "#00789c": "--c-accent-2",
    "#006e96": "--c-accent-2",
    /* Gear tints and step-list washes. The first of each pair is already
       mapped to a surface step, so leaving its partner alone made the two
       halves of one illustration disagree in dark mode. */
    "#fce8f1": "--c-surface-2",
    "#e8f5fa": "--c-surface-2"
  };

  /* --- Tier 2: status. Meaning is semantic, so the target is semantic.
     A green that means "converged" is `--c-ok` and nothing else; leaving it
     as a literal would mean a dark-mode reader sees a chart whose success
     state is the one colour the dark palette cannot carry. */
  var STATUS = {
    "#2f9e44": "--c-ok",
    "#1a7a3a": "--c-ok",
    "#2a9d5c": "--c-ok",
    "#2f7d32": "--c-ok",
    "#127919": "--c-ok",
    "#1f7a3d": "--c-ok",
    "#3aa66a": "--c-ok",
    "#2a9d3f": "--c-ok",   /* a near-duplicate of #2a9d5c on the triangulation
                             pages, where it is always the green half of a
                             green/red pair; leaving it behind meant the red
                             half migrated and the green half did not, which
                             is worse than either */
    "#5f8a3a": "--c-ok",
    "#c23b3b": "--c-bad",
    "#c83232": "--c-bad",
    "#e8590c": "--c-bad",
    "#b0552d": "--c-bad",
    "#a15c00": "--c-warn",
    "#e08a1e": "--c-warn",
    "#c98a00": "--c-warn",
    "#efb23c": "--c-warn"
  };

  /* --- Tier 3: categorical series colours.
     Mapped to the fixed 7-slot categorical palette, which is deliberately
     theme-invariant: a series that changed colour when the theme changed
     would be a different series. A hue not listed here is left alone, because
     a page's own sixth colour is page content. */
  var SERIES = {
    "#c9a227": "--chart-series-3",  /* gold   -> amber slot  */
    "#7a5c9e": "--chart-series-4",  /* purple -> violet slot  */
    "#5b2d7a": "--chart-series-4",
    "#8a5cff": "--chart-series-4",
    "#128161": "--chart-series-2"   /* teal   -> teal slot, already */
  };

  var MAP = {};
  function merge(target) {
    for (var k in target) {
      if (Object.prototype.hasOwnProperty.call(target, k)) MAP[k] = target[k];
    }
  }
  merge(CORE);
  merge(STATUS);
  merge(SERIES);

  /* The 7 categorical slots, as a function call can use them. A page with a
     five-colour palette reads slots 1..5 and never sees a literal again. */
  var SERIES_SLOTS = [
    "--chart-series-1",
    "--chart-series-2",
    "--chart-series-3",
    "--chart-series-4",
    "--chart-series-5",
    "--chart-series-6",
    "--chart-series-7"
  ];

  var root = null;
  var cache = Object.create(null);
  var cacheValid = false;
  var unmapped = Object.create(null);

  function ensureRoot() {
    if (root && root.isConnected !== false) return root;
    root = document.documentElement;
    return root;
  }

  function read(token) {
    if (cacheValid && Object.prototype.hasOwnProperty.call(cache, token)) {
      return cache[token];
    }
    var raw = global
      .getComputedStyle(ensureRoot())
      .getPropertyValue(token);
    var value = (raw || "").trim();
    if (value === "") {
      /* A token that does not resolve must not silently become "transparent".
         An empty fillStyle leaves the previous colour in place, which is
         worse than the literal we replaced. */
      return null;
    }
    cache[token] = value;
    return value;
  }

  function invalidate() {
    cacheValid = false;
  }

  var api = {
    /**
     * Resolve a colour for canvas paint.
     *
     * Accepts a token name, a hex, or anything else. A hex in the map becomes
     * the token that now owns that role; a hex that is not in the map is
     * returned untouched. A token that fails to resolve falls back to the
     * original argument, so a missing stylesheet degrades to the old colours
     * rather than to nothing.
     */
    ink: function (value) {
      if (typeof value !== "string" || value === "") return value;
      var token = MAP[value.toLowerCase()];
      if (!token) {
        if (/^#[0-9a-f]{3,8}$/i.test(value)) {
          unmapped[value.toLowerCase()] = (unmapped[value.toLowerCase()] || 0) + 1;
        }
        return value;
      }
      var resolved = read(token);
      return resolved === null ? value : resolved;
    },

    /** The resolved value of a raw token, e.g. THEME.token('--c-accent'). */
    token: function (token) {
      var v = read(token);
      return v === null ? "" : v;
    },

    /** Categorical series slot, 1-based. Out of range wraps rather than
        returning undefined, because a ninth series should still be coloured. */
    series: function (n) {
      var i = (Math.abs(n | 0) - 1) % SERIES_SLOTS.length;
      if (i < 0) i += SERIES_SLOTS.length;
      return api.token(SERIES_SLOTS[i]) || api.token("--c-accent");
    },

    /**
     * The colour of text or a glyph drawn ON an accent-filled shape.
     *
     * Separate from `ink()` on purpose, because `#fff` is genuinely ambiguous:
     * as a FILL it is the surface, and `ink('#fff')` is right. As a LABEL on an
     * accent plate it must be `--c-accent-fg`, which is white in light and a
     * near-black in dark — a white label on a light-blue accent in dark mode
     * fails contrast outright. One hex, two correct answers, so the call site
     * has to say which it means.
     */
    onAccent: function () {
      var v = read("--c-accent-fg");
      if (v === null) return "#ffffff";
      /* The literal in the argument is the light-mode value, so a stylesheet
         that failed to load degrades to the original behaviour rather than to
         an invisible label. */
      return v;
    },

    /** The categorical palette as an array, for a page that used to
        carry its own literal array. */
    palette: function () {
      return SERIES_SLOTS.map(function (t) { return api.token(t); });
    },

    /**
     * The accent with an alpha, as an rgba()/rgb() string. Canvas has no
     * alpha channel in a hex literal, so the old code reached for
     * `rgba(43,95,255,0.20)` and hard-coded the accent's RGB into the alpha
     * form — which is why an area wash stayed the old blue in dark mode.
     *
     * NEVER RETURNS AN EMPTY STRING. An empty `fillStyle` is not a neutral
     * miss: the canvas spec says an unparseable fillStyle leaves the previous
     * value in place, so a typo'd token name would silently leave one shape
     * wearing the colour of whatever was drawn before it — a bug that appears
     * in one figure, on one branch, and looks like a rendering quirk. A
     * missing token falls back to the ink, and a missing stylesheet falls back
     * to a neutral grey: both are visible, and both are visibly wrong enough
     * to be noticed.
     */
    alpha: function (token, a) {
      var value = read(token);
      if (value === null) {
        value = read("--c-fg");
        if (value === null) return "rgba(128, 128, 128, " + a + ")";
      }
      var m = value.match(/([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)/);
      if (m) return "rgba(" + m[1] + ", " + m[2] + ", " + m[3] + ", " + a + ")";
      /* Modern syntax: rgb(r g b / a) parses fine as a canvas fillStyle in
         every engine that can read a custom property at all. */
      return value.replace(/\)$/, " / " + a + ")");
    },

    /** Colours asked for that are not in the map, with counts. For the
        migration report; nothing reads it at runtime. */
    unmapped: function () { return unmapped; },

    /** Force a re-read. Called on every theme and preference change. */
    refresh: invalidate
  };

  /* One invalidation point, for both events. A theme change rewrites every
     custom property in the document, so every cached colour is now wrong. */
  if (global.document && global.document.addEventListener) {
    global.document.addEventListener("ic:theme", invalidate, true);
    global.document.addEventListener("ic:prefs", invalidate, true);
  }

  global.THEME = api;
})(window);
