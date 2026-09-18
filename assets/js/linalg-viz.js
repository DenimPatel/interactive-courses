/* linalg-viz.js — the domain layer for the Linear Algebra guide.
 *
 * Two things live here, neither of which belongs in the subject-neutral kit:
 *
 *   1. LinAlg.plane — one reusable 2D cartesian canvas surface built on
 *      Guide.setupCanvas. Most demos in Acts I–III are a plane plus two or
 *      three draws. Methods map world <-> pixel, draw axes/grid/vectors/
 *      polygons/ellipses/points/spans and bind draggable world-coordinate
 *      handles through Guide.dragHandles.
 *
 *   2. LinAlg.mat — an N-dimensional matrix library (GuideMath.add/sub/dot/
 *      cross/matVec are hard-coded to 3 components). Arrays-of-rows throughout,
 *      matching GuideMath. LU, determinant, inverse, solve, Gram–Schmidt, QR,
 *      least squares, symmetric eigen, closed-form 2x2 eigen, one-sided Jacobi
 *      SVD, pseudoinverse, rank/null/column spaces, condition number and power
 *      iteration. Plus live matrix rendering helpers.
 *
 * Load after guide-core.js and guide-math.js, before any page-specific script.
 * Exposes window.LinAlg. */
(function (global) {
  "use strict";

  function Guide() { return global.Guide; }
  function GM() { return global.GuideMath; }
  function colors() { return Guide().colors(); }

  // =========================================================================
  // small N-dimensional vector helpers (local; GuideMath's are 3-D only)
  // =========================================================================
  function vdot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  function vnorm(a) { return Math.sqrt(vdot(a, a)); }
  function vscale(a, k) { return a.map(function (x) { return x * k; }); }
  function vsub(a, b) { return a.map(function (x, i) { return x - b[i]; }); }
  function vadd(a, b) { return a.map(function (x, i) { return x + b[i]; }); }
  function vnormalize(a) { var n = vnorm(a) || 1; return vscale(a, 1 / n); }

  // =========================================================================
  // matrix primitives — array-of-rows
  // =========================================================================
  function identity(n) {
    var A = [];
    for (var i = 0; i < n; i++) { var row = []; for (var j = 0; j < n; j++) row.push(i === j ? 1 : 0); A.push(row); }
    return A;
  }
  function zeros(m, n) {
    var A = [];
    for (var i = 0; i < m; i++) { var row = []; for (var j = 0; j < n; j++) row.push(0); A.push(row); }
    return A;
  }
  function clone(A) { return A.map(function (row) { return row.slice(); }); }
  function transpose(A) {
    var m = A.length, n = A[0].length, T = zeros(n, m);
    for (var i = 0; i < m; i++) for (var j = 0; j < n; j++) T[j][i] = A[i][j];
    return T;
  }
  function add(A, B) { return A.map(function (row, i) { return row.map(function (x, j) { return x + B[i][j]; }); }); }
  function scaleMat(A, k) { return A.map(function (row) { return row.map(function (x) { return x * k; }); }); }
  function mul(A, B) {
    var m = A.length, n = B[0].length, p = B.length;
    var C = zeros(m, n);
    for (var i = 0; i < m; i++) for (var j = 0; j < n; j++) { var s = 0; for (var k = 0; k < p; k++) s += A[i][k] * B[k][j]; C[i][j] = s; }
    return C;
  }
  function mulVec(A, v) { return A.map(function (row) { return vdot(row, v); }); }
  function lerpMat(A, B, t) { return A.map(function (row, i) { return row.map(function (x, j) { return x + (B[i][j] - x) * t; }); }); }

  // LU with partial pivoting. P*A = L*U (L unit lower, U upper). `swaps` counts
  // row exchanges (for the determinant sign). `singular` flags a zero pivot.
  function lu(Ain) {
    var A = clone(Ain), m = A.length, n = A[0].length;
    var L = zeros(m, n), U = zeros(m, n);
    var piv = []; for (var i = 0; i < m; i++) piv.push(i);
    var swaps = 0, singular = false;
    var kk = Math.min(m, n);
    for (var k = 0; k < kk; k++) {
      var p = k;
      for (i = k + 1; i < m; i++) if (Math.abs(A[i][k]) > Math.abs(A[p][k])) p = i;
      if (Math.abs(A[p][k]) < 1e-13) singular = true;
      if (p !== k) { var tr = A[p]; A[p] = A[k]; A[k] = tr; var tp = piv[p]; piv[p] = piv[k]; piv[k] = tp; swaps++; }
      if (Math.abs(A[k][k]) < 1e-300) continue;
      for (i = k + 1; i < m; i++) {
        var f = A[i][k] / A[k][k];
        L[i][k] = f;
        for (var j = k; j < n; j++) A[i][j] -= f * A[k][j];
      }
    }
    for (i = 0; i < m; i++) {
      L[i][i] = 1;
      for (j = 0; j < n; j++) if (j >= i) U[i][j] = A[i][j];
    }
    var P = [];
    for (i = 0; i < m; i++) { var row = []; for (j = 0; j < m; j++) row.push(0); row[piv[i]] = 1; P.push(row); }
    return { L: L, U: U, P: P, swaps: swaps, singular: singular };
  }

  function det(A) {
    var n = A.length;
    if (!n || A[0].length !== n) return NaN;
    var r = lu(A), d = 1;
    for (var i = 0; i < n; i++) d *= r.U[i][i];
    return (r.swaps % 2 ? -d : d);
  }

  // Gauss–Jordan inverse. Returns null if singular.
  function inverse(Ain) {
    var n = Ain.length;
    var M = clone(Ain), I = identity(n);
    for (var col = 0; col < n; col++) {
      var p = col;
      for (var i = col + 1; i < n; i++) if (Math.abs(M[i][col]) > Math.abs(M[p][col])) p = i;
      if (Math.abs(M[p][col]) < 1e-12) return null;
      if (p !== col) { var t = M[p]; M[p] = M[col]; M[col] = t; var ti = I[p]; I[p] = I[col]; I[col] = ti; }
      var d = M[col][col];
      for (var j = 0; j < n; j++) { M[col][j] /= d; I[col][j] /= d; }
      for (i = 0; i < n; i++) {
        if (i === col) continue;
        var f = M[i][col];
        if (f === 0) continue;
        for (j = 0; j < n; j++) { M[i][j] -= f * M[col][j]; I[i][j] -= f * I[col][j]; }
      }
    }
    return I;
  }

  function solve(A, b) {
    var n = A.length;
    var r = lu(A);
    if (r.singular) return null;
    var Pb = mulVec(r.P, b);
    var y = new Array(n).fill(0);
    for (var i = 0; i < n; i++) { var s = Pb[i]; for (var j = 0; j < i; j++) s -= r.L[i][j] * y[j]; y[i] = s / r.L[i][i]; }
    var x = new Array(n).fill(0);
    for (i = n - 1; i >= 0; i--) { var s2 = y[i]; for (j = i + 1; j < n; j++) s2 -= r.U[i][j] * x[j]; x[i] = s2 / r.U[i][i]; }
    return x;
  }

  // Classical or modified Gram–Schmidt. Returns {basis (orthonormal, array of
  // vectors), steps:[{input, coeffs, ortho, norm}]} so a page can animate the
  // subtraction one vector at a time.
  function gramSchmidt(vs, opts) {
    opts = opts || {};
    var modified = opts.modified !== false;
    var basis = [], steps = [];
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i].slice();
      var coeffs = [];
      var working = vs[i].slice();
      for (var j = 0; j < basis.length; j++) {
        var b = basis[j];
        var src = modified ? working : vs[i];
        var d = vdot(src, b) / (vdot(b, b) || 1);
        coeffs.push(d);
        working = vsub(working, vscale(b, d));
      }
      var nr = vnorm(working);
      var ortho = nr > 1e-13 ? vscale(working, 1 / nr) : working;
      basis.push(ortho);
      steps.push({ input: vs[i].slice(), coeffs: coeffs, ortho: working, norm: nr, basis: ortho.slice() });
    }
    return { basis: basis, steps: steps };
  }

  // QR. Householder (default) returns full Q (m x m) and R (m x n); 'mgs'
  // returns thin Q (m x n) and R (n x n). Either way A = Q*R.
  function qr(Ain, opts) {
    opts = opts || {};
    var m = Ain.length, n = Ain[0].length;
    if (opts.method === 'mgs') {
      var qvecs = [], R = zeros(n, n);
      for (var j = 0; j < n; j++) {
        var v = Ain.map(function (row) { return row[j]; });
        for (var i = 0; i < j; i++) {
          R[i][j] = vdot(qvecs[i], v);
          v = vsub(v, vscale(qvecs[i], R[i][j]));
        }
        var nr = vnorm(v);
        R[j][j] = nr;
        qvecs.push(nr > 1e-15 ? vscale(v, 1 / nr) : v);
      }
      var Qt = zeros(m, n);
      for (i = 0; i < m; i++) for (j = 0; j < n; j++) Qt[i][j] = qvecs[j][i];
      return { Q: Qt, R: R };
    }
    var Rm = clone(Ain), Q = identity(m);
    var lim = Math.min(m, n);
    for (var k = 0; k < lim; k++) {
      var x = [];
      for (i = k; i < m; i++) x.push(Rm[i][k]);
      var nx = vnorm(x);
      if (nx < 1e-15) continue;
      var alpha = x[0] >= 0 ? -nx : nx;
      var vv = x.slice(); vv[0] -= alpha;
      var nv = vnorm(vv);
      if (nv < 1e-15) continue;
      for (i = 0; i < vv.length; i++) vv[i] /= nv;
      for (j = 0; j < n; j++) {
        var s = 0; for (i = 0; i < vv.length; i++) s += vv[i] * Rm[k + i][j];
        for (i = 0; i < vv.length; i++) Rm[k + i][j] -= 2 * vv[i] * s;
      }
      for (i = 0; i < m; i++) {
        var s2 = 0; for (var q = 0; q < vv.length; q++) s2 += Q[i][k + q] * vv[q];
        for (q = 0; q < vv.length; q++) Q[i][k + q] -= 2 * s2 * vv[q];
      }
    }
    // clean tiny below-diagonal noise
    for (i = 0; i < m; i++) for (j = 0; j < i && j < n; j++) if (Math.abs(Rm[i][j]) < 1e-12) Rm[i][j] = 0;
    return { Q: Q, R: Rm };
  }

  // Least-squares solve of min ||Ax - b|| via QR. Returns x (length n) or null.
  function lstsq(A, b) {
    var m = A.length, n = A[0].length;
    var q = qr(A);
    var Qtb = mulVec(transpose(q.Q), b);
    var R1 = zeros(n, n), b1 = Qtb.slice(0, n);
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) R1[i][j] = q.R[i][j];
    return solve(R1, b1);
  }

  // Symmetric eigendecomposition via GuideMath's Jacobi routine, sorted desc.
  function eigSym(A) {
    var r = GM().jacobiEigenSymmetric(A, A.length);
    var idx = r.values.map(function (v, i) { return i; }).sort(function (a, b) { return r.values[b] - r.values[a]; });
    var values = idx.map(function (i) { return r.values[i]; });
    var n = A.length;
    var vectors = zeros(n, n);
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) vectors[i][j] = r.vectors[i][idx[j]];
    return { values: values, vectors: vectors };
  }

  // Closed-form 2x2 eigendecomposition; handles complex conjugate pairs.
  // Returns {values:[{re,im}], vectors:[vec|null, vec|null]} (vectors real when
  // the pair is real, null when it is complex).
  function eig2x2(A) {
    var a = A[0][0], b = A[0][1], c = A[1][0], d = A[1][1];
    var tr = a + d, detA = a * d - b * c;
    var disc = tr * tr / 4 - detA;
    if (disc >= -1e-12) {
      var sq = Math.sqrt(Math.max(0, disc));
      var l1 = tr / 2 + sq, l2 = tr / 2 - sq;
      function vec(l) {
        if (Math.abs(b) > 1e-13) return [b, l - a];
        if (Math.abs(c) > 1e-13) return [l - d, c];
        return Math.abs(a - l) < Math.abs(d - l) ? [1, 0] : [0, 1];
      }
      return { values: [{ re: l1, im: 0 }, { re: l2, im: 0 }], vectors: [vec(l1), vec(l2)] };
    }
    var im = Math.sqrt(-disc);
    return { values: [{ re: tr / 2, im: im }, { re: tr / 2, im: -im }], vectors: [null, null] };
  }

  // One-sided Jacobi SVD. A (m x n) = U * diag(S) * V^T. U is m x k, V n x k,
  // k = min(m, n); S is length k, sorted descending. This orthogonalises the
  // columns directly, so it does NOT square the condition number the way
  // eig(A^T A) would — which matters for the near-singular matrices Part 19
  // constructs on purpose.
  function svd(Ain) {
    var m = Ain.length, n = Ain[0].length;
    if (m < n) {
      var t = svd(transpose(Ain));
      return { U: t.V, S: t.S, V: t.U };
    }
    var B = clone(Ain);
    var V = identity(n);
    var eps = 1e-15;
    for (var sweep = 0; sweep < 100; sweep++) {
      var off = 0;
      for (var p = 0; p < n - 1; p++) {
        for (var q = p + 1; q < n; q++) {
          var alpha = 0, beta = 0, gamma = 0;
          for (var i = 0; i < m; i++) { alpha += B[i][p] * B[i][p]; beta += B[i][q] * B[i][q]; gamma += B[i][p] * B[i][q]; }
          if (gamma === 0 || Math.abs(gamma) <= eps * Math.sqrt(alpha * beta)) continue;
          off += Math.abs(gamma);
          var zeta = (beta - alpha) / (2 * gamma);
          var t2 = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
          var cc = 1 / Math.sqrt(1 + t2 * t2), ss = cc * t2;
          for (i = 0; i < m; i++) { var bip = B[i][p], biq = B[i][q]; B[i][p] = cc * bip - ss * biq; B[i][q] = ss * bip + cc * biq; }
          for (i = 0; i < n; i++) { var vip = V[i][p], viq = V[i][q]; V[i][p] = cc * vip - ss * viq; V[i][q] = ss * vip + cc * viq; }
        }
      }
      if (off < 1e-14) break;
    }
    var cols = [];
    for (var j = 0; j < n; j++) {
      var col = []; for (i = 0; i < m; i++) col.push(B[i][j]);
      var sig = vnorm(col);
      var vv = []; for (i = 0; i < n; i++) vv.push(V[i][j]);
      cols.push({ col: col, sigma: sig, v: vv });
    }
    cols.sort(function (x, y) { return y.sigma - x.sigma; });
    var S = cols.map(function (c) { return c.sigma; });
    var U = zeros(m, n);
    for (i = 0; i < m; i++) for (j = 0; j < n; j++) U[i][j] = cols[j].sigma > 1e-300 ? cols[j].col[i] / cols[j].sigma : (i === j ? 1 : 0);
    var Vout = zeros(n, n);
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) Vout[i][j] = cols[j].v[i];
    return { U: U, S: S, V: Vout };
  }

  function rank(A, tol) {
    var s = svd(A);
    if (!s.S.length) return 0;
    if (tol == null) tol = Math.max(A.length, A[0].length) * 1e-12 * (s.S[0] || 1);
    var r = 0;
    for (var i = 0; i < s.S.length; i++) if (s.S[i] > tol) r++;
    return r;
  }

  // Null space basis by RREF (works for wide matrices, where a thin SVD does
  // not expose the full null space). Vectors are orthonormalised for display.
  function nullSpace(A) {
    var m = A.length, n = A[0].length, M = clone(A);
    var pivots = [], row = 0;
    for (var col = 0; col < n && row < m; col++) {
      var sel = row;
      for (var i = row + 1; i < m; i++) if (Math.abs(M[i][col]) > Math.abs(M[sel][col])) sel = i;
      if (Math.abs(M[sel][col]) < 1e-12) continue;
      var t = M[sel]; M[sel] = M[row]; M[row] = t;
      var pv = M[row][col];
      for (var j = col; j < n; j++) M[row][j] /= pv;
      for (i = 0; i < m; i++) {
        if (i === row) continue;
        var f = M[i][col];
        if (Math.abs(f) < 1e-15) continue;
        for (j = col; j < n; j++) M[i][j] -= f * M[row][j];
      }
      pivots.push(col); row++;
    }
    var free = [];
    for (col = 0; col < n; col++) if (pivots.indexOf(col) === -1) free.push(col);
    var basis = free.map(function (fc) {
      var v = new Array(n).fill(0); v[fc] = 1;
      pivots.forEach(function (pc, pi) { v[pc] = -M[pi][fc]; });
      return v;
    });
    if (basis.length) basis = gramSchmidt(basis, { modified: true }).basis;
    return basis;
  }

  // Column space basis = the pivot columns of A (exact, no SVD needed).
  function colSpace(A) {
    var m = A.length, n = A[0].length, M = clone(A);
    var pivots = [], row = 0;
    for (var col = 0; col < n && row < m; col++) {
      var sel = row;
      for (var i = row + 1; i < m; i++) if (Math.abs(M[i][col]) > Math.abs(M[sel][col])) sel = i;
      if (Math.abs(M[sel][col]) < 1e-12) continue;
      var t = M[sel]; M[sel] = M[row]; M[row] = t;
      var pv = M[row][col];
      for (var j = col; j < n; j++) M[row][j] /= pv;
      for (i = 0; i < m; i++) {
        if (i === row) continue;
        var f = M[i][col];
        if (Math.abs(f) < 1e-15) continue;
        for (j = col; j < n; j++) M[i][j] -= f * M[row][j];
      }
      pivots.push(col); row++;
    }
    return pivots.map(function (c) { return A.map(function (r) { return r[c]; }); });
  }

  // Pseudoinverse via SVD. tol defaults to a standard relative cutoff.
  function pinv(A, tol) {
    var s = svd(A);
    var k = s.S.length, m = s.U.length, n = s.V.length;
    var smax = s.S[0] || 1;
    if (tol == null) tol = Math.max(1e-12, Math.max(m, n) * 1e-12) * smax;
    var Sinv = s.S.map(function (x) { return x > tol ? 1 / x : 0; });
    var out = zeros(n, m);
    for (var i = 0; i < n; i++) for (var j = 0; j < m; j++) {
      var sum = 0;
      for (var q = 0; q < k; q++) sum += s.V[i][q] * Sinv[q] * s.U[j][q];
      out[i][j] = sum;
    }
    return out;
  }

  function cond(A) {
    var s = svd(A);
    if (!s.S.length) return Infinity;
    var smax = s.S[0], smin = s.S[s.S.length - 1];
    return smin > 1e-300 ? smax / smin : Infinity;
  }

  function powerIteration(A, x0, iters) {
    iters = iters || 100;
    var x = (x0 || null) ? x0.slice() : A.map(function () { return 1; });
    x = vnormalize(x);
    var val = 0, history = [];
    for (var i = 0; i < iters; i++) {
      var Ax = mulVec(A, x);
      val = vdot(x, Ax);
      history.push(val);
      var nr = vnorm(Ax);
      if (nr < 1e-300) break;
      x = vscale(Ax, 1 / nr);
    }
    return { vec: x, val: val, history: history };
  }

  // =========================================================================
  // the 2D plane widget
  // =========================================================================
  function plane(canvas, opts) {
    opts = opts || {};
    var W = opts.W || 640, H = opts.H || 360;
    var xRange = opts.xRange || [-5, 5], yRange = opts.yRange || [-3, 3];
    var padL = opts.padL != null ? opts.padL : 14, padR = opts.padR != null ? opts.padR : 14;
    var padT = opts.padT != null ? opts.padT : 14, padB = opts.padB != null ? opts.padB : 14;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    function px(x) { return padL + plotW * (x - xRange[0]) / (xRange[1] - xRange[0]); }
    function py(y) { return H - padB - plotH * (y - yRange[0]) / (yRange[1] - yRange[0]); }
    function wx(X) { return xRange[0] + (xRange[1] - xRange[0]) * (X - padL) / plotW; }
    function wy(Y) { return yRange[0] + (yRange[1] - yRange[0]) * (H - padB - Y) / plotH; }

    var setup = Guide().setupCanvas(canvas, W, H, function () { if (opts.onResize) opts.onResize(); });
    var ctx = setup.ctx;

    function clear() { ctx.clearRect(0, 0, W, H); }

    function axes(a) {
      a = a || {};
      var c = colors();
      var x0 = px(0), y0 = py(0);
      ctx.strokeStyle = a.color || c.divider; ctx.lineWidth = a.width || 1;
      ctx.beginPath(); ctx.moveTo(padL, y0); ctx.lineTo(W - padR, y0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, padT); ctx.lineTo(x0, H - padB); ctx.stroke();
      ctx.font = (a.fontSize || 10) + 'px ' + c.font;
      ctx.fillStyle = c.text;
      var step = a.step || 1;
      var from = Math.ceil(xRange[0] / step) * step;
      for (var x = from; x <= xRange[1] + 1e-9; x += step) {
        if (Math.abs(x) < 1e-9) continue;
        var X = px(x);
        ctx.beginPath(); ctx.moveTo(X, y0 - 3); ctx.lineTo(X, y0 + 3); ctx.stroke();
        if (a.labels !== false) { ctx.textAlign = 'center'; ctx.fillText(fmtTick(x), X, y0 + 14); }
      }
      var fromY = Math.ceil(yRange[0] / step) * step;
      for (var y = fromY; y <= yRange[1] + 1e-9; y += step) {
        if (Math.abs(y) < 1e-9) continue;
        var Y = py(y);
        ctx.beginPath(); ctx.moveTo(x0 - 3, Y); ctx.lineTo(x0 + 3, Y); ctx.stroke();
        if (a.labels !== false) { ctx.textAlign = 'right'; ctx.fillText(fmtTick(y), x0 - 6, Y + 3); }
      }
    }

    function grid(M, g) {
      g = g || {};
      var c = colors();
      var step = g.step || 1;
      var E = g.extent != null ? g.extent : Math.max(Math.abs(xRange[0]), Math.abs(xRange[1]), Math.abs(yRange[0]), Math.abs(yRange[1])) + 2;
      var Mx = M || [[1, 0], [0, 1]];
      var k, a, b;
      ctx.strokeStyle = g.color || c.divider;
      ctx.lineWidth = g.width != null ? g.width : 1;
      ctx.beginPath();
      for (k = -E; k <= E + 1e-9; k += step) {
        a = mulVec(Mx, [k, -E]); b = mulVec(Mx, [k, E]);
        ctx.moveTo(px(a[0]), py(a[1])); ctx.lineTo(px(b[0]), py(b[1]));
        a = mulVec(Mx, [-E, k]); b = mulVec(Mx, [E, k]);
        ctx.moveTo(px(a[0]), py(a[1])); ctx.lineTo(px(b[0]), py(b[1]));
      }
      ctx.stroke();
    }

    function vector(v, o) {
      o = o || {};
      var c = colors();
      var from = o.from || [0, 0];
      var x0 = px(from[0]), y0 = py(from[1]);
      var x1 = px(from[0] + v[0]), y1 = py(from[1] + v[1]);
      Guide().drawArrow(ctx, x0, y0, x1, y1, {
        color: o.color || c.accent, width: o.width || 2.4, head: o.head || 9,
        dashed: o.dashed, label: o.label, labelColor: o.labelColor || c.text, labelOffset: o.labelOffset
      });
      return { x0: x0, y0: y0, x1: x1, y1: y1 };
    }

    function polygon(pts, o) {
      o = o || {};
      var c = colors();
      if (!pts.length) return;
      ctx.beginPath();
      ctx.moveTo(px(pts[0][0]), py(pts[0][1]));
      for (var i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i][0]), py(pts[i][1]));
      ctx.closePath();
      if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
      if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.width || 2; ctx.stroke(); }
      if (o.label) {
        var cx = 0, cy = 0;
        pts.forEach(function (p) { cx += p[0]; cy += p[1]; });
        cx /= pts.length; cy /= pts.length;
        ctx.fillStyle = o.labelColor || c.text; ctx.font = '12px ' + c.font; ctx.textAlign = 'center';
        ctx.fillText(o.label, px(cx), py(cy));
      }
    }

    // Image of the unit circle under a 2x2 A: the series' signature ellipse.
    function ellipse(A, o) {
      o = o || {};
      var c = colors();
      var N = o.samples || 160;
      var pts = [];
      for (var i = 0; i <= N; i++) {
        var t = 2 * Math.PI * i / N;
        pts.push(mulVec(A, [Math.cos(t), Math.sin(t)]));
      }
      ctx.beginPath();
      for (i = 0; i < pts.length; i++) {
        var X = px(pts[i][0]), Y = py(pts[i][1]);
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      ctx.strokeStyle = o.color || c.accent2; ctx.lineWidth = o.width || 2.4; ctx.stroke();
      if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
      if (o.axes) {
        vector([A[0][0], A[1][0]], { color: c.accent400, width: 1.6, label: o.axisLabel ? 'v₁' : undefined });
        vector([A[0][1], A[1][1]], { color: c.accent400, width: 1.6, label: o.axisLabel ? 'v₂' : undefined });
      }
      return pts;
    }

    function points(pts, o) {
      o = o || {};
      var c = colors();
      ctx.fillStyle = o.color || c.accent;
      for (var i = 0; i < pts.length; i++) {
        ctx.beginPath();
        ctx.arc(px(pts[i][0]), py(pts[i][1]), o.r || 3, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    // Shaded span of v1, v2. Degrades to a thick line when they are collinear.
    function span(v1, v2, o) {
      o = o || {};
      var c = colors();
      if (!v1) return { collinear: true };
      var n1 = vnorm(v1), n2 = v2 ? vnorm(v2) : 0;
      var cross = v2 ? (v1[0] * v2[1] - v1[1] * v2[0]) : 0;
      var collinear = !v2 || Math.abs(cross) < 1e-6 * Math.max(1e-9, n1 * n2);
      var diag = Math.max(plotW, plotH);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
      if (collinear) {
        var dir = n1 > 1e-9 ? vscale(v1, 1 / n1) : [1, 0];
        var big = diag;
        var a = vscale(dir, -big * 3), b = vscale(dir, big * 3);
        ctx.strokeStyle = o.color || 'rgba(43,95,255,0.18)';
        ctx.lineWidth = 10; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(px(a[0]), py(a[1])); ctx.lineTo(px(b[0]), py(b[1])); ctx.stroke();
      } else {
        var m = Math.min(n1, n2) || 1;
        var K = 3 * diag / m;
        var p1 = vscale(v1, K), p2 = vscale(v2, K);
        var quad = [vadd(p1, p2), vsub(p1, p2), vscale(vadd(p1, p2), -1), vsub(p2, p1)];
        ctx.fillStyle = o.color || 'rgba(43,95,255,0.12)';
        ctx.beginPath();
        ctx.moveTo(px(quad[0][0]), py(quad[0][1]));
        for (var i = 1; i < quad.length; i++) ctx.lineTo(px(quad[i][0]), py(quad[i][1]));
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      return { collinear: collinear };
    }

    // Draggable world-coordinate handles. specs is an array (or a function
    // returning one) of {id, x, y, r, color, label}. Returns {draw, destroy}.
    function handles(specs, onChange, o) {
      o = o || {};
      var resolve = typeof specs === 'function' ? specs : function () { return specs; };
      var mgr = {
        draw: function () {
          var c = colors();
          resolve().forEach(function (h) {
            ctx.beginPath();
            ctx.arc(px(h.x), py(h.y), h.r || 9, 0, 2 * Math.PI);
            ctx.fillStyle = h.color || c.accent2; ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
            if (h.label) {
              ctx.fillStyle = h.labelColor || c.text; ctx.font = '12px ' + c.font;
              ctx.textAlign = 'left';
              ctx.fillText(h.label, px(h.x) + (h.r || 9) + 4, py(h.y) - (h.r || 9) - 2);
            }
          });
        },
        destroy: function () { dh && dh.destroy(); }
      };
      var dh = Guide().dragHandles(canvas, function () {
        return resolve().map(function (h) { return { id: h.id, x: px(h.x), y: py(h.y), r: (h.r || 9) + (o.grab || 5) }; });
      }, function (id, X, Y) { onChange(id, wx(X), wy(Y)); }, { cursor: o.cursor || 'grab' });
      return mgr;
    }

    return {
      canvas: canvas, ctx: ctx, W: W, H: H, xRange: xRange, yRange: yRange,
      padL: padL, padR: padR, padT: padT, padB: padB,
      px: px, py: py, wx: wx, wy: wy, clear: clear, axes: axes, grid: grid,
      vector: vector, polygon: polygon, ellipse: ellipse, points: points, span: span,
      handles: handles, resize: setup.resize
    };
  }

  function fmtTick(x) {
    if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
    return x.toFixed(1);
  }

  // =========================================================================
  // live matrix rendering
  // =========================================================================
  function fmtVal(x, digits) {
    if (x == null || isNaN(x)) return '—';
    if (digits === null) digits = 3;
    var v = Math.abs(x) < 1e-12 ? 0 : x;
    var s = v.toFixed(digits);
    if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  function matrixHTML(A, opts) {
    opts = opts || {};
    var digits = opts.digits == null ? 2 : opts.digits;
    var m = A.length, n = A[0] ? A[0].length : 0;
    var hi = opts.highlight || [];
    function isHi(r, c) { return hi.some(function (h) { return h[0] === r && h[1] === c; }); }
    var cols = n + (opts.rowLabels ? 1 : 0);
    var cells = '';
    if (opts.colLabels) {
      if (opts.rowLabels) cells += '<span class="g-matrix-cell g-matrix-label"></span>';
      for (var j0 = 0; j0 < n; j0++) cells += '<span class="g-matrix-cell g-matrix-label">' + esc(opts.colLabels[j0]) + '</span>';
    }
    for (var i = 0; i < m; i++) {
      if (opts.rowLabels) cells += '<span class="g-matrix-cell g-matrix-label">' + esc(opts.rowLabels[i]) + '</span>';
      for (var j = 0; j < n; j++) {
        cells += '<span class="g-matrix-cell' + (isHi(i, j) ? ' g-matrix-cell--hi' : '') + '">' + fmtVal(A[i][j], digits) + '</span>';
      }
    }
    var label = opts.label ? '<span class="g-matrix-label-out">' + esc(opts.label) + '</span>' : '';
    return '<span class="g-matrix">' + label +
      '<span class="g-matrix-wrap"><span class="g-bracket" aria-hidden="true">[</span>' +
      '<span class="g-matrix-grid" style="--g-matrix-cols:' + cols + '">' + cells + '</span>' +
      '<span class="g-bracket" aria-hidden="true">]</span></span></span>';
  }

  function setMatrix(el, A, opts) { if (el) el.innerHTML = matrixHTML(A, opts); }

  function matrixInput(el, A, onChange, opts) {
    opts = opts || {};
    if (!el) return null;
    function build() {
      var m = A.length, n = A[0].length;
      var grid = document.createElement('span');
      grid.className = 'g-matrix-grid g-matrix-input';
      grid.style.setProperty('--g-matrix-cols', String(n));
      for (var i = 0; i < m; i++) for (var j = 0; j < n; j++) {
        var inp = document.createElement('input');
        inp.type = 'number'; inp.step = opts.step || 'any';
        inp.value = fmtVal(A[i][j], opts.digits == null ? 2 : opts.digits);
        inp.dataset.r = i; inp.dataset.c = j;
        inp.className = 'g-matrix-input-cell';
        inp.addEventListener('input', function () {
          var r = +this.dataset.r, c = +this.dataset.c;
          var v = parseFloat(this.value); if (isNaN(v)) return;
          A[r][c] = v; if (onChange) onChange(A);
        });
        grid.appendChild(inp);
      }
      var wrap = document.createElement('span');
      wrap.className = 'g-matrix-wrap';
      wrap.innerHTML = '<span class="g-bracket" aria-hidden="true">[</span>';
      wrap.appendChild(grid);
      var close = document.createElement('span');
      close.className = 'g-bracket'; close.setAttribute('aria-hidden', 'true'); close.textContent = ']';
      wrap.appendChild(close);
      el.innerHTML = '';
      el.appendChild(wrap);
    }
    build();
    return {
      set: function (B) { A = B; },
      get: function () { return A; },
      rebuild: build
    };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // =========================================================================
  // the series' running-example dataset
  // =========================================================================
  function pointCloud(n, opts) {
    opts = opts || {};
    n = n || opts.n || 60;
    var seed = opts.seed == null ? 20260913 : opts.seed;
    var r = Guide().seededRandom(seed);
    var cx = opts.cx == null ? 0 : opts.cx, cy = opts.cy == null ? 0 : opts.cy;
    var sx = opts.sx == null ? 1.7 : opts.sx, sy = opts.sy == null ? 0.9 : opts.sy;
    var rho = opts.rho == null ? 0.62 : opts.rho;
    function gauss() {
      var u = Math.max(r(), 1e-9), v = r();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
    var pts = [];
    for (var i = 0; i < n; i++) {
      var z1 = gauss(), z2 = gauss();
      var x = cx + sx * z1;
      var y = cy + sy * (rho * z1 + Math.sqrt(Math.max(0, 1 - rho * rho)) * z2);
      pts.push([x, y]);
    }
    return pts;
  }

  // =========================================================================
  global.LinAlg = {
    vdot: vdot, vnorm: vnorm, vscale: vscale, vsub: vsub, vadd: vadd, vnormalize: vnormalize,
    plane: plane,
    lerpMat: lerpMat, pointCloud: pointCloud,
    matrixHTML: matrixHTML, setMatrix: setMatrix, matrixInput: matrixInput,
    mat: {
      identity: identity, zeros: zeros, clone: clone, transpose: transpose,
      add: add, scale: scaleMat, mul: mul, mulVec: mulVec,
      det: det, inverse: inverse, solve: solve,
      lu: lu, gramSchmidt: gramSchmidt, qr: qr, lstsq: lstsq,
      eigSym: eigSym, eig2x2: eig2x2, svd: svd,
      pinv: pinv, rank: rank, nullSpace: nullSpace, colSpace: colSpace,
      cond: cond, powerIteration: powerIteration
    }
  };
})(window);
