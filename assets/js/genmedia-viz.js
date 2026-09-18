/* genmedia-viz.js — the shared domain layer for the /ai/generative-media/ and
 * /ai/multimodal/ guides (the two-volume Multimodal & Generative Media arc).
 * Loaded first, before diffusion-viz.js / multimodal-viz.js — the precedent is
 * linalg-viz.js being loaded by the statistics pages too. It holds only what
 * BOTH volumes need:
 *
 *   rng/gauss      seeded RNG + Box–Muller (no Math.random anywhere)
 *   plot           canvas widget modelled directly on Stats.plot
 *                  (assets/js/stats-viz.js): same px/py/wx/wy mapping,
 *                  live-mutable xRange/yRange and the handles(specsOrFn,
 *                  onChange) world-coordinate contract
 *   raster         a pixel-grid widget: holds an H×W×C float image in [0,1],
 *                  draws it nearest-neighbour with an optional patch grid
 *   img            procedural test images (the site ships no local rasters)
 *   net            a seeded tiny MLP with hand-written backprop + SGD, so the
 *                  "train a real denoiser in the browser" demos train something
 *   dsp            waveform synthesis, radix-2 FFT, STFT, mel filterbank, RVQ
 *   attn           softmax, cosine similarity, InfoNCE and SigLIP losses
 *   cost           parameter / FLOP / token-budget arithmetic
 *   timeline       latency budgets and a full-duplex turn simulator
 *
 * House rules: ES5 only, one global at the bottom, lazy Guide access
 * (function Guide() { return global.Guide; }), and never Math.random().
 * Exposes window.GenMedia. */
(function (global) {
  "use strict";

  function Guide() { return global.Guide; }
  function colors() { return Guide().colors(); }

  // =========================================================================
  // seeded randomness
  // =========================================================================
  function rng(seed) { return Guide().seededRandom(seed); }

  // One standard normal from a seeded stream (Box–Muller), taking rng first.
  function gauss(r) {
    var u = Math.max(r(), 1e-12), v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // A seeded standard normal pair, for 2-D demos that need both coordinates.
  function gauss2(r) {
    var u = Math.max(r(), 1e-12), v = r();
    var rad = Math.sqrt(-2 * Math.log(u));
    return [rad * Math.cos(2 * Math.PI * v), rad * Math.sin(2 * Math.PI * v)];
  }

  // =========================================================================
  // GenMedia.plot — the canvas widget, modelled on Stats.plot
  // =========================================================================
  function fmtTick(v, step) {
    if (!isFinite(v)) return '';
    if (Math.abs(v) < 1e-12) return '0';
    var digits = 0;
    if (step != null && step < 1) digits = Math.min(6, Math.ceil(-Math.log10(step)));
    var s = v.toFixed(digits);
    if (digits > 0) s = s.replace(/\.?0+$/, '');
    return s;
  }

  function plot(canvas, opts) {
    opts = opts || {};
    var W = opts.W || 640, H = opts.H || 360;
    var xRange = (opts.xRange || [0, 1]).slice(), yRange = (opts.yRange || [0, 1]).slice();
    var padL = opts.padL != null ? opts.padL : (opts.yLabel ? 54 : 44);
    var padR = opts.padR != null ? opts.padR : 16;
    var padT = opts.padT != null ? opts.padT : 14;
    var padB = opts.padB != null ? opts.padB : (opts.xLabel ? 40 : 28);
    var plotW = Math.max(10, W - padL - padR), plotH = Math.max(10, H - padT - padB);
    var clipOn = opts.clip !== false;

    function px(x) { return padL + plotW * (x - xRange[0]) / (xRange[1] - xRange[0]); }
    function py(y) { return padT + plotH * (1 - (y - yRange[0]) / (yRange[1] - yRange[0])); }
    function wx(X) { return xRange[0] + (xRange[1] - xRange[0]) * (X - padL) / plotW; }
    function wy(Y) { return yRange[0] + (yRange[1] - yRange[0]) * (padT + plotH - Y) / plotH; }

    var setup = Guide().setupCanvas(canvas, W, H, function () { if (opts.onResize) opts.onResize(); });
    var ctx = setup.ctx;

    function clear() { ctx.clearRect(0, 0, W, H); }

    function frame() {
      var c = colors();
      ctx.strokeStyle = c.divider; ctx.lineWidth = 1;
      ctx.strokeRect(padL, padT, plotW, plotH);
    }

    function axes(o) {
      o = o || {};
      var c = colors();
      var xTicks = o.xTicks || Guide().niceTicks(xRange[0], xRange[1], o.tickTarget || 6);
      var yTicks = o.yTicks || Guide().niceTicks(yRange[0], yRange[1], o.tickTarget || 5);
      var step = xTicks.length > 1 ? xTicks[1] - xTicks[0] : null;
      if (o.grid !== false) {
        ctx.strokeStyle = c.divider; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
        xTicks.forEach(function (t) { ctx.beginPath(); ctx.moveTo(px(t), padT); ctx.lineTo(px(t), padT + plotH); ctx.stroke(); });
        yTicks.forEach(function (t) { ctx.beginPath(); ctx.moveTo(padL, py(t)); ctx.lineTo(padL + plotW, py(t)); ctx.stroke(); });
        ctx.globalAlpha = 1;
      }
      frame();
      ctx.fillStyle = c.text; ctx.font = '10px ' + c.font;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      xTicks.forEach(function (t) { ctx.fillText(o.xFormat ? o.xFormat(t) : fmtTick(t, step), px(t), padT + plotH + 4); });
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      yTicks.forEach(function (t) { ctx.fillText(o.yFormat ? o.yFormat(t) : fmtTick(t), padL - 6, py(t)); });
      ctx.textBaseline = 'alphabetic';
      if (o.xLabel) { ctx.textAlign = 'center'; ctx.font = '11px ' + c.font; ctx.fillText(o.xLabel, padL + plotW / 2, H - 6); }
      if (o.yLabel) {
        ctx.save(); ctx.translate(13, padT + plotH / 2); ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center'; ctx.font = '11px ' + c.font; ctx.fillText(o.yLabel, 0, 0); ctx.restore();
      }
      return { xTicks: xTicks, yTicks: yTicks };
    }

    function grid(o) {
      o = o || {};
      var c = colors();
      var xTicks = o.xTicks || Guide().niceTicks(xRange[0], xRange[1], o.tickTarget || 6);
      var yTicks = o.yTicks || Guide().niceTicks(yRange[0], yRange[1], o.tickTarget || 5);
      ctx.strokeStyle = o.color || c.divider; ctx.globalAlpha = o.alpha == null ? 0.35 : o.alpha; ctx.lineWidth = 1;
      xTicks.forEach(function (t) { ctx.beginPath(); ctx.moveTo(px(t), padT); ctx.lineTo(px(t), padT + plotH); ctx.stroke(); });
      yTicks.forEach(function (t) { ctx.beginPath(); ctx.moveTo(padL, py(t)); ctx.lineTo(padL + plotW, py(t)); ctx.stroke(); });
      ctx.globalAlpha = 1;
    }

    function withClip(fn) {
      if (!clipOn) { fn(); return; }
      ctx.save(); ctx.beginPath(); ctx.rect(padL, padT, plotW, plotH); ctx.clip(); fn(); ctx.restore();
    }

    function curve(fnOrPoints, o) {
      o = o || {};
      var c = colors();
      var pts;
      if (typeof fnOrPoints === 'function') {
        var n = o.samples || 320;
        pts = [];
        for (var i = 0; i < n; i++) {
          var x = xRange[0] + (xRange[1] - xRange[0]) * i / (n - 1);
          pts.push([x, fnOrPoints(x)]);
        }
      } else { pts = fnOrPoints; }
      ctx.save();
      ctx.strokeStyle = o.color || c.accent; ctx.lineWidth = o.width || 2; ctx.lineJoin = 'round';
      ctx.setLineDash(o.dash || (o.dashed ? [6, 4] : []));
      withClip(function () {
        ctx.beginPath();
        var pen = false;
        for (var k = 0; k < pts.length; k++) {
          var p = pts[k];
          if (!p || !isFinite(p[1]) || !isFinite(p[0])) { pen = false; continue; }
          var X = px(p[0]), Y = py(p[1]);
          if (!pen) { ctx.moveTo(X, Y); pen = true; } else ctx.lineTo(X, Y);
        }
        ctx.stroke();
      });
      ctx.setLineDash([]); ctx.restore();
      return pts;
    }

    function area(fn, a, b, o) {
      o = o || {};
      var c = colors();
      var n = o.samples || 200, pts = [];
      for (var i = 0; i <= n; i++) {
        var x = a + (b - a) * i / n;
        pts.push([x, fn(x)]);
      }
      ctx.save();
      ctx.fillStyle = o.color || 'rgba(43,95,255,0.20)';
      withClip(function () {
        ctx.beginPath();
        ctx.moveTo(px(pts[0][0]), py(Math.max(yRange[0], Math.min(yRange[1], pts[0][1]))));
        for (i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i][0]), py(Math.max(yRange[0], Math.min(yRange[1], pts[i][1]))));
        ctx.lineTo(px(b), py(yRange[0])); ctx.lineTo(px(a), py(yRange[0]));
        ctx.closePath(); ctx.fill();
      });
      ctx.restore();
    }

    function columns(bins, o) {
      o = o || {};
      var c = colors(), base = o.base != null ? o.base : yRange[0];
      ctx.save();
      withClip(function () {
        bins.forEach(function (bn) {
          var x0 = bn.x0 != null ? bn.x0 : bn.x, x1 = bn.x1 != null ? bn.x1 : (bn.x + (bn.w || 0));
          var top = bn.h != null ? bn.h : bn.count;
          if (!isFinite(top) || top <= 0) return;
          ctx.fillStyle = bn.color || o.color || c.accent400;
          ctx.globalAlpha = o.alpha == null ? 0.75 : o.alpha;
          var X0 = px(x0), X1 = px(x1), Y0 = py(base), Y1 = py(top);
          ctx.fillRect(X0, Y1, Math.max(1, X1 - X0), Y0 - Y1);
        });
      });
      ctx.globalAlpha = 1; ctx.restore();
    }

    function points(pts, o) {
      o = o || {};
      var c = colors();
      ctx.save();
      withClip(function () {
        for (var i = 0; i < pts.length; i++) {
          var p = pts[i]; if (!p || !isFinite(p[0]) || !isFinite(p[1])) continue;
          ctx.beginPath();
          ctx.arc(px(p[0]), py(p[1]), o.r || 3, 0, 2 * Math.PI);
          ctx.fillStyle = (o.colors && o.colors[i]) || o.color || c.accent;
          ctx.fill();
          if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.width || 1; ctx.stroke(); }
        }
      });
      ctx.restore();
    }

    function vline(x, o) {
      o = o || {};
      var c = colors();
      ctx.save();
      ctx.strokeStyle = o.color || c.accent2; ctx.lineWidth = o.width || 1.5;
      ctx.setLineDash(o.dash || (o.dashed ? [5, 4] : []));
      withClip(function () { ctx.beginPath(); ctx.moveTo(px(x), padT); ctx.lineTo(px(x), padT + plotH); ctx.stroke(); });
      ctx.setLineDash([]); ctx.restore();
      if (o.label) text(o.label, x, o.labelY != null ? o.labelY : yRange[1], { align: 'center', baseline: 'top', color: o.labelColor || o.color || c.accent2 });
    }

    function hline(y, o) {
      o = o || {};
      var c = colors();
      ctx.save();
      ctx.strokeStyle = o.color || c.accent2; ctx.lineWidth = o.width || 1.5;
      ctx.setLineDash(o.dash || (o.dashed ? [5, 4] : []));
      withClip(function () { ctx.beginPath(); ctx.moveTo(padL, py(y)); ctx.lineTo(padL + plotW, py(y)); ctx.stroke(); });
      ctx.setLineDash([]); ctx.restore();
      if (o.label) text(o.label, o.labelX != null ? o.labelX : xRange[0], y, { align: 'left', baseline: 'bottom', color: o.labelColor || o.color || c.accent2 });
    }

    function text(str, x, y, o) {
      o = o || {};
      var c = colors();
      ctx.save();
      ctx.fillStyle = o.color || c.text; ctx.font = (o.font || (o.size || 11) + 'px ' + c.font);
      ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.baseline || 'alphabetic';
      ctx.fillText(str, px(x) + (o.dx || 0), py(y) + (o.dy || 0));
      ctx.restore();
    }

    function legend(entries, o) {
      o = o || {};
      var c = colors();
      var x = padL + (o.dx != null ? o.dx : 10), y = padT + (o.dy != null ? o.dy : 10);
      ctx.save();
      ctx.font = '11px ' + c.font; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      entries.forEach(function (e, i) {
        var yy = y + i * 15;
        if (e.dash || e.dashed) {
          ctx.strokeStyle = e.color || c.accent; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
          ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + 16, yy); ctx.stroke(); ctx.setLineDash([]);
        } else if (typeof e.color === 'string' && (e.fill || e.swatch)) {
          ctx.fillStyle = e.color; ctx.fillRect(x, yy - 5, 16, 10);
        } else {
          ctx.fillStyle = e.color || c.accent;
          ctx.beginPath(); ctx.arc(x + 8, yy, 4, 0, 2 * Math.PI); ctx.fill();
        }
        ctx.fillStyle = c.text; ctx.fillText(e.label, x + 22, yy);
      });
      ctx.restore();
    }

    function handles(specs, onChange, o) {
      o = o || {};
      var resolve = typeof specs === 'function' ? specs : function () { return specs; };
      function drawHandles() {
        var c = colors();
        resolve().forEach(function (h) {
          ctx.beginPath(); ctx.arc(px(h.x), py(h.y), h.r || 8, 0, 2 * Math.PI);
          ctx.fillStyle = h.color || c.accent2; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
          if (h.label) {
            ctx.fillStyle = h.labelColor || c.text; ctx.font = '12px ' + c.font; ctx.textAlign = 'left';
            ctx.fillText(h.label, px(h.x) + (h.r || 8) + 4, py(h.y) - (h.r || 8) - 2);
          }
        });
      }
      var dh = Guide().dragHandles(canvas, function () {
        return resolve().map(function (h) { return { id: h.id, x: px(h.x), y: py(h.y), r: (h.r || 8) + (o.grab || 6) }; });
      }, function (id, X, Y) { onChange(id, wx(X), wy(Y)); }, { cursor: o.cursor || 'grab' });
      return { draw: drawHandles, destroy: function () { dh.destroy(); } };
    }

    return {
      canvas: canvas, ctx: ctx, W: W, H: H, xRange: xRange, yRange: yRange,
      padL: padL, padR: padR, padT: padT, padB: padB, plotW: plotW, plotH: plotH,
      px: px, py: py, wx: wx, wy: wy,
      clear: clear, frame: frame, axes: axes, grid: grid, curve: curve, area: area,
      columns: columns, points: points, vline: vline, hline: hline,
      text: text, legend: legend, handles: handles,
      resize: setup.resize,
      raw: function (fn) { ctx.save(); fn(ctx); ctx.restore(); }
    };
  }

  // =========================================================================
  // GenMedia.raster — an H×W×C float image on a canvas, nearest-neighbour
  // =========================================================================
  // data is a flat Float64Array-ish array, row-major, values in [0,1],
  // length rows*cols*channels. The widget draws it into a canvas at integer
  // scale with imageSmoothingEnabled = false, so a 16×16 image reads as 16×16
  // crisp pixels rather than a blur, and can overlay a patch grid.
  function raster(canvas, opts) {
    opts = opts || {};
    var cols = opts.cols || 16, rows = opts.rows || opts.cols || 16, ch = opts.channels || 3;
    var W = opts.W || 320, H = opts.H || 320;
    var data = new Array(rows * cols * ch);
    for (var i = 0; i < data.length; i++) data[i] = 0;
    var setup = Guide().setupCanvas(canvas, W, H, function () { if (opts.onResize) opts.onResize(); });
    var ctx = setup.ctx;
    var scratch = (typeof document !== 'undefined' && document.createElement) ? document.createElement('canvas') : null;
    if (scratch) { scratch.width = cols; scratch.height = rows; }

    function idx(x, y, c) { return ((y * cols + x) * ch) + (c || 0); }

    function get(x, y, c) { return data[idx(x, y, c)]; }
    function set(x, y, c, v) { data[idx(x, y, c)] = v; }

    function fill(fn) {
      for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) {
        var rgb = fn(x, y);
        if (rgb == null) continue;
        if (typeof rgb === 'number') { for (var c = 0; c < ch; c++) set(x, y, c, rgb); }
        else { for (var k = 0; k < ch; k++) set(x, y, k, rgb[k]); }
      }
    }

    function fromArray(arr) { for (var i = 0; i < data.length && i < arr.length; i++) data[i] = arr[i]; }
    function toArray() { return data.slice(); }
    function clone() {
      var r = raster(null, { cols: cols, rows: rows, channels: ch, W: W, H: H });
      r.fromArray(data);
      return r;
    }

    function draw() {
      var c = colors();
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = c.divider;
      ctx.fillRect(0, 0, W, H);
      if (!scratch) return;
      var img = scratch.getContext('2d').createImageData(cols, rows);
      for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) {
        var o = (y * cols + x) * 4;
        if (ch >= 3) {
          img.data[o] = Math.round(255 * clamp01(get(x, y, 0)));
          img.data[o + 1] = Math.round(255 * clamp01(get(x, y, 1)));
          img.data[o + 2] = Math.round(255 * clamp01(get(x, y, 2)));
        } else {
          var g = Math.round(255 * clamp01(get(x, y, 0)));
          img.data[o] = g; img.data[o + 1] = g; img.data[o + 2] = g;
        }
        img.data[o + 3] = 255;
      }
      scratch.getContext('2d').putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(scratch, 0, 0, cols, rows, 0, 0, W, H);
      if (opts.patch) patchGrid(opts.patch, opts.patchOpts);
      if (opts.frame !== false) { ctx.strokeStyle = c.divider; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, W - 1, H - 1); }
    }

    function patchGrid(n, o) {
      o = o || {};
      var c = colors();
      n = n || 1;
      var step = W / (cols / n);
      ctx.save();
      ctx.strokeStyle = o.color || 'rgba(255,255,255,0.75)'; ctx.lineWidth = o.width || 1;
      for (var x = 0; x <= cols / n; x++) { var X = Math.round(x * step) + 0.5; ctx.beginPath(); ctx.moveTo(X, 0); ctx.lineTo(X, H); ctx.stroke(); }
      for (var y = 0; y <= rows / n; y++) { var Y = Math.round(y * step) + 0.5; ctx.beginPath(); ctx.moveTo(0, Y); ctx.lineTo(W, Y); ctx.stroke(); }
      ctx.restore();
    }

    // Map a canvas-local logical coordinate (from Guide.hitTest) to a cell.
    function cellAt(x, y) {
      var cx = Math.floor(x / (W / cols)), cy = Math.floor(y / (H / rows));
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return null;
      return { x: cx, y: cy };
    }

    return {
      canvas: canvas, ctx: ctx, cols: cols, rows: rows, channels: ch, W: W, H: H,
      data: data, get: get, set: set, fill: fill, fromArray: fromArray, toArray: toArray,
      clone: clone, draw: draw, patchGrid: patchGrid, cellAt: cellAt, resize: setup.resize
    };
  }

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  // Scale a [0,1] grayscale value to [0,1] with an adjustable contrast window,
  // the standard trick for showing what diffusion actually has at time t.
  function rescale(v, lo, hi) {
    if (hi == null) hi = 1;
    if (lo == null) lo = 0;
    if (hi - lo < 1e-9) return clamp01(v);
    return clamp01((v - lo) / (hi - lo));
  }

  // =========================================================================
  // GenMedia.img — procedural test images (the site ships no local rasters)
  // =========================================================================
  var img = {
    // axis-aligned checkerboard with n cells per side, values 0/1
    checkerboard: function (n, cells) {
      cells = cells || 4;
      var out = new Array(n * n * 3);
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
        var v = (Math.floor(x * cells / n) + Math.floor(y * cells / n)) % 2 ? 1 : 0;
        var k = (y * n + x) * 3;
        out[k] = out[k + 1] = out[k + 2] = v;
      }
      return { w: n, h: n, c: 3, data: out };
    },
    // two-axis linear ramp: R = x, G = y, B = 0.5
    gradient: function (n) {
      var out = new Array(n * n * 3);
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
        var k = (y * n + x) * 3;
        out[k] = x / (n - 1); out[k + 1] = y / (n - 1); out[k + 2] = 0.5;
      }
      return { w: n, h: n, c: 3, data: out };
    },
    // a few soft radial blobs — a stand-in for a "photograph-like" signal
    circles: function (n, seed, count) {
      var r = rng(seed == null ? 7 : seed);
      count = count || 4;
      var cs = [];
      for (var i = 0; i < count; i++) cs.push([r(), r(), 0.10 + 0.16 * r(), r(), r(), r()]);
      var out = new Array(n * n * 3);
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
        var px = (x + 0.5) / n, py = (y + 0.5) / n, acc = [0.06, 0.06, 0.06];
        cs.forEach(function (c) {
          var d = Math.hypot(px - c[0], py - c[1]);
          var a = Math.exp(-(d * d) / (2 * c[2] * c[2]));
          acc[0] += a * c[3]; acc[1] += a * c[4]; acc[2] += a * c[5];
        });
        var k = (y * n + x) * 3;
        out[k] = clamp01(acc[0]); out[k + 1] = clamp01(acc[1]); out[k + 2] = clamp01(acc[2]);
      }
      return { w: n, h: n, c: 3, data: out };
    },
    stripes: function (n, freq) {
      freq = freq || 4;
      var out = new Array(n * n * 3);
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
        var v = 0.5 + 0.5 * Math.sin(2 * Math.PI * freq * x / n);
        var k = (y * n + x) * 3;
        out[k] = out[k + 1] = out[k + 2] = v;
      }
      return { w: n, h: n, c: 3, data: out };
    },
    // seeded white noise, one value per channel
    noise: function (n, seed) {
      var r = rng(seed == null ? 1 : seed), out = new Array(n * n * 3);
      for (var i = 0; i < out.length; i++) out[i] = r();
      return { w: n, h: n, c: 3, data: out };
    },
    // a centred radial ramp — useful where a smooth low-frequency signal helps
    radial: function (n) {
      var out = new Array(n * n * 3);
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
        var d = Math.hypot(x - (n - 1) / 2, y - (n - 1) / 2) / (n / 2);
        var v = clamp01(1 - d);
        var k = (y * n + x) * 3;
        out[k] = out[k + 1] = out[k + 2] = v;
      }
      return { w: n, h: n, c: 3, data: out };
    }
  };

  // =========================================================================
  // GenMedia.net — a seeded tiny MLP with explicit backprop + SGD
  // =========================================================================
  // A deliberately small, fully-connected network used by the "train a real
  // denoiser in the browser" demos. sizes = [in, h1, h2, ..., out]; hidden
  // layers use tanh, the output layer is linear. All randomness comes from a
  // seeded stream, so the same seed gives the same init and the same loss curve.
  function mlp(sizes, seed) {
    var r = rng(seed == null ? 1 : seed);
    var layers = [];
    for (var l = 0; l + 1 < sizes.length; l++) {
      var nin = sizes[l], nout = sizes[l + 1];
      var scale = Math.sqrt(1 / nin);
      var W = [], b = [];
      for (var o = 0; o < nout; o++) {
        var row = [];
        for (var i = 0; i < nin; i++) row.push(scale * gauss(r));
        W.push(row);
        b.push(0);
      }
      layers.push({ W: W, b: b, nin: nin, nout: nout });
    }
    return { sizes: sizes.slice(), layers: layers };
  }

  // forward pass; returns array of pre-activations + activations, t = network-1
  function forward(net, x) {
    var h = x.slice();
    for (var l = 0; l < net.layers.length; l++) {
      var L = net.layers[l], out = [];
      var last = l === net.layers.length - 1;
      for (var o = 0; o < L.nout; o++) {
        var s = L.b[o];
        for (var i = 0; i < L.nin; i++) s += L.W[o][i] * h[i];
        out.push(last ? s : Math.tanh(s));
      }
      h = out;
    }
    return h;
  }

  // One epoch of full-batch SGD over {xs, ys} (arrays of equal-length vectors).
  // Returns the mean squared error at the start of the epoch.
  function sgdStep(net, xs, ys, lr) {
    var L = net.layers.length;
    var gW = [], gb = [];
    for (var l = 0; l < L; l++) {
      gW.push(net.layers[l].W.map(function (row) { return row.map(function () { return 0; }); }));
      gb.push(net.layers[l].b.map(function () { return 0; }));
    }
    var loss = 0, n = xs.length;
    for (var s = 0; s < n; s++) {
      var x = xs[s], y = ys[s];
      var acts = [x], zs = [];
      var h = x;
      for (l = 0; l < L; l++) {
        var Lz = net.layers[l], out = [];
        for (var o = 0; o < Lz.nout; o++) {
          var sum = Lz.b[o];
          for (var i = 0; i < Lz.nin; i++) sum += Lz.W[o][i] * h[i];
          out.push(sum);
        }
        zs.push(out);
        h = (l === L - 1) ? out : out.map(function (v) { return Math.tanh(v); });
        acts.push(h);
        if (l === L - 1) for (i = 0; i < out.length; i++) { var d = out[i] - y[i]; loss += d * d; }
      }
      // backward
      var delta = zs[L - 1].map(function (v, i) { return 2 * (v - y[i]) / n; });
      for (l = L - 1; l >= 0; l--) {
        var lin = acts[l];
        for (o = 0; o < net.layers[l].nout; o++) {
          gb[l][o] += delta[o];
          for (i = 0; i < net.layers[l].nin; i++) gW[l][o][i] += delta[o] * lin[i];
        }
        if (l > 0) {
          var prev = [];
          for (i = 0; i < net.layers[l].nin; i++) {
            var acc = 0;
            for (o = 0; o < net.layers[l].nout; o++) acc += net.layers[l].W[o][i] * delta[o];
            prev.push(acc);
          }
          // tanh derivative at zs[l-1]
          delta = prev.map(function (v, i) { var t = Math.tanh(zs[l - 1][i]); return v * (1 - t * t); });
        }
      }
    }
    for (l = 0; l < L; l++) {
      for (var oo = 0; oo < net.layers[l].nout; oo++) {
        net.layers[l].b[oo] -= lr * gb[l][oo];
        for (var ii = 0; ii < net.layers[l].nin; ii++) net.layers[l].W[oo][ii] -= lr * gW[l][oo][ii];
      }
    }
    return loss / n;
  }

  // Train for `epochs`, returning {loss, losses}. Deterministic for a given
  // net (which is itself seeded), data order and learning rate.
  function train(net, xs, ys, opts) {
    opts = opts || {};
    var lr = opts.lr == null ? 0.05 : opts.lr;
    var epochs = opts.epochs || 200;
    var losses = [];
    for (var e = 0; e < epochs; e++) {
      var loss = sgdStep(net, xs, ys, lr);
      losses.push(loss);
      if (opts.onEpoch) opts.onEpoch(e, loss);
    }
    return { loss: losses[losses.length - 1], losses: losses };
  }

  function paramCount(net) {
    return net.layers.reduce(function (a, L) { return a + L.nout * (L.nin + 1); }, 0);
  }

  var net = { mlp: mlp, forward: forward, sgdStep: sgdStep, train: train, paramCount: paramCount };

  // =========================================================================
  // GenMedia.dsp — waveform synthesis, FFT, STFT, mel, RVQ
  // =========================================================================
  function fft(re, im) {
    var n = re.length;
    for (var i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { var t = re[i]; re[i] = re[j]; re[j] = t; var u = im[i]; im[i] = im[j]; im[j] = u; }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (var k = 0; k < len / 2; k++) {
          var ar = re[i + k], ai = im[i + k];
          var br = re[i + k + len / 2], bi = im[i + k + len / 2];
          var vr = br * cr - bi * ci, vi = br * ci + bi * cr;
          re[i + k] = ar + vr; im[i + k] = ai + vi;
          re[i + k + len / 2] = ar - vr; im[i + k + len / 2] = ai - vi;
          var ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  function hann(n) {
    var w = new Array(n);
    for (var i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    return w;
  }

  // Tone of `n` samples at `freq` Hz, sample rate `sr`, amplitude `amp`.
  function tone(freq, sr, n, amp) {
    amp = amp == null ? 0.8 : amp;
    var out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = amp * Math.sin(2 * Math.PI * freq * i / sr);
    return out;
  }

  function chirp(f0, f1, sr, n, amp) {
    amp = amp == null ? 0.8 : amp;
    var out = new Array(n), phase = 0;
    for (var i = 0; i < n; i++) {
      var f = f0 + (f1 - f0) * i / (n - 1);
      phase += 2 * Math.PI * f / sr;
      out[i] = amp * Math.sin(phase);
    }
    return out;
  }

  function silence(n) { var o = new Array(n); for (var i = 0; i < n; i++) o[i] = 0; return o; }

  function add(a, b) {
    var n = Math.min(a.length, b.length), o = new Array(n);
    for (var i = 0; i < n; i++) o[i] = a[i] + b[i];
    return o;
  }

  function normalize(x) {
    var m = 0;
    for (var i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
    if (m < 1e-12) return x.slice();
    return x.map(function (v) { return v / m; });
  }

  // Short-time Fourier transform. `x` is a signal, opts = {winSize, hop, sr, window}.
  // Returns {mag: [frames][bins], freqs, frames, bins}; bins = winSize/2 + 1.
  function stft(x, opts) {
    opts = opts || {};
    var winSize = opts.winSize || 256;
    var hop = opts.hop || (winSize >> 1);
    var sr = opts.sr || 8000;
    var win = opts.window === 'rect' ? null : hann(winSize);
    var bins = (winSize >> 1) + 1;
    var mag = [], frames = 0;
    for (var start = 0; start + winSize <= x.length; start += hop) {
      var re = new Array(winSize), im = new Array(winSize);
      for (var i = 0; i < winSize; i++) {
        var s = x[start + i];
        re[i] = win ? s * win[i] : s;
        im[i] = 0;
      }
      fft(re, im);
      var row = new Array(bins);
      for (var b = 0; b < bins; b++) row[b] = Math.hypot(re[b], im[b]);
      mag.push(row);
      frames++;
    }
    var freqs = new Array(bins);
    for (b = 0; b < bins; b++) freqs[b] = b * sr / winSize;
    return { mag: mag, freqs: freqs, frames: frames, bins: bins, winSize: winSize, hop: hop, sr: sr };
  }

  // Index of the largest value in an array.
  function argmax(a) {
    var best = 0;
    for (var i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
    return best;
  }

  function hzToMel(hz) { return 2595 * Math.log(1 + hz / 700) / Math.LN10; }
  function melToHz(mel) { return 700 * (Math.pow(10, mel / 2595) - 1); }

  // Triangular mel filterbank over a `bins`-wide magnitude spectrum, each row
  // normalised to sum to one (so a row is an averaging window, not a gain).
  function melFilterbank(nMels, bins, sr, fmin, fmax) {
    nMels = nMels || 20;
    fmin = fmin == null ? 0 : fmin;
    fmax = fmax == null ? sr / 2 : fmax;
    var lo = hzToMel(fmin), hi = hzToMel(fmax);
    var pts = [];
    for (var i = 0; i < nMels + 2; i++) pts.push(melToHz(lo + (hi - lo) * i / (nMels + 1)));
    var filters = [];
    for (i = 0; i < nMels; i++) {
      var f = new Array(bins);
      var left = pts[i], centre = pts[i + 1], right = pts[i + 2];
      var sum = 0;
      for (var b = 0; b < bins; b++) {
        var hz = b * sr / (2 * (bins - 1));
        var v = 0;
        if (hz >= left && hz <= centre && centre > left) v = (hz - left) / (centre - left);
        else if (hz > centre && hz <= right && right > centre) v = (right - hz) / (right - centre);
        f[b] = v; sum += v;
      }
      if (sum > 0) for (b = 0; b < bins; b++) f[b] /= sum;
      filters.push(f);
    }
    return { filters: filters, nMels: nMels, bins: bins };
  }

  // Apply a mel filterbank to one magnitude frame -> nMels energies.
  function melEnergies(frame, bank) {
    var out = new Array(bank.nMels);
    for (var m = 0; m < bank.nMels; m++) {
      var s = 0, f = bank.filters[m];
      for (var b = 0; b < f.length && b < frame.length; b++) s += f[b] * frame[b];
      out[m] = s;
    }
    return out;
  }

  // A full mel spectrogram: STFT, then the filterbank. Returns
  // {frames: [t][mels], nMels, bins, sr, winSize, hop} — what an audio page
  // draws as a heatmap.
  function melSpectrogram(x, opts) {
    opts = opts || {};
    var st = stft(x, opts);
    var bank = melFilterbank(opts.nMels || 24, st.bins, st.sr);
    var frames = st.mag.map(function (f) { return melEnergies(f, bank); });
    return { frames: frames, nMels: bank.nMels, bins: st.bins, sr: st.sr, winSize: st.winSize, hop: st.hop };
  }

  // Short-time RMS energy, the signal a voice-activity detector thresholds.
  function frameEnergy(x, frameSize, hop) {
    frameSize = frameSize || 256; hop = hop || (frameSize >> 1);
    var out = [];
    for (var start = 0; start + frameSize <= x.length; start += hop) {
      var s = 0;
      for (var i = 0; i < frameSize; i++) { var v = x[start + i]; s += v * v; }
      out.push(Math.sqrt(s / frameSize));
    }
    return out;
  }

  // Token rate and bitrate of a neural codec: `frameRate` frames/s, `codebooks`
  // residual stages, `codebookBits` bits per stage. At 75 Hz, 8 books and 10
  // bits this is the EnCodec-style ~6 kbps the audio pages quote.
  function tokenRate(frameRate, codebooks) { return frameRate * codebooks; }
  function bitrateKbps(frameRate, codebooks, codebookBits) {
    return frameRate * codebooks * codebookBits / 1000;
  }

  // Residual vector quantisation with per-stage uniform scalar quantisers.
  // x: array of values (any range; each stage re-fits its own step). Returns
  // {recon, errors:[e0,e1,...], codes:[...]}, where errors[0] is the variance of
  // the input and each further entry is the residual energy after that stage.
  // The errors are strictly decreasing in stages for any non-constant input,
  // because a uniform quantiser of a residual with range R has step R/levels.
  function rvq(x, opts) {
    opts = opts || {};
    var stages = opts.stages || 3;
    var levels = opts.levels || 8;
    var residual = x.slice();
    var recon = x.map(function () { return 0; });
    var errors = [], codes = [];
    errors.push(variance(x, mean(x)));
    for (var s = 0; s < stages; s++) {
      var lo = Infinity, hi = -Infinity;
      for (var i = 0; i < residual.length; i++) { if (residual[i] < lo) lo = residual[i]; if (residual[i] > hi) hi = residual[i]; }
      var step = (hi - lo) / (levels - 1 || 1);
      var stageCodes = [];
      for (i = 0; i < residual.length; i++) {
        var q = step > 0 ? Math.round((residual[i] - lo) / step) : 0;
        q = Math.max(0, Math.min(levels - 1, q));
        var val = lo + q * step;
        stageCodes.push(q);
        recon[i] += val;
        residual[i] -= val;
      }
      codes.push(stageCodes);
      errors.push(variance(residual, mean(residual)));
    }
    return { recon: recon, errors: errors, codes: codes };
  }

  function mean(x) { var s = 0; for (var i = 0; i < x.length; i++) s += x[i]; return x.length ? s / x.length : 0; }
  function variance(x, mu) { var s = 0; for (var i = 0; i < x.length; i++) { var d = x[i] - mu; s += d * d; } return x.length ? s / x.length : 0; }
  function mse(a, b) { var s = 0; for (var i = 0; i < a.length; i++) { var d = a[i] - b[i]; s += d * d; } return a.length ? s / a.length : 0; }

  var dsp = {
    fft: fft, hann: hann, tone: tone, chirp: chirp, silence: silence, add: add, normalize: normalize,
    stft: stft, argmax: argmax, hzToMel: hzToMel, melToHz: melToHz,
    melFilterbank: melFilterbank, melEnergies: melEnergies,
    melSpectrogram: melSpectrogram, frameEnergy: frameEnergy,
    tokenRate: tokenRate, bitrateKbps: bitrateKbps, rvq: rvq,
    mean: mean, variance: variance, mse: mse
  };

  // =========================================================================
  // GenMedia.attn — softmax, cosine similarity, contrastive losses
  // =========================================================================
  function softmax(xs, temperature) {
    temperature = temperature || 1.0;
    var scaled = xs.map(function (x) { return x / temperature; });
    var max = Math.max.apply(null, scaled);
    var exps = scaled.map(function (x) { return Math.exp(x - max); });
    var sum = exps.reduce(function (a, b) { return a + b; }, 0);
    return exps.map(function (e) { return e / sum; });
  }

  function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function normalizeVec(a) { var n = norm(a) || 1; return a.map(function (v) { return v / n; }); }
  function cosine(a, b) { return dot(a, b) / ((norm(a) || 1) * (norm(b) || 1)); }
  function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

  // Similarity matrix S[i][j] = cosine(A[i], B[j]) (or dot products with
  // {dot:true}).
  function simMatrix(A, B, opts) {
    opts = opts || {};
    var out = [];
    for (var i = 0; i < A.length; i++) {
      var row = [];
      for (var j = 0; j < B.length; j++) row.push(opts.dot ? dot(A[i], B[j]) : cosine(A[i], B[j]));
      out.push(row);
    }
    return out;
  }

  // InfoNCE / CLIP loss: -mean_i log softmax(logits[i]/tau)[i], the standard
  // (symmetric) contrastive objective on a square similarity matrix.
  function infoNCE(sim, temperature) {
    var n = sim.length;
    if (!n) return 0;
    var total = 0;
    for (var i = 0; i < n; i++) {
      var p = softmax(sim[i], temperature || 1);
      total += -Math.log(Math.max(p[i], 1e-12));
    }
    return total / n;
  }

  // SigLIP loss: pairwise logistic on the similarity matrix with a learnable
  // bias and temperature, where the diagonal is positive and all else negative.
  // labels: optional 0/1 matrix; defaults to the identity.
  function sigmoidLoss(sim, opts) {
    opts = opts || {};
    var t = opts.temperature == null ? 1 : opts.temperature;
    var bias = opts.bias == null ? 0 : opts.bias;
    var n = sim.length, total = 0, count = 0;
    for (var i = 0; i < n; i++) for (var j = 0; j < sim[i].length; j++) {
      var label = opts.labels ? opts.labels[i][j] : (i === j ? 1 : 0);
      var z = t * sim[i][j] + bias;
      var loss = label === 1 ? Math.log(1 + Math.exp(-z)) : Math.log(1 + Math.exp(z));
      total += loss; count++;
    }
    return count ? total / count : 0;
  }

  // Scaled dot-product attention for one query row against all keys/values.
  function attention(query, keys, values, temperature) {
    var logits = keys.map(function (k) { return dot(query, k); });
    var p = softmax(logits, temperature || 1);
    var d = query.length, out = new Array(d);
    for (var i = 0; i < d; i++) { var s = 0; for (var j = 0; j < values.length; j++) s += p[j] * values[j][i]; out[i] = s; }
    return { weights: p, output: out };
  }

  var attn = {
    softmax: softmax, dot: dot, norm: norm, normalize: normalizeVec, cosine: cosine, sigmoid: sigmoid,
    simMatrix: simMatrix, infoNCE: infoNCE, sigmoidLoss: sigmoidLoss, attention: attention
  };

  // =========================================================================
  // GenMedia.cost — parameter, FLOP and token-budget arithmetic
  // =========================================================================
  // A ViT-style patchifier: n tokens from a square image.
  function patchify(imageSize, patch) {
    var n = Math.floor(imageSize / patch);
    return { tokens: n * n, grid: n };
  }

  // Tokens for a video after a causal 3-D VAE with temporal compression `tComp`
  // (e.g. 4) and spatial compression `sComp` (e.g. 8).
  function videoTokens(frames, height, width, patch, tComp, sComp) {
    tComp = tComp || 4; sComp = sComp || 8;
    var lf = Math.max(1, Math.ceil(frames / tComp));
    var lh = Math.floor(height / sComp), lw = Math.floor(width / sComp);
    var th = Math.floor(lh / patch), tw = Math.floor(lw / patch);
    return { tokens: lf * th * tw, latentFrames: lf, latentH: lh, latentW: lw, gridH: th, gridW: tw };
  }

  function transformerParams(opts) {
    var layers = opts.layers, d = opts.d, ff = opts.ff || (4 * d);
    var perLayer = 4 * d * d /* qkvo */ + 2 * d * ff;
    return layers * perLayer + 2 * d /* final norm + head bias */;
  }

  function transformerFlops(opts) {
    var layers = opts.layers, d = opts.d, ff = opts.ff || (4 * d), seq = opts.seq;
    var attnPart = 2 * 2 * seq * seq * d;
    var projPart = 2 * 4 * seq * d * d;
    var mlpPart = 2 * 2 * seq * d * ff;
    return layers * (attnPart + projPart + mlpPart);
  }

  // UNet-ish parameter count: channel widths per resolution and a rough
  // multi-res block count. Good to a factor the page can reason about.
  function unetParams(opts) {
    var channels = opts.channels || [320, 640, 1280, 1280];
    var blocks = opts.blocks || 2;
    var params = 0;
    for (var i = 0; i < channels.length - 1; i++) {
      var ci = channels[i], co = channels[i + 1];
      params += blocks * (4 * ci * ci + 4 * ci * co) * 9 / 9; /* 3x3 convs */
    }
    return Math.round(params);
  }

  function kvCacheBytes(opts) {
    return 2 * opts.layers * opts.kvHeads * opts.headDim * opts.tokens * (opts.bytes || 2);
  }

  var cost = {
    patchify: patchify, videoTokens: videoTokens,
    transformerParams: transformerParams, transformerFlops: transformerFlops,
    unetParams: unetParams, kvCacheBytes: kvCacheBytes
  };

  // =========================================================================
  // GenMedia.timeline — latency budgets and a full-duplex turn simulator
  // =========================================================================
  // Sum a list of {name, ms} stages and report the total and the running
  // fraction, which is what every latency-budget bar chart needs.
  function budget(stages) {
    var total = stages.reduce(function (a, s) { return a + Math.max(0, s.ms); }, 0);
    var at = 0;
    var segments = stages.map(function (s) {
      var seg = { name: s.name, ms: s.ms, start: at, end: at + Math.max(0, s.ms), color: s.color };
      at += Math.max(0, s.ms);
      return seg;
    });
    return { total: total, segments: segments };
  }

  // A turn-taking simulation. The user speaks for `speechMs`; the assistant may
  // start its reply after `ttft` ms from the end of the user's speech (the
  // interaction budget), and the reply's first audio arrives after `ttsFirstMs`.
  // `bargeInMs` is when the user interrupts, or null. Returns the timeline and
  // the gap the user actually experiences.
  function turn(o) {
    o = o || {};
    var speech = o.speechMs == null ? 2000 : o.speechMs;
    var asr = o.asrMs == null ? 60 : o.asrMs;
    var net = o.netMs == null ? 30 : o.netMs;
    var ttft = o.ttftMs == null ? 120 : o.ttftMs;
    var tts = o.ttsFirstMs == null ? 40 : o.ttsFirstMs;
    var listenEnd = speech;
    var replyStart = listenEnd + net + ttft + tts; /* from speech end */
    var barge = o.bargeInMs == null ? null : o.bargeInMs;
    var interrupted = barge != null && barge > listenEnd && barge < replyStart;
    return {
      speechEnd: listenEnd,
      replyStart: replyStart,
      gapMs: replyStart - listenEnd,
      asrMs: asr, netMs: net, ttftMs: ttft, ttsMs: tts,
      bargeInMs: barge, interrupted: interrupted
    };
  }

  var timeline = { budget: budget, turn: turn };

  // =========================================================================
  // export
  // =========================================================================
  global.GenMedia = {
    rng: rng, gauss: gauss, gauss2: gauss2,
    plot: plot, raster: raster, rescale: rescale, clamp01: clamp01,
    img: img, net: net, dsp: dsp, attn: attn, cost: cost, timeline: timeline
  };
})(window);
