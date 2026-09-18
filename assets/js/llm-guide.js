/* Shared helpers for the LLM Training guide demos. Load before page-specific <script>s. */
(function (global) {
  "use strict";

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function colors() {
    return {
      accent: css('--color-accent') || '#2b5fff',
      accent2: css('--color-accent-2') || '#d6006c',
      accent400: css('--color-accent-400') || '#5d85fd',
      accent500: css('--color-accent-500') || '#2b5fff',
      accent700: css('--color-accent-700') || '#0b3cd0',
      text: css('--color-text') || '#201e1d',
      divider: css('--color-divider') || '#ccc',
      font: css('--font-body') || 'sans-serif',
      mono: css('--font-mono') || 'monospace'
    };
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
    return { ctx: ctx, resize: resize };
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
    ctx.font = (opts.fontSize || 12) + 'px ' + c.font;
    data.forEach(function (d, i) {
      var y = padT + i * (barH + gap);
      var w = Math.max(0, (W - padL - padR) * (d.value / maxV));
      ctx.fillStyle = d.color || (i === 0 ? c.accent : c.accent400);
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
    ctx.fillStyle = c.text; ctx.font = '11px ' + c.font;
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
