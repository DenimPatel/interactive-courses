/* calc-viz.js — the per-series companion for the /math/ guides, the way
 * serving-sim.js is the companion for /ai/llm-serving/. Loaded after
 * guide-core.js by these pages only.
 *
 * The guide kit gives a page canvas setup, hit-testing, an animation loop and
 * bar/line/heatmap drawing — but its axes have no tick marks or gridlines, there
 * is no log scale, and there is no numerical calculus at all. This file fills
 * both gaps and is deliberately subject-neutral so the genuinely reusable pieces
 * could later be promoted into guide-core.js.
 *
 * Conventions
 *   - Every function takes/returns *data* coordinates. plotAxes returns px/py
 *     (data -> pixel) and ix/iy (pixel -> data), so a page never has to remember
 *     that canvas y grows downward.
 *   - Numeric differentiation uses central differences; every stochastic page
 *     uses Guide.seededRandom, never Math.random().
 *   - Where a demo re-evaluates on every slider input, a closure is returned
 *     rather than a snapshot array (the ServingSim.roofline precedent).
 *
 * Exposes window.CalcViz. Depends on window.Guide for colors()/hitTest() at call
 * time; depends on Plotly only inside surface(). */

(function (global) {
  "use strict";

  var TAU = Math.PI * 2;

  function guideColors(opts) {
    if (opts && opts.colors) return opts.colors;
    if (global.Guide && global.Guide.colors) return global.Guide.colors();
    return { accent: '#2b5fff', accent2: '#d6006c', accent400: '#5d85fd', accent700: '#0b3cd0', text: '#201e1d', divider: '#ccc', font: 'sans-serif' };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  // n points from a to b inclusive. n >= 2.
  function linspace(a, b, n) {
    n = Math.max(2, n | 0);
    var out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = a + (b - a) * i / (n - 1);
    return out;
  }

  // A "nice" axis step: 1, 2 or 5 times a power of ten, at least `span/target`.
  function niceStep(span, target) {
    target = Math.max(1, target || 6);
    var raw = Math.abs(span) / target;
    if (!isFinite(raw) || raw <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = norm <= 1 ? 1 : (norm <= 2 ? 2 : (norm <= 5 ? 5 : 10));
    return step * mag;
  }

  // Format an axis tick without trailing zeros and without exponent noise.
  function fmtTick(v, step) {
    if (!isFinite(v)) return '';
    if (Math.abs(v) < 1e-12) return '0';
    var digits = 0;
    if (step != null && step < 1) digits = Math.min(6, Math.ceil(-Math.log10(step)));
    var s = v.toFixed(digits);
    if (digits > 0) s = s.replace(/\.?0+$/, '');
    return s;
  }

  // ---------------------------------------------------------------------------
  // Axes: gridlines, ticks, labelled axes, and a two-way data<->pixel map.
  // ---------------------------------------------------------------------------
  // plotAxes(ctx, W, H, [x0,x1], [y0,y1], opts) -> {px, py, ix, iy, plot, clear}
  //   opts: {padL, padR, padT, padB, xLabel, yLabel, title, grid, ticks,
  //          tickTarget, logX, logY, colors, spine}
  function plotAxes(ctx, W, H, xRange, yRange, opts) {
    opts = opts || {};
    var c = guideColors(opts);
    var padL = opts.padL != null ? opts.padL : (opts.yLabel ? 52 : 44);
    var padR = opts.padR != null ? opts.padR : 18;
    var padT = opts.padT != null ? opts.padT : (opts.title ? 30 : 14);
    var padB = opts.padB != null ? opts.padB : (opts.xLabel ? 40 : 28);
    var plotW = Math.max(10, W - padL - padR);
    var plotH = Math.max(10, H - padT - padB);
    var logX = !!opts.logX, logY = !!opts.logY;
    var lx0 = logX ? Math.log(Math.max(1e-12, xRange[0])) : xRange[0];
    var lx1 = logX ? Math.log(Math.max(1e-12, xRange[1])) : xRange[1];
    var ly0 = logY ? Math.log(Math.max(1e-12, yRange[0])) : yRange[0];
    var ly1 = logY ? Math.log(Math.max(1e-12, yRange[1])) : yRange[1];
    if (lx1 === lx0) lx1 = lx0 + 1;
    if (ly1 === ly0) ly1 = ly0 + 1;

    function px(x) { var v = logX ? Math.log(Math.max(1e-12, x)) : x; return padL + plotW * (v - lx0) / (lx1 - lx0); }
    function py(y) { var v = logY ? Math.log(Math.max(1e-12, y)) : y; return padT + plotH * (1 - (v - ly0) / (ly1 - ly0)); }
    function ix(X) { return logX ? Math.exp(lx0 + (lx1 - lx0) * (X - padL) / plotW) : lx0 + (lx1 - lx0) * (X - padL) / plotW; }
    function iy(Y) { return logY ? Math.exp(ly0 + (ly1 - ly0) * (padT + plotH - Y) / plotH) : ly0 + (ly1 - ly0) * (padT + plotH - Y) / plotH; }

    ctx.clearRect(0, 0, W, H);
    var plot = { padL: padL, padR: padR, padT: padT, padB: padB, plotW: plotW, plotH: plotH, W: W, H: H, xRange: xRange, yRange: yRange };
    var showTicks = opts.ticks !== false;
    var showGrid = opts.grid !== false;

    // Gridlines + tick labels.
    if (showTicks || showGrid) {
      var tx;
      if (logX) {
        for (var d = Math.floor(Math.log10(xRange[0])); Math.pow(10, d) <= xRange[1]; d++) {
          var xv = Math.pow(10, d);
          if (xv < xRange[0]) continue;
          tx = px(xv);
          if (showGrid) { ctx.strokeStyle = c.divider; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(tx, padT); ctx.lineTo(tx, padT + plotH); ctx.stroke(); ctx.globalAlpha = 1; }
          if (showTicks) { ctx.fillStyle = c.text; ctx.font = '10px ' + c.font; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(fmtTick(xv), tx, padT + plotH + 4); }
        }
      } else {
        var sx = niceStep(xRange[1] - xRange[0], opts.tickTarget);
        for (var xk = Math.ceil(xRange[0] / sx) * sx; xk <= xRange[1] + 1e-9; xk += sx) {
          tx = px(xk);
          if (showGrid) { ctx.strokeStyle = c.divider; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(tx, padT); ctx.lineTo(tx, padT + plotH); ctx.stroke(); ctx.globalAlpha = 1; }
          if (showTicks) { ctx.fillStyle = c.text; ctx.font = '10px ' + c.font; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(fmtTick(xk, sx), tx, padT + plotH + 4); }
        }
      }
      var ty;
      if (logY) {
        for (var e = Math.floor(Math.log10(yRange[0])); Math.pow(10, e) <= yRange[1]; e++) {
          var yv = Math.pow(10, e);
          if (yv < yRange[0]) continue;
          ty = py(yv);
          if (showGrid) { ctx.strokeStyle = c.divider; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(padL, ty); ctx.lineTo(padL + plotW, ty); ctx.stroke(); ctx.globalAlpha = 1; }
          if (showTicks) { ctx.fillStyle = c.text; ctx.font = '10px ' + c.font; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(fmtTick(yv), padL - 6, ty); }
        }
      } else {
        var sy = niceStep(yRange[1] - yRange[0], opts.tickTarget);
        for (var yk = Math.ceil(yRange[0] / sy) * sy; yk <= yRange[1] + 1e-9; yk += sy) {
          ty = py(yk);
          if (showGrid) { ctx.strokeStyle = c.divider; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(padL, ty); ctx.lineTo(padL + plotW, ty); ctx.stroke(); ctx.globalAlpha = 1; }
          if (showTicks) { ctx.fillStyle = c.text; ctx.font = '10px ' + c.font; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(fmtTick(yk, sy), padL - 6, ty); }
        }
      }
    }

    // Spines: the frame, plus a darker axis through the origin when it is visible.
    ctx.strokeStyle = c.divider; ctx.lineWidth = 1;
    ctx.strokeRect(padL, padT, plotW, plotH);
    if (opts.spine !== false) {
      ctx.strokeStyle = c.text; ctx.globalAlpha = 0.55;
      var y0px = py(clamp(0, Math.min(yRange[0], yRange[1]), Math.max(yRange[0], yRange[1])));
      if (0 >= xRange[0] && 0 <= xRange[1]) { ctx.beginPath(); ctx.moveTo(padL, y0px); ctx.lineTo(padL + plotW, y0px); ctx.stroke(); }
      var x0px = px(clamp(0, Math.min(xRange[0], xRange[1]), Math.max(xRange[0], xRange[1])));
      if (0 >= yRange[0] && 0 <= yRange[1]) { ctx.beginPath(); ctx.moveTo(x0px, padT); ctx.lineTo(x0px, padT + plotH); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }

    // Labels.
    ctx.fillStyle = c.text; ctx.font = '11px ' + c.font; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    if (opts.xLabel) ctx.fillText(opts.xLabel, padL + plotW / 2, H - 6);
    if (opts.title) { ctx.font = '600 12px ' + c.font; ctx.textAlign = 'left'; ctx.fillText(opts.title, padL, Math.max(12, padT - 8)); }
    if (opts.yLabel) {
      ctx.save(); ctx.translate(14, padT + plotH / 2); ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.fillText(opts.yLabel, 0, 0); ctx.restore();
    }
    return { px: px, py: py, ix: ix, iy: iy, plot: plot, clear: function () { ctx.clearRect(0, 0, W, H); } };
  }

  // ---------------------------------------------------------------------------
  // Plotting a function. Breaks the path on non-finite values and on jumps
  // larger than opts.jumpFrac of the y-range (a discontinuity), so 1/x does not
  // draw a vertical line through zero.
  // ---------------------------------------------------------------------------
  function plotFunction(axes, f, opts) {
    opts = opts || {};
    var c = guideColors(opts);
    var ctx = opts.ctx;
    var p = axes.plot;
    var n = opts.samples || 480;
    var x0 = p.xRange[0], x1 = p.xRange[1];
    var span = Math.abs(p.yRange[1] - p.yRange[0]);
    var jump = (opts.jumpFrac != null ? opts.jumpFrac : 0.6) * span;
    var pts = [];
    for (var i = 0; i < n; i++) {
      var x = x0 + (x1 - x0) * i / (n - 1);
      var y = f(x);
      if (isNum(y)) pts.push({ x: x, y: y });
      else pts.push(null);
    }
    if (ctx) {
      ctx.strokeStyle = opts.color || c.accent;
      ctx.lineWidth = opts.width || 2;
      ctx.lineJoin = 'round';
      ctx.setLineDash(opts.dashed ? [6, 4] : (opts.dash || []));
      ctx.beginPath();
      var pen = false, prev = null;
      for (i = 0; i < pts.length; i++) {
        var pt = pts[i];
        if (!pt) { pen = false; prev = null; continue; }
        if (prev && jump > 0 && Math.abs(pt.y - prev.y) > jump) pen = false;
        var X = axes.px(pt.x), Y = axes.py(pt.y);
        if (!pen) { ctx.moveTo(X, Y); pen = true; } else ctx.lineTo(X, Y);
        prev = pt;
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    return pts;
  }

  // ---------------------------------------------------------------------------
  // Numerical calculus. Central differences throughout.
  // ---------------------------------------------------------------------------
  function defaultStep(x) { return 1e-5 * Math.max(1, Math.abs(x)); }

  function numericDeriv(f, x, h) {
    h = h || defaultStep(x);
    return (f(x + h) - f(x - h)) / (2 * h);
  }

  // Closed-form-free derivative as a reusable function: var d = CalcViz.derivative(f).
  function derivative(f, h) { return function (x) { return numericDeriv(f, x, h); }; }

  function numericGrad(f, x, h) {
    var n = x.length, g = new Array(n);
    for (var i = 0; i < n; i++) {
      var hi = h || defaultStep(x[i]);
      var xp = x.slice(), xm = x.slice();
      xp[i] += hi; xm[i] -= hi;
      g[i] = (f(xp) - f(xm)) / (2 * hi);
    }
    return g;
  }

  function gradient(f, h) { return function (x) { return numericGrad(f, x, h); }; }

  function numericHess(f, x, h) {
    var n = x.length;
    var f0 = f(x);
    var H = [];
    for (var i = 0; i < n; i++) { H.push(new Array(n).fill(0)); }
    var steps = new Array(n);
    for (i = 0; i < n; i++) steps[i] = h || defaultStep(x[i]);
    for (i = 0; i < n; i++) {
      var hi = steps[i], xp = x.slice(), xm = x.slice();
      xp[i] += hi; xm[i] -= hi;
      H[i][i] = (f(xp) - 2 * f0 + f(xm)) / (hi * hi);
      for (var j = i + 1; j < n; j++) {
        var hj = steps[j];
        var a = x.slice(), b = x.slice(), c2 = x.slice(), d = x.slice();
        a[i] += hi; a[j] += hj;
        b[i] += hi; b[j] -= hj;
        c2[i] -= hi; c2[j] += hj;
        d[i] -= hi; d[j] -= hj;
        var v = (f(a) - f(b) - f(c2) + f(d)) / (4 * hi * hj);
        H[i][j] = v; H[j][i] = v;
      }
    }
    return H;
  }

  function hessian(f, h) { return function (x) { return numericHess(f, x, h); }; }

  // tangentLine(f, a) -> {a, slope, value, at(x), fPrime}
  //   Linearisation of f at a. `at` is the tangent's y-value, `fPrime` is the
  //   numeric derivative as a callable function.
  function tangentLine(f, a) {
    var m = numericDeriv(f, a), y0 = f(a);
    return {
      a: a, slope: m, value: y0,
      at: function (x) { return y0 + m * (x - a); },
      fPrime: derivative(f),
      label: 'tangent'
    };
  }

  // secantLine(f, a, b) -> {a, b, slope, at(x)}
  function secantLine(f, a, b) {
    var fa = f(a), fb = f(b);
    var m = (fb - fa) / (b - a);
    return { a: a, b: b, slope: m, at: function (x) { return fa + m * (x - a); }, label: 'secant' };
  }

  // ---------------------------------------------------------------------------
  // Taylor polynomials. Derivatives are taken numerically unless opts.derivs
  // (the exact derivatives at a: [f(a), f'(a), f''(a), ...]) is supplied.
  // ---------------------------------------------------------------------------
  function nthDeriv(f, a, k, h) {
    h = h || 0.5 * Math.pow(1e-2, 1 / (k + 1)) * Math.max(1, Math.abs(a));
    // Central finite-difference coefficients for small orders; adequate for the
    // display polynomial. Supply opts.derivs for exactness.
    if (k === 0) return f(a);
    if (k === 1) return (f(a + h) - f(a - h)) / (2 * h);
    if (k === 2) return (f(a + h) - 2 * f(a) + f(a - h)) / (h * h);
    if (k === 3) return (f(a + 2 * h) - 2 * f(a + h) + 2 * f(a - h) - f(a - 2 * h)) / (2 * h * h * h);
    if (k === 4) return (f(a + 2 * h) - 4 * f(a + h) + 6 * f(a) - 4 * f(a - h) + f(a - 2 * h)) / (h * h * h * h);
    // Fallback: differentiate the (k-1)th central difference numerically.
    var g = function (t) { return nthDeriv(f, t, k - 1, h * 1.2); };
    return (g(a + h) - g(a - h)) / (2 * h);
  }

  function taylorCoeffs(f, a, order, opts) {
    opts = opts || {};
    var exact = opts.derivs;
    var coeffs = [], k, fact = 1;
    for (k = 0; k <= order; k++) {
      if (k > 0) fact *= k;
      var dk = (exact && exact[k] != null) ? exact[k] : nthDeriv(f, a, k, opts.h);
      coeffs.push(dk / fact);
    }
    return coeffs;
  }

  function evalPoly(coeffs, x) {
    var y = 0;
    for (var i = coeffs.length - 1; i >= 0; i--) y = y * x + coeffs[i];
    return y;
  }

  // ---------------------------------------------------------------------------
  // Integration / ODEs.
  // ---------------------------------------------------------------------------
  // riemannSum(f, a, b, n, rule) -> {sum, pieces:[{x0,x1,y0,y1,area}], n, rule}
  //   rule: 'left' | 'right' | 'mid' | 'trapezoid'. Rectangles have y0 = 0;
  //   trapezoids carry both sample heights, so a caller draws either as a quad.
  function riemannSum(f, a, b, n, rule) {
    rule = rule || 'mid';
    n = Math.max(1, n | 0);
    var dx = (b - a) / n, pieces = [], sum = 0;
    for (var i = 0; i < n; i++) {
      var x0 = a + i * dx, x1 = x0 + dx, y0, y1;
      if (rule === 'left') { y0 = f(x0); y1 = y0; }
      else if (rule === 'right') { y0 = f(x1); y1 = y0; }
      else if (rule === 'trapezoid') { y0 = f(x0); y1 = f(x1); }
      else { var ym = f((x0 + x1) / 2); y0 = ym; y1 = ym; }
      var area = (y0 + y1) / 2 * dx;
      sum += area;
      pieces.push({ x0: x0, x1: x1, y0: y0, y1: y1, area: area });
    }
    return { sum: sum, pieces: pieces, n: n, rule: rule, a: a, b: b };
  }

  // integrate(f, y0, t0, t1, dt, method) -> {times, values, step, method}
  //   Solves the ODE y' = f(t, y). method: 'euler' | 'midpoint' | 'rk4'.
  function integrate(f, y0, t0, t1, dt, method) {
    method = method || 'rk4';
    dt = dt || (t1 - t0) / 200;
    var dir = t1 >= t0 ? 1 : -1;
    dt = Math.abs(dt) * dir;
    var times = [t0], values = [y0];
    var t = t0, y = y0, guard = 0;
    while ((dir > 0 ? t < t1 - 1e-12 : t > t1 + 1e-12) && guard++ < 2e6) {
      var h = Math.abs(dt) > Math.abs(t1 - t) ? (t1 - t) : dt;
      if (method === 'euler') {
        y = y + h * f(t, y);
      } else if (method === 'midpoint') {
        var k1 = f(t, y);
        var km = f(t + h / 2, y + h / 2 * k1);
        y = y + h * km;
      } else {
        var a = f(t, y);
        var b = f(t + h / 2, y + h / 2 * a);
        var c = f(t + h / 2, y + h / 2 * b);
        var d = f(t + h, y + h * c);
        y = y + h / 6 * (a + 2 * b + 2 * c + d);
      }
      t = t + h;
      times.push(t); values.push(y);
    }
    return { times: times, values: values, step: dt, method: method };
  }

  // ---------------------------------------------------------------------------
  // Contours: marching squares over a sampled grid, one polyline set per level.
  // Returns {levels, segments:[{level, x0,y0,x1,y1}], gridX, gridY, values}.
  // ---------------------------------------------------------------------------
  function contourData(f, domain, levels, opts) {
    opts = opts || {};
    var nx = opts.nx || 100, ny = opts.ny || 100;
    var xs = linspace(domain.x[0], domain.x[1], nx);
    var ys = linspace(domain.y[0], domain.y[1], ny);
    var vals = [], i, j, min = Infinity, max = -Infinity;
    for (i = 0; i < ny; i++) {
      var row = new Array(nx);
      for (j = 0; j < nx; j++) {
        var v = f(xs[j], ys[i]);
        row[j] = isNum(v) ? v : NaN;
        if (row[j] < min) min = row[j];
        if (row[j] > max) max = row[j];
      }
      vals.push(row);
    }
    if (!levels || !levels.length) {
      var k = opts.count || 8;
      levels = [];
      for (i = 1; i <= k; i++) levels.push(min + (max - min) * i / (k + 1));
    }
    var segments = [];
    function edge(p0, v0, p1, v1, level) {
      if (!isNum(v0) || !isNum(v1)) return null;
      if ((v0 < level) === (v1 < level)) return null;
      var t = (level - v0) / (v1 - v0);
      return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
    }
    for (i = 0; i < ny - 1; i++) {
      for (j = 0; j < nx - 1; j++) {
        var x0 = xs[j], x1 = xs[j + 1], y0 = ys[i], y1 = ys[i + 1];
        var v00 = vals[i][j], v10 = vals[i][j + 1], v11 = vals[i + 1][j + 1], v01 = vals[i + 1][j];
        if (!isNum(v00) || !isNum(v10) || !isNum(v11) || !isNum(v01)) continue;
        for (var li = 0; li < levels.length; li++) {
          var L = levels[li];
          var pts = [];
          var c0 = edge([x0, y0], v00, [x1, y0], v10, L); if (c0) pts.push(c0);
          var c1 = edge([x1, y0], v10, [x1, y1], v11, L); if (c1) pts.push(c1);
          var c2 = edge([x1, y1], v11, [x0, y1], v01, L); if (c2) pts.push(c2);
          var c3 = edge([x0, y1], v01, [x0, y0], v00, L); if (c3) pts.push(c3);
          if (pts.length === 2) {
            segments.push({ level: L, x0: pts[0][0], y0: pts[0][1], x1: pts[1][0], y1: pts[1][1] });
          } else if (pts.length === 4) {
            // A saddle cell. Pair crossings consistently: if the cell centre is
            // above the level, connect the first two and the last two; else the
            // other way. Either choice is locally correct.
            var centreAbove = (v00 + v10 + v11 + v01) / 4 > L;
            var pairs = centreAbove ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]];
            for (var pi = 0; pi < 2; pi++) {
              var A = pts[pairs[pi][0]], B = pts[pairs[pi][1]];
              segments.push({ level: L, x0: A[0], y0: A[1], x1: B[0], y1: B[1] });
            }
          }
        }
      }
    }
    return { levels: levels, segments: segments, gridX: xs, gridY: ys, values: vals, min: min, max: max };
  }

  function contourField(ctx, f, domain, levels, opts) {
    opts = opts || {};
    var c = guideColors(opts);
    var axes = opts.axes;
    var data = contourData(f, domain, levels, opts);
    if (opts.shade !== false) {
      // Fill each contour band by sampling colour on a coarse grid.
      var nx = opts.nx || 100, ny = opts.ny || 100;
      var lo = opts.colorLow || hexToRgb(c.accent400), hi = opts.colorHigh || hexToRgb(c.accent700);
      var vmin = data.min, vmax = data.max;
      for (var i = 0; i < ny - 1; i++) {
        for (var j = 0; j < nx - 1; j++) {
          var v = data.values[i][j];
          if (!isNum(v)) continue;
          var t = vmax === vmin ? 0 : (v - vmin) / (vmax - vmin);
          ctx.fillStyle = 'rgb(' + Math.round(lerp(lo[0], hi[0], t)) + ',' + Math.round(lerp(lo[1], hi[1], t)) + ',' + Math.round(lerp(lo[2], hi[2], t)) + ')';
          var xA = axes.px(data.gridX[j]), yA = axes.py(data.gridY[i + 1]);
          var xB = axes.px(data.gridX[j + 1]) + 1, yB = axes.py(data.gridY[i]) + 1;
          ctx.fillRect(xA, yA, xB - xA, yB - yA);
        }
      }
    }
    var byLevel = {};
    data.segments.forEach(function (s) {
      (byLevel[s.level] = byLevel[s.level] || []).push(s);
    });
    ctx.lineWidth = opts.width || 1;
    Object.keys(byLevel).forEach(function (key) {
      var segs = byLevel[key];
      var t = (parseFloat(key) - data.min) / Math.max(1e-12, data.max - data.min);
      ctx.strokeStyle = opts.lineColor || 'rgba(32,30,29,0.45)';
      ctx.globalAlpha = lerp(0.35, 0.85, clamp(t, 0, 1));
      ctx.beginPath();
      segs.forEach(function (s) { ctx.moveTo(axes.px(s.x0), axes.py(s.y0)); ctx.lineTo(axes.px(s.x1), axes.py(s.y1)); });
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
    data.byLevel = byLevel;
    return data;
  }

  function hexToRgb(hex) {
    if (!hex) return [43, 95, 255];
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  // ---------------------------------------------------------------------------
  // Vector fields.
  // ---------------------------------------------------------------------------
  // vectorField(ctx, F, domain, opts) -> {grid, scale, magnitude(p)}
  //   F(x, y) -> [vx, vy]. opts: {axes, nx, ny, normalize, color, colorByMag,
  //   scale, minMag, arrows, head}
  function vectorField(ctx, F, domain, opts) {
    opts = opts || {};
    var c = guideColors(opts);
    var axes = opts.axes;
    var nx = opts.nx || 20, ny = opts.ny || 14;
    var xs = linspace(domain.x[0], domain.x[1], nx);
    var ys = linspace(domain.y[0], domain.y[1], ny);
    var arrowLen = opts.arrowLen || 12;
    var mags = [], i, j;
    var grid = [];
    for (i = 0; i < ny; i++) {
      var row = [];
      for (j = 0; j < nx; j++) {
        var v = F(xs[j], ys[i]);
        var vx = isNum(v[0]) ? v[0] : 0, vy = isNum(v[1]) ? v[1] : 0;
        var m = Math.hypot(vx, vy);
        mags.push(m);
        row.push({ x: xs[j], y: ys[i], vx: vx, vy: vy, m: m });
      }
      grid.push(row);
    }
    var maxM = Math.max.apply(null, mags) || 1;
    var minM = Math.min.apply(null, mags);
    grid.forEach(function (row) {
      row.forEach(function (g) {
        if (g.m < (opts.minMag || 1e-9)) return;
        var t = g.m / maxM;
        var ux = g.vx / g.m, uy = g.vy / g.m;
        var scale = opts.normalize ? arrowLen : arrowLen * t;
        if (opts.scale) scale = opts.scale(g.m, g.x, g.y);
        var X0 = axes.px(g.x), Y0 = axes.py(g.y);
        var X1 = X0 + ux * scale, Y1 = Y0 - uy * scale; // canvas y is down
        ctx.strokeStyle = opts.color || (opts.colorByMag === false ? c.accent700 : rgbLerp(hexToRgb(c.accent700), hexToRgb(c.accent2), clamp(t, 0, 1)));
        ctx.lineWidth = opts.width || 1.4;
        ctx.globalAlpha = opts.alpha != null ? opts.alpha : 0.85;
        ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); ctx.stroke();
        if (opts.head !== false && scale > 2.5) {
          var hs = Math.min(6, scale * 0.35);
          var ang = Math.atan2(Y1 - Y0, X1 - X0);
          ctx.beginPath();
          ctx.moveTo(X1, Y1);
          ctx.lineTo(X1 - hs * Math.cos(ang - 0.4), Y1 - hs * Math.sin(ang - 0.4));
          ctx.lineTo(X1 - hs * Math.cos(ang + 0.4), Y1 - hs * Math.sin(ang + 0.4));
          ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
        }
        ctx.globalAlpha = 1;
      });
    });
    return { grid: grid, scale: maxM, min: minM, magnitude: function (x, y) { var v = F(x, y); return Math.hypot(v[0], v[1]); } };
  }

  function rgbLerp(a, b, t) {
    return 'rgb(' + Math.round(lerp(a[0], b[0], t)) + ',' + Math.round(lerp(a[1], b[1], t)) + ',' + Math.round(lerp(a[2], b[2], t)) + ')';
  }

  // streamline(F, p0, steps, dt, opts) -> [points]. RK4 along the unit field.
  //   opts: {domain, dir(1|-1), stopMag}
  function streamline(F, p0, steps, dt, opts) {
    opts = opts || {};
    steps = steps || 400; dt = dt || 0.08;
    var dir = opts.dir || 1, pts = [{ x: p0[0], y: p0[1] }];
    var p = [p0[0], p0[1]];
    function unit(q) {
      var v = F(q[0], q[1]);
      var m = Math.hypot(v[0], v[1]);
      if (!isNum(m) || m < (opts.stopMag || 1e-6)) return null;
      return [v[0] / m * dir, v[1] / m * dir];
    }
    for (var i = 0; i < steps; i++) {
      var k1 = unit(p); if (!k1) break;
      var k2 = unit([p[0] + dt / 2 * k1[0], p[1] + dt / 2 * k1[1]]); if (!k2) break;
      var k3 = unit([p[0] + dt / 2 * k2[0], p[1] + dt / 2 * k2[1]]); if (!k3) break;
      var k4 = unit([p[0] + dt * k3[0], p[1] + dt * k3[1]]); if (!k4) break;
      p = [
        p[0] + dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
        p[1] + dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])
      ];
      if (opts.domain) {
        if (p[0] < opts.domain.x[0] || p[0] > opts.domain.x[1] || p[1] < opts.domain.y[0] || p[1] > opts.domain.y[1]) break;
      }
      pts.push({ x: p[0], y: p[1] });
    }
    return pts;
  }

  // ---------------------------------------------------------------------------
  // Draggable points, built on Guide.hitTest (which maps pointer events back
  // into logical canvas units). Handles are returned by getHandles() in logical
  // canvas pixels: [{x, y, r, id}]. onDrag(handle, phase, point, ev) fires with
  // phase 'start' | 'move' | 'end'.
  // ---------------------------------------------------------------------------
  function dragPoint(canvas, getHandles, onDrag) {
    if (!global.Guide || !global.Guide.hitTest) throw new Error('CalcViz.dragPoint requires guide-core.js');
    var active = null;
    canvas.style.touchAction = 'none';
    function pick(ev) {
      var h = global.Guide.hitTest(canvas, ev);
      var hs = getHandles() || [];
      var best = null, bd = Infinity;
      hs.forEach(function (hd) {
        var r = hd.r || 16;
        var d = Math.hypot(h.x - hd.x, h.y - hd.y);
        if (d <= r && d < bd) { bd = d; best = hd; }
      });
      return best ? { handle: best, point: h } : null;
    }
    function down(ev) {
      var hit = pick(ev);
      if (!hit) return;
      active = hit.handle;
      if (ev.preventDefault) ev.preventDefault();
      onDrag(hit.handle, 'start', hit.point, ev);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    }
    function move(ev) {
      if (!active) return;
      if (ev.preventDefault) ev.preventDefault();
      var h = global.Guide.hitTest(canvas, ev);
      onDrag(active, 'move', h, ev);
    }
    function up(ev) {
      if (!active) return;
      var h = global.Guide.hitTest(canvas, ev);
      onDrag(active, 'end', h, ev);
      active = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    }
    canvas.addEventListener('pointerdown', down);
    return { active: function () { return active; } };
  }

  // ---------------------------------------------------------------------------
  // Plotly surface trace for z = f(x, y), to pair with GuidePlot3D.baseLayout.
  // surface(f, {x:[x0,x1], y:[y0,y1]}, n, opts) -> a type:'surface' trace.
  // ---------------------------------------------------------------------------
  function surface(f, domain, n, opts) {
    opts = opts || {};
    n = n || 48;
    var xs = linspace(domain.x[0], domain.x[1], n);
    var ys = linspace(domain.y[0], domain.y[1], n);
    var z = [];
    for (var i = 0; i < n; i++) {
      var row = new Array(n);
      for (var j = 0; j < n; j++) {
        var v = f(xs[j], ys[i]);
        row[j] = isNum(v) ? v : null;
      }
      z.push(row);
    }
    return {
      type: 'surface', x: xs, y: ys, z: z,
      colorscale: opts.colorscale || 'Portland',
      showscale: opts.showscale === true,
      opacity: opts.opacity != null ? opts.opacity : 1,
      contours: opts.contours || { z: { show: false } },
      hovertemplate: opts.hovertemplate || 'x %{x:.2f}<br>y %{y:.2f}<br>z %{z:.3f}<extra></extra>'
    };
  }

  global.CalcViz = {
    // geometry / axes
    plotAxes: plotAxes, plotFunction: plotFunction, linspace: linspace,
    clamp: clamp, lerp: lerp, niceStep: niceStep, hexToRgb: hexToRgb,
    // numeric calculus
    numericDeriv: numericDeriv, derivative: derivative,
    numericGrad: numericGrad, gradient: gradient,
    numericHess: numericHess, hessian: hessian,
    tangentLine: tangentLine, secantLine: secantLine,
    taylorCoeffs: taylorCoeffs, evalPoly: evalPoly,
    riemannSum: riemannSum, integrate: integrate,
    // fields
    contourData: contourData, contourField: contourField,
    vectorField: vectorField, streamline: streamline,
    // interaction / 3D
    dragPoint: dragPoint, surface: surface,
    TAU: TAU
  };
})(window);
