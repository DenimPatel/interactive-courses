/* lie-viz.js — domain layer for the "Lie Groups & Lie Algebras, Interactively" series
 * (vision/lie-theory/*). Exposes window.Lie.
 *
 * Contents
 *   Lie.m3      3x3 matrix / 3-vector helpers (arrays of rows)
 *   Lie.mN      small dense NxN helpers (6x6 adjoints and Jacobians, solves)
 *   Lie.so2     SO(2): hat, vee, exp, log, wrap
 *   Lie.so3     SO(3): hat, vee, exp, log (robust at 0 and pi), logNaive, Jr, Jl, their
 *               inverses, Ad, plus/minus (right and left), random, dist, interp
 *   Lie.se2     SE(2): 3x3 homogeneous; exp, log, Ad, plus/minus
 *   Lie.se3     SE(3): 4x4 homogeneous; tau = [rho(3), phi(3)] (translation first, as in
 *               Sola et al. and Sophus); exp, log, Ad, Jr, Jl (with Barfoot's Q block)
 *   Lie.quat    unit quaternions [w,x,y,z]: from/to matrix, mul, exp, log, slerp
 *   Lie.euler   ZYX (yaw, pitch, roll) conversions and a gimbal-lock indicator
 *   Lie.numJac  central-difference Jacobian on any pair of (plus, minus) operators
 *   Lie.kabsch  closed-form rotation alignment (Horn's quaternion method)
 *   Lie.view3d  orthographic 3D canvas with drag-to-orbit and optional drag handles
 *
 * Conventions: vectors are plain arrays, matrices are arrays of rows. Right-perturbation
 * is the default everywhere (X ⊕ τ = X·Exp(τ)); the left versions carry an L suffix.
 * Every stochastic helper takes an rng (a () => [0,1) function, e.g. Guide.seededRandom).
 * The numerics are asserted by scripts/check-lie-viz.js. */
(function (global) {
  "use strict";

  var EPS = 1e-9;

  // ---------------------------------------------------------------- 3x3 / 3-vectors
  var m3 = {
    I: function () { return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; },
    zero: function () { return [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; },
    add: function (A, B) { return A.map(function (r, i) { return r.map(function (x, j) { return x + B[i][j]; }); }); },
    sub: function (A, B) { return A.map(function (r, i) { return r.map(function (x, j) { return x - B[i][j]; }); }); },
    scale: function (A, s) { return A.map(function (r) { return r.map(function (x) { return x * s; }); }); },
    mul: function (A, B) {
      var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
      return C;
    },
    mulV: function (A, v) {
      return [A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2],
              A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2],
              A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2]];
    },
    T: function (A) { return [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]]; },
    det: function (R) {
      return R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1])
           - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0])
           + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
    },
    trace: function (A) { return A[0][0] + A[1][1] + A[2][2]; },
    inv: function (A) {
      var d = m3.det(A);
      var C = [
        [A[1][1] * A[2][2] - A[1][2] * A[2][1], A[0][2] * A[2][1] - A[0][1] * A[2][2], A[0][1] * A[1][2] - A[0][2] * A[1][1]],
        [A[1][2] * A[2][0] - A[1][0] * A[2][2], A[0][0] * A[2][2] - A[0][2] * A[2][0], A[0][2] * A[1][0] - A[0][0] * A[1][2]],
        [A[1][0] * A[2][1] - A[1][1] * A[2][0], A[0][1] * A[2][0] - A[0][0] * A[2][1], A[0][0] * A[1][1] - A[0][1] * A[1][0]]
      ];
      return m3.scale(C, 1 / d);
    },
    frob: function (A) { var s = 0; for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) s += A[i][j] * A[i][j]; return Math.sqrt(s); },
    dist: function (A, B) { return m3.frob(m3.sub(A, B)); },
    orthoError: function (R) { return m3.dist(m3.mul(m3.T(R), R), m3.I()); },
    col: function (A, j) { return [A[0][j], A[1][j], A[2][j]]; },
    fromCols: function (a, b, c) { return [[a[0], b[0], c[0]], [a[1], b[1], c[1]], [a[2], b[2], c[2]]]; },
    outer: function (a, b) { return [[a[0] * b[0], a[0] * b[1], a[0] * b[2]], [a[1] * b[0], a[1] * b[1], a[1] * b[2]], [a[2] * b[0], a[2] * b[1], a[2] * b[2]]]; },
    // Gram-Schmidt on the columns: the cheapest way back onto O(3) (keeps column 0's direction).
    gramSchmidt: function (M) {
      var c0 = v3.normalize(m3.col(M, 0));
      var c1 = m3.col(M, 1); c1 = v3.normalize(v3.sub(c1, v3.scale(c0, v3.dot(c0, c1))));
      var c2 = v3.cross(c0, c1);
      return m3.fromCols(c0, c1, c2);
    },
    // Rx, Ry, Rz elementary rotations.
    Rx: function (a) { var c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; },
    Ry: function (a) { var c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; },
    Rz: function (a) { var c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; }
  };

  var v3 = {
    add: function (a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; },
    sub: function (a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; },
    scale: function (a, s) { return [a[0] * s, a[1] * s, a[2] * s]; },
    dot: function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
    cross: function (a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; },
    norm: function (a) { return Math.hypot(a[0], a[1], a[2]); },
    normalize: function (a) { var n = v3.norm(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; },
    lerp: function (a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; },
    // Unit vector from azimuth/elevation in degrees (z up).
    fromAzEl: function (azDeg, elDeg) {
      var a = azDeg * Math.PI / 180, e = elDeg * Math.PI / 180;
      return [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
    }
  };

  // ---------------------------------------------------------------- NxN dense
  var mN = {
    zeros: function (r, c) { var M = []; for (var i = 0; i < r; i++) { M.push([]); for (var j = 0; j < c; j++) M[i].push(0); } return M; },
    eye: function (n) { var M = mN.zeros(n, n); for (var i = 0; i < n; i++) M[i][i] = 1; return M; },
    mul: function (A, B) {
      var r = A.length, k = B.length, c = B[0].length, C = mN.zeros(r, c);
      for (var i = 0; i < r; i++) for (var j = 0; j < c; j++) { var s = 0; for (var t = 0; t < k; t++) s += A[i][t] * B[t][j]; C[i][j] = s; }
      return C;
    },
    mulV: function (A, v) { return A.map(function (row) { var s = 0; for (var j = 0; j < v.length; j++) s += row[j] * v[j]; return s; }); },
    T: function (A) { var r = A.length, c = A[0].length, B = mN.zeros(c, r); for (var i = 0; i < r; i++) for (var j = 0; j < c; j++) B[j][i] = A[i][j]; return B; },
    add: function (A, B) { return A.map(function (row, i) { return row.map(function (x, j) { return x + B[i][j]; }); }); },
    scale: function (A, s) { return A.map(function (row) { return row.map(function (x) { return x * s; }); }); },
    // Solve A x = b by Gaussian elimination with partial pivoting.
    solve: function (A, b) {
      var n = A.length, M = A.map(function (row, i) { return row.slice().concat([b[i]]); });
      for (var c = 0; c < n; c++) {
        var p = c; for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
        var tmp = M[c]; M[c] = M[p]; M[p] = tmp;
        var piv = M[c][c]; if (Math.abs(piv) < 1e-300) piv = 1e-300;
        for (var r2 = c + 1; r2 < n; r2++) { var f = M[r2][c] / piv; for (var k = c; k <= n; k++) M[r2][k] -= f * M[c][k]; }
      }
      var x = new Array(n);
      for (var i = n - 1; i >= 0; i--) { var s = M[i][n]; for (var j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / (Math.abs(M[i][i]) < 1e-300 ? 1e-300 : M[i][i]); }
      return x;
    },
    inv: function (A) {
      var n = A.length, cols = [];
      for (var j = 0; j < n; j++) { var e = new Array(n).fill(0); e[j] = 1; cols.push(mN.solve(A, e)); }
      return mN.T(cols);
    },
    maxAbsDiff: function (A, B) { var m = 0; for (var i = 0; i < A.length; i++) for (var j = 0; j < A[0].length; j++) m = Math.max(m, Math.abs(A[i][j] - B[i][j])); return m; },
    block: function (A, B, C, D) { // [[A B],[C D]] from 3x3 blocks
      var M = mN.zeros(6, 6);
      for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) { M[i][j] = A[i][j]; M[i][j + 3] = B[i][j]; M[i + 3][j] = C[i][j]; M[i + 3][j + 3] = D[i][j]; }
      return M;
    },
    // Cyclic Jacobi eigen-decomposition of a symmetric matrix. Returns {values, vectors}
    // with vectors[k] the k-th eigenvector, sorted by descending eigenvalue.
    eigSym: function (S) {
      var n = S.length, A = S.map(function (r) { return r.slice(); }), V = mN.eye(n);
      for (var sweep = 0; sweep < 60; sweep++) {
        var off = 0; for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
        if (off < 1e-26) break;
        for (var p = 0; p < n; p++) for (var q = p + 1; q < n; q++) {
          if (Math.abs(A[p][q]) < 1e-300) continue;
          var th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
          var t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
          var c = 1 / Math.sqrt(t * t + 1), s = t * c;
          for (var k = 0; k < n; k++) { var akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
          for (var k2 = 0; k2 < n; k2++) { var apk = A[p][k2], aqk = A[q][k2]; A[p][k2] = c * apk - s * aqk; A[q][k2] = s * apk + c * aqk; }
          for (var k3 = 0; k3 < n; k3++) { var vkp = V[k3][p], vkq = V[k3][q]; V[k3][p] = c * vkp - s * vkq; V[k3][q] = s * vkp + c * vkq; }
        }
      }
      var idx = []; for (var d = 0; d < n; d++) idx.push(d);
      idx.sort(function (a, b) { return A[b][b] - A[a][a]; });
      return {
        values: idx.map(function (d) { return A[d][d]; }),
        vectors: idx.map(function (d) { return V.map(function (row) { return row[d]; }); })
      };
    }
  };

  // ---------------------------------------------------------------- SO(2)
  var so2 = {
    wrap: function (a) { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; },
    hat: function (t) { return [[0, -t], [t, 0]]; },
    vee: function (W) { return W[1][0]; },
    exp: function (t) { var c = Math.cos(t), s = Math.sin(t); return [[c, -s], [s, c]]; },
    log: function (R) { return Math.atan2(R[1][0], R[0][0]); },
    compose: function (A, B) {
      return [[A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]],
              [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]]];
    },
    plus: function (a, t) { return so2.wrap(a + t); },
    minus: function (b, a) { return so2.wrap(b - a); },
    // Circular (intrinsic) mean of angles, by fixed-point iteration in the tangent space.
    mean: function (angles, iters) {
      var m = angles[0];
      for (var k = 0; k < (iters || 20); k++) {
        var s = 0; angles.forEach(function (a) { s += so2.minus(a, m); });
        m = so2.plus(m, s / angles.length);
      }
      return m;
    }
  };

  // ---------------------------------------------------------------- SO(3)
  function hat3(w) { return [[0, -w[2], w[1]], [w[2], 0, -w[0]], [-w[1], w[0], 0]]; }
  function vee3(W) { return [W[2][1], W[0][2], W[1][0]]; }

  var so3 = {
    hat: hat3,
    vee: vee3,
    generators: [hat3([1, 0, 0]), hat3([0, 1, 0]), hat3([0, 0, 1])],
    exp: function (w) {
      var th2 = v3.dot(w, w), th = Math.sqrt(th2), W = hat3(w), W2 = m3.mul(W, W), a, b;
      if (th < 1e-4) { a = 1 - th2 / 6; b = 0.5 - th2 / 24; }
      else { a = Math.sin(th) / th; b = (1 - Math.cos(th)) / th2; }
      return m3.add(m3.add(m3.I(), m3.scale(W, a)), m3.scale(W2, b));
    },
    // Truncated power series sum_{n<=N} W^n/n!, for the "why is it an exponential" demos.
    expSeries: function (w, N) {
      var W = hat3(w), term = m3.I(), R = m3.I(), fact = 1;
      for (var n = 1; n <= N; n++) { term = m3.mul(term, W); fact *= n; R = m3.add(R, m3.scale(term, 1 / fact)); }
      return R;
    },
    // The textbook formula with no special cases. Loses all precision near theta=pi and
    // divides 0/0 at theta=0: kept only to demonstrate why log needs branches.
    logNaive: function (R) {
      var c = (m3.trace(R) - 1) / 2, th = Math.acos(Math.max(-1, Math.min(1, c)));
      var f = th / (2 * Math.sin(th));
      return v3.scale(vee3(m3.sub(R, m3.T(R))), f);
    },
    log: function (R) {
      var tr = m3.trace(R), c = (tr - 1) / 2;
      var sv = vee3(m3.sub(R, m3.T(R)));          // = 2 sin(th) k
      var s = v3.norm(sv) / 2;
      var th = Math.atan2(s, Math.max(-1, Math.min(1, c)));
      if (th < 1e-4) {
        // th/(2 sin th) ~ 1/2 + th^2/12
        return v3.scale(sv, 0.5 + th * th / 12);
      }
      if (Math.PI - th < 1e-3) {
        // Near pi the skew part vanishes; read the axis off the symmetric part instead:
        // sym(R) = cos(th) I + (1 - cos th) k k^T, so k k^T = (sym(R) - c I) / (1 - c).
        // Use the largest diagonal entry for stability.
        var Sym = m3.scale(m3.add(R, m3.T(R)), 0.5);
        var B = m3.scale(m3.sub(Sym, m3.scale(m3.I(), c)), 1 / (1 - c)), i = 0;
        if (B[1][1] > B[i][i]) i = 1;
        if (B[2][2] > B[i][i]) i = 2;
        var ki = Math.sqrt(Math.max(B[i][i], 0)), k = [0, 0, 0];
        for (var j = 0; j < 3; j++) k[j] = (j === i) ? ki : B[i][j] / (ki || 1);
        k = v3.normalize(k);
        if (v3.dot(k, sv) < 0) k = v3.scale(k, -1);
        return v3.scale(k, th);
      }
      return v3.scale(sv, th / (2 * Math.sin(th)));
    },
    // Right Jacobian Jr(w): Exp(w + d) ~ Exp(w) Exp(Jr(w) d).
    Jr: function (w) {
      var th2 = v3.dot(w, w), th = Math.sqrt(th2), W = hat3(w), W2 = m3.mul(W, W), a, b;
      if (th < 1e-4) { a = 0.5 - th2 / 24; b = 1 / 6 - th2 / 120; }
      else { a = (1 - Math.cos(th)) / th2; b = (th - Math.sin(th)) / (th2 * th); }
      return m3.add(m3.sub(m3.I(), m3.scale(W, a)), m3.scale(W2, b));
    },
    Jl: function (w) { return so3.Jr(v3.scale(w, -1)); },
    JrInv: function (w) {
      var th2 = v3.dot(w, w), th = Math.sqrt(th2), W = hat3(w), W2 = m3.mul(W, W), b;
      if (th < 1e-4) b = 1 / 12 + th2 / 720;
      else b = 1 / th2 - (1 + Math.cos(th)) / (2 * th * Math.sin(th));
      return m3.add(m3.add(m3.I(), m3.scale(W, 0.5)), m3.scale(W2, b));
    },
    JlInv: function (w) { return so3.JrInv(v3.scale(w, -1)); },
    Ad: function (R) { return R.map(function (r) { return r.slice(); }); },
    bracket: function (a, b) { return v3.cross(a, b); },
    inv: function (R) { return m3.T(R); },
    compose: function (A, B) { return m3.mul(A, B); },
    act: function (R, p) { return m3.mulV(R, p); },
    plus: function (R, d) { return m3.mul(R, so3.exp(d)); },
    minus: function (R2, R1) { return so3.log(m3.mul(m3.T(R1), R2)); },
    plusL: function (R, d) { return m3.mul(so3.exp(d), R); },
    minusL: function (R2, R1) { return so3.log(m3.mul(R2, m3.T(R1))); },
    dist: function (A, B) { return v3.norm(so3.log(m3.mul(m3.T(A), B))); },
    angle: function (R) { return Math.atan2(v3.norm(vee3(m3.sub(R, m3.T(R)))) / 2, (m3.trace(R) - 1) / 2); },
    // Geodesic interpolation R0 -> R1.
    interp: function (R0, R1, t) { return m3.mul(R0, so3.exp(v3.scale(so3.log(m3.mul(m3.T(R0), R1)), t))); },
    // Uniformly random rotation (Shoemake's subgroup algorithm through a quaternion).
    random: function (rng) {
      var u1 = rng(), u2 = rng(), u3 = rng();
      var a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
      var q = [b * Math.cos(2 * Math.PI * u3), a * Math.sin(2 * Math.PI * u2), a * Math.cos(2 * Math.PI * u2), b * Math.sin(2 * Math.PI * u3)];
      return quat.toMat(q);
    },
    // Iterative Karcher (geodesic L2) mean.
    mean: function (Rs, iters) {
      var M = Rs[0];
      for (var k = 0; k < (iters || 30); k++) {
        var s = [0, 0, 0];
        Rs.forEach(function (R) { s = v3.add(s, so3.minus(R, M)); });
        s = v3.scale(s, 1 / Rs.length);
        M = so3.plus(M, s);
        if (v3.norm(s) < 1e-12) break;
      }
      return M;
    },
    // Chordal L2 mean: average the matrices, project back to SO(3) (via Horn/Kabsch).
    chordalMean: function (Rs) {
      var S = m3.zero(); Rs.forEach(function (R) { S = m3.add(S, R); });
      return projectSO3(S);
    }
  };

  // ---------------------------------------------------------------- quaternions [w,x,y,z]
  var quat = {
    mul: function (a, b) {
      return [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
              a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
              a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
              a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
    },
    conj: function (q) { return [q[0], -q[1], -q[2], -q[3]]; },
    norm: function (q) { return Math.hypot(q[0], q[1], q[2], q[3]); },
    normalize: function (q) { var n = quat.norm(q) || 1; return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]; },
    dot: function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; },
    // Exp of a rotation vector w (angle |w|): q = [cos(|w|/2), sin(|w|/2) w/|w|].
    exp: function (w) {
      var th = v3.norm(w);
      if (th < 1e-8) return quat.normalize([1, w[0] / 2, w[1] / 2, w[2] / 2]);
      var s = Math.sin(th / 2) / th;
      return [Math.cos(th / 2), w[0] * s, w[1] * s, w[2] * s];
    },
    // Rotation vector of q (takes the short way: returns |w| <= pi by flipping q if w<0).
    log: function (q) {
      if (q[0] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
      var vn = Math.hypot(q[1], q[2], q[3]);
      if (vn < 1e-12) return [2 * q[1], 2 * q[2], 2 * q[3]];
      var th = 2 * Math.atan2(vn, q[0]);
      return [q[1] / vn * th, q[2] / vn * th, q[3] / vn * th];
    },
    toMat: function (q) {
      var w = q[0], x = q[1], y = q[2], z = q[3];
      return [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
              [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
              [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]];
    },
    // Shepperd's method: pick the largest of w,x,y,z to divide by.
    fromMat: function (R) {
      var tr = m3.trace(R), q;
      if (tr > R[0][0] && tr > R[1][1] && tr > R[2][2]) {
        var s = Math.sqrt(1 + tr) * 2;
        q = [s / 4, (R[2][1] - R[1][2]) / s, (R[0][2] - R[2][0]) / s, (R[1][0] - R[0][1]) / s];
      } else if (R[0][0] > R[1][1] && R[0][0] > R[2][2]) {
        var s1 = Math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]) * 2;
        q = [(R[2][1] - R[1][2]) / s1, s1 / 4, (R[0][1] + R[1][0]) / s1, (R[0][2] + R[2][0]) / s1];
      } else if (R[1][1] > R[2][2]) {
        var s2 = Math.sqrt(1 + R[1][1] - R[0][0] - R[2][2]) * 2;
        q = [(R[0][2] - R[2][0]) / s2, (R[0][1] + R[1][0]) / s2, s2 / 4, (R[1][2] + R[2][1]) / s2];
      } else {
        var s3 = Math.sqrt(1 + R[2][2] - R[0][0] - R[1][1]) * 2;
        q = [(R[1][0] - R[0][1]) / s3, (R[0][2] + R[2][0]) / s3, (R[1][2] + R[2][1]) / s3, s3 / 4];
      }
      if (q[0] < 0) q = q.map(function (x) { return -x; });
      return quat.normalize(q);
    },
    rotate: function (q, v) {
      var p = quat.mul(quat.mul(q, [0, v[0], v[1], v[2]]), quat.conj(q));
      return [p[1], p[2], p[3]];
    },
    // Spherical linear interpolation. shortest=true flips b onto a's hemisphere first.
    slerp: function (a, b, t, shortest) {
      var d = quat.dot(a, b);
      if (shortest !== false && d < 0) { b = b.map(function (x) { return -x; }); d = -d; }
      d = Math.max(-1, Math.min(1, d));
      if (d > 0.9995) return quat.normalize([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]);
      var om = Math.acos(d), so = Math.sin(om);
      var wa = Math.sin((1 - t) * om) / so, wb = Math.sin(t * om) / so;
      return [wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2], wa * a[3] + wb * b[3]];
    }
  };

  // Closest rotation to an arbitrary 3x3 M in the Frobenius sense (= the rotation that
  // maximises trace(R^T M)), through Horn's 4x4 quaternion eigenproblem.
  function projectSO3(M) {
    var Sxx = M[0][0], Sxy = M[1][0], Sxz = M[2][0], Syx = M[0][1], Syy = M[1][1], Syz = M[2][1], Szx = M[0][2], Szy = M[1][2], Szz = M[2][2];
    // trace(R^T M) = q^T N q with N built from M (R rotates, so we want R ~ M).
    var N = [
      [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
      [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
      [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
      [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz]
    ];
    var e = mN.eigSym(N);
    return quat.toMat(quat.normalize(e.vectors[0]));
  }

  // Kabsch/Horn: the rotation R minimising sum |R p_i + t - q_i|^2 (centred internally).
  // Returns {R, t}. P and Q are arrays of 3-vectors.
  function kabsch(P, Q) {
    var n = P.length, cp = [0, 0, 0], cq = [0, 0, 0];
    P.forEach(function (p) { cp = v3.add(cp, p); }); Q.forEach(function (q) { cq = v3.add(cq, q); });
    cp = v3.scale(cp, 1 / n); cq = v3.scale(cq, 1 / n);
    var H = m3.zero();
    for (var i = 0; i < n; i++) H = m3.add(H, m3.outer(v3.sub(Q[i], cq), v3.sub(P[i], cp)));
    var R = projectSO3(H);
    return { R: R, t: v3.sub(cq, m3.mulV(R, cp)) };
  }

  // ---------------------------------------------------------------- SE(2)
  // Elements are 3x3 homogeneous matrices [[R t],[0 0 1]]; tau = [rho1, rho2, theta].
  var se2 = {
    make: function (x, y, th) { var c = Math.cos(th), s = Math.sin(th); return [[c, -s, x], [s, c, y], [0, 0, 1]]; },
    parts: function (T) { return { x: T[0][2], y: T[1][2], th: Math.atan2(T[1][0], T[0][0]) }; },
    hat: function (tau) { return [[0, -tau[2], tau[0]], [tau[2], 0, tau[1]], [0, 0, 0]]; },
    vee: function (W) { return [W[0][2], W[1][2], W[1][0]]; },
    V: function (th) {
      var a, b;
      if (Math.abs(th) < 1e-4) { a = 1 - th * th / 6; b = th / 2 - th * th * th / 24; }
      else { a = Math.sin(th) / th; b = (1 - Math.cos(th)) / th; }
      return [[a, -b], [b, a]];
    },
    exp: function (tau) {
      var V = se2.V(tau[2]);
      return se2.make(V[0][0] * tau[0] + V[0][1] * tau[1], V[1][0] * tau[0] + V[1][1] * tau[1], tau[2]);
    },
    log: function (T) {
      var th = Math.atan2(T[1][0], T[0][0]), V = se2.V(th);
      var d = V[0][0] * V[1][1] - V[0][1] * V[1][0];
      var x = T[0][2], y = T[1][2];
      return [(V[1][1] * x - V[0][1] * y) / d, (-V[1][0] * x + V[0][0] * y) / d, th];
    },
    mul: function (A, B) { return mN.mul(A, B); },
    inv: function (T) {
      var c = T[0][0], s = T[1][0], x = T[0][2], y = T[1][2];
      return [[c, s, -(c * x + s * y)], [-s, c, -(-s * x + c * y)], [0, 0, 1]];
    },
    act: function (T, p) { return [T[0][0] * p[0] + T[0][1] * p[1] + T[0][2], T[1][0] * p[0] + T[1][1] * p[1] + T[1][2]]; },
    Ad: function (T) { return [[T[0][0], T[0][1], T[1][2]], [T[1][0], T[1][1], -T[0][2]], [0, 0, 1]]; },
    plus: function (T, d) { return mN.mul(T, se2.exp(d)); },
    minus: function (T2, T1) { return se2.log(mN.mul(se2.inv(T1), T2)); }
  };

  // ---------------------------------------------------------------- SE(3)
  // Elements are 4x4 homogeneous matrices; tau = [rho(3), phi(3)].
  function se3Make(R, t) { return [[R[0][0], R[0][1], R[0][2], t[0]], [R[1][0], R[1][1], R[1][2], t[1]], [R[2][0], R[2][1], R[2][2], t[2]], [0, 0, 0, 1]]; }
  function se3R(T) { return [[T[0][0], T[0][1], T[0][2]], [T[1][0], T[1][1], T[1][2]], [T[2][0], T[2][1], T[2][2]]]; }
  function se3t(T) { return [T[0][3], T[1][3], T[2][3]]; }

  // Barfoot's Q(rho, phi) block of the SE(3) left Jacobian.
  function se3Q(rho, phi) {
    var th2 = v3.dot(phi, phi), th = Math.sqrt(th2);
    var P = hat3(phi), Rh = hat3(rho);
    var PR = m3.mul(P, Rh), RP = m3.mul(Rh, P), PRP = m3.mul(PR, P);
    var PPR = m3.mul(P, PR), RPP = m3.mul(RP, P);
    var PRPP = m3.mul(PRP, P), PPRP = m3.mul(P, PRP);
    var c1, c2, c3;
    if (th < 1e-3) { c1 = 1 / 6 - th2 / 120; c2 = 1 / 24 - th2 / 720; c3 = 1 / 120 - th2 / 2520; }
    else {
      var s = Math.sin(th), c = Math.cos(th);
      c1 = (th - s) / (th2 * th);
      c2 = (th2 + 2 * c - 2) / (2 * th2 * th2);
      c3 = (2 * th - 3 * s + th * c) / (2 * th2 * th2 * th);
    }
    var Q = m3.scale(Rh, 0.5);
    Q = m3.add(Q, m3.scale(m3.add(m3.add(PR, RP), PRP), c1));
    Q = m3.add(Q, m3.scale(m3.sub(m3.add(PPR, RPP), m3.scale(PRP, 3)), c2));
    Q = m3.add(Q, m3.scale(m3.add(PRPP, PPRP), c3));
    return Q;
  }

  var se3 = {
    make: se3Make,
    R: se3R,
    t: se3t,
    hat: function (tau) { var P = hat3([tau[3], tau[4], tau[5]]); return [[P[0][0], P[0][1], P[0][2], tau[0]], [P[1][0], P[1][1], P[1][2], tau[1]], [P[2][0], P[2][1], P[2][2], tau[2]], [0, 0, 0, 0]]; },
    vee: function (W) { return [W[0][3], W[1][3], W[2][3], W[2][1], W[0][2], W[1][0]]; },
    exp: function (tau) {
      var rho = [tau[0], tau[1], tau[2]], phi = [tau[3], tau[4], tau[5]];
      return se3Make(so3.exp(phi), m3.mulV(so3.Jl(phi), rho));
    },
    log: function (T) {
      var phi = so3.log(se3R(T)), rho = m3.mulV(so3.JlInv(phi), se3t(T));
      return rho.concat(phi);
    },
    V: function (phi) { return so3.Jl(phi); },
    mul: function (A, B) { return mN.mul(A, B); },
    inv: function (T) { var Rt = m3.T(se3R(T)); return se3Make(Rt, v3.scale(m3.mulV(Rt, se3t(T)), -1)); },
    act: function (T, p) { return v3.add(m3.mulV(se3R(T), p), se3t(T)); },
    Ad: function (T) { var R = se3R(T); return mN.block(R, m3.mul(hat3(se3t(T)), R), m3.zero(), R); },
    Q: se3Q,
    Jl: function (tau) {
      var rho = [tau[0], tau[1], tau[2]], phi = [tau[3], tau[4], tau[5]], J = so3.Jl(phi);
      return mN.block(J, se3Q(rho, phi), m3.zero(), J);
    },
    Jr: function (tau) { return se3.Jl(tau.map(function (x) { return -x; })); },
    plus: function (T, d) { return mN.mul(T, se3.exp(d)); },
    minus: function (T2, T1) { return se3.log(mN.mul(se3.inv(T1), T2)); },
    plusL: function (T, d) { return mN.mul(se3.exp(d), T); },
    minusL: function (T2, T1) { return se3.log(mN.mul(T2, se3.inv(T1))); }
  };

  // ---------------------------------------------------------------- Euler ZYX
  var euler = {
    // R = Rz(yaw) Ry(pitch) Rx(roll)
    toMat: function (yaw, pitch, roll) { return m3.mul(m3.mul(m3.Rz(yaw), m3.Ry(pitch)), m3.Rx(roll)); },
    fromMat: function (R) {
      var sp = Math.max(-1, Math.min(1, -R[2][0]));
      var pitch = Math.asin(sp);
      if (Math.abs(sp) > 1 - 1e-9) {
        // gimbal lock: only yaw -/+ roll is observable; put it all into yaw.
        return { yaw: Math.atan2(-R[0][1], R[1][1]), pitch: pitch, roll: 0, locked: true };
      }
      return { yaw: Math.atan2(R[1][0], R[0][0]), pitch: pitch, roll: Math.atan2(R[2][1], R[2][2]), locked: false };
    },
    // Angular-velocity map: omega_body = E(pitch, roll) * [yawdot, pitchdot, rolldot].
    // Its determinant is cos(pitch): it goes singular at pitch = +/-90 degrees.
    rateMatrix: function (pitch, roll) {
      var sp = Math.sin(pitch), cp = Math.cos(pitch), sr = Math.sin(roll), cr = Math.cos(roll);
      return [[-sp, 0, 1], [cp * sr, cr, 0], [cp * cr, -sr, 0]];
    }
  };

  // ---------------------------------------------------------------- numerical Jacobian
  // J[:,i] = ( minusOut(f(plusIn(x, h e_i)), y0) - minusOut(f(plusIn(x, -h e_i)), y0) ) / 2h
  // with y0 = f(x). For vector spaces pass plus = (x,d)=>x+d, minus = (a,b)=>a-b.
  function numJac(f, x, dimIn, plusIn, minusOut, h) {
    h = h || 1e-6;
    var y0 = f(x), cols = [];
    for (var i = 0; i < dimIn; i++) {
      var e = new Array(dimIn).fill(0); e[i] = h;
      var em = new Array(dimIn).fill(0); em[i] = -h;
      var a = minusOut(f(plusIn(x, e)), y0), b = minusOut(f(plusIn(x, em)), y0);
      cols.push(a.map(function (ai, k) { return (ai - b[k]) / (2 * h); }));
    }
    return mN.T(cols);
  }
  function vecPlus(x, d) { return x.map(function (xi, i) { return xi + d[i]; }); }
  function vecMinus(a, b) { return a.map(function (ai, i) { return ai - b[i]; }); }

  // ---------------------------------------------------------------- random helpers
  function gauss(rng) {
    var u = Math.max(rng(), 1e-12), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  // Fallback LCG so the file also works without guide-core.js (e.g. in the node checker).
  function lcg(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // ---------------------------------------------------------------- formatting
  function fmt(x, n) { n = n == null ? 3 : n; if (!isFinite(x)) return String(x); var s = x.toFixed(n); return (s.charAt(0) === '-' ? '' : ' ') + s; }
  function fmtV(v, n) { return '(' + v.map(function (x) { return fmt(x, n); }).join(', ') + ')'; }
  function matHTML(M, n, hiFn) {
    n = n == null ? 3 : n;
    var cols = M[0].length, out = '<div class="lie-mat" style="grid-template-columns:repeat(' + cols + ',auto)">';
    for (var i = 0; i < M.length; i++) for (var j = 0; j < cols; j++) {
      var cls = hiFn ? hiFn(i, j, M[i][j]) : '';
      out += '<span' + (cls ? ' class="' + cls + '"' : '') + '>' + fmt(M[i][j], n) + '</span>';
    }
    return out + '</div>';
  }
  function sci(x) { if (!isFinite(x)) return String(x); if (x === 0) return '0'; return x.toExponential(1); }

  // ---------------------------------------------------------------- 3D view
  // Orthographic, z up. view.az / view.el in radians. Drag on empty canvas to orbit;
  // opts.handles() may return [{x,y,r,id}] in logical coords, and opts.onHandle(id,x,y)
  // receives drags that start on one. draw(view) is called on every change.
  function view3d(canvas, opts) {
    opts = opts || {};
    var W = opts.width || 640, H = opts.height || 400;
    var G = global.Guide;
    var view = {
      az: opts.az != null ? opts.az : -0.65, el: opts.el != null ? opts.el : 0.42,
      scale: opts.scale || 120, cx: opts.cx != null ? opts.cx : W / 2, cy: opts.cy != null ? opts.cy : H / 2,
      W: W, H: H, ctx: null, colors: null
    };
    view.ctx = canvas.getContext('2d');

    function basis() {
      var ca = Math.cos(view.az), sa = Math.sin(view.az), ce = Math.cos(view.el), se = Math.sin(view.el);
      return { r: [-sa, ca, 0], u: [-se * ca, -se * sa, ce], e: [ce * ca, ce * sa, se] };
    }
    view.project = function (p) {
      var b = basis();
      return [view.cx + view.scale * v3.dot(p, b.r), view.cy - view.scale * v3.dot(p, b.u), v3.dot(p, b.e)];
    };
    view.depth = function (p) { return v3.dot(p, basis().e); };
    view.eye = function () { return basis().e; };

    function style(ctx, o) {
      ctx.strokeStyle = o.color || view.colors.text; ctx.fillStyle = o.color || view.colors.text;
      ctx.lineWidth = o.width || 2; ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
      ctx.setLineDash(o.dash ? [5, 4] : []);
    }
    view.line = function (a, b, o) {
      o = o || {}; var ctx = view.ctx, A = view.project(a), B = view.project(b);
      ctx.save(); style(ctx, o); ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); ctx.restore();
    };
    view.poly = function (pts, o) {
      o = o || {}; if (pts.length < 2) return; var ctx = view.ctx;
      ctx.save(); style(ctx, o); ctx.beginPath();
      pts.forEach(function (p, i) { var P = view.project(p); if (i) ctx.lineTo(P[0], P[1]); else ctx.moveTo(P[0], P[1]); });
      if (o.close) ctx.closePath();
      if (o.fill) { ctx.globalAlpha = o.fillAlpha || 0.12; ctx.fillStyle = o.fill; ctx.fill(); ctx.globalAlpha = o.alpha == null ? 1 : o.alpha; }
      ctx.stroke(); ctx.restore();
    };
    view.arrow = function (a, b, o) {
      o = o || {}; var A = view.project(a), B = view.project(b);
      view.ctx.save(); view.ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
      G.drawArrow(view.ctx, A[0], A[1], B[0], B[1], { color: o.color || view.colors.text, width: o.width || 2.2, head: o.head || 9, dashed: o.dash, label: o.label, labelColor: o.labelColor });
      view.ctx.restore();
    };
    view.point = function (p, o) {
      o = o || {}; var P = view.project(p), ctx = view.ctx;
      ctx.save(); ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
      ctx.beginPath(); ctx.arc(P[0], P[1], o.r || 4, 0, 2 * Math.PI);
      if (o.hollow) { ctx.strokeStyle = o.color || view.colors.text; ctx.lineWidth = 1.6; ctx.stroke(); }
      else { ctx.fillStyle = o.color || view.colors.text; ctx.fill(); }
      ctx.restore(); return P;
    };
    view.text = function (p, s, o) {
      o = o || {}; var P = view.project(p), ctx = view.ctx;
      ctx.save(); ctx.fillStyle = o.color || view.colors.text; ctx.globalAlpha = o.alpha == null ? 0.9 : o.alpha;
      ctx.font = (o.size || 12) + 'px ' + view.colors.font; ctx.textAlign = o.align || 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(s, P[0] + (o.dx || 0), P[1] + (o.dy || 0)); ctx.restore();
    };
    view.axisColors = function () { return ['#d6336c', '#2f9e44', view.colors.accent]; };
    // Coordinate triad for rotation R at origin t: x, y, z columns.
    view.frame = function (R, t, o) {
      o = o || {}; t = t || [0, 0, 0]; var len = o.len || 1, cols = o.colors || view.axisColors();
      for (var j = 0; j < 3; j++) {
        var c = [R[0][j], R[1][j], R[2][j]];
        view.arrow(t, v3.add(t, v3.scale(c, len)), { color: cols[j], width: o.width || 2.4, alpha: o.alpha, dash: o.dash, label: o.labels ? ['x', 'y', 'z'][j] + (o.suffix || '') : null, labelColor: cols[j] });
      }
    };
    view.grid = function (o) {
      o = o || {}; var n = o.n || 4, s = o.step || 0.5, z = o.z == null ? 0 : o.z;
      for (var i = -n; i <= n; i++) {
        view.line([i * s, -n * s, z], [i * s, n * s, z], { color: view.colors.text, width: 1, alpha: i === 0 ? 0.18 : 0.07 });
        view.line([-n * s, i * s, z], [n * s, i * s, z], { color: view.colors.text, width: 1, alpha: i === 0 ? 0.18 : 0.07 });
      }
    };
    view.worldAxes = function (len) {
      len = len || 1.4; var cols = view.axisColors();
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach(function (e, j) {
        view.line([0, 0, 0], v3.scale(e, len), { color: cols[j], width: 1, alpha: 0.35, dash: true });
        view.text(v3.scale(e, len * 1.06), ['X', 'Y', 'Z'][j], { color: cols[j], alpha: 0.55, size: 11 });
      });
    };
    // Wireframe sphere of radius r with back-facing arcs faded.
    view.sphere = function (r, o) {
      o = o || {}; r = r || 1; var e = view.eye(), ctx = view.ctx, col = o.color || view.colors.text;
      function arc(fn) {
        var prev = null, prevFront = null;
        for (var k = 0; k <= 64; k++) {
          var p = fn(2 * Math.PI * k / 64), P = view.project(p), front = v3.dot(p, e) >= 0;
          if (prev) {
            ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.globalAlpha = (front && prevFront) ? (o.alpha || 0.22) : (o.backAlpha || 0.07);
            ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(P[0], P[1]); ctx.stroke(); ctx.restore();
          }
          prev = P; prevFront = front;
        }
      }
      for (var lat = -60; lat <= 60; lat += 30) {
        var la = lat * Math.PI / 180;
        arc(function (t) { return [r * Math.cos(la) * Math.cos(t), r * Math.cos(la) * Math.sin(t), r * Math.sin(la)]; });
      }
      for (var lon = 0; lon < 180; lon += 30) {
        var lo = lon * Math.PI / 180;
        arc(function (t) { return [r * Math.cos(t) * Math.cos(lo), r * Math.cos(t) * Math.sin(lo), r * Math.sin(t)]; });
      }
      // silhouette
      var b = basis(), P0 = view.project([0, 0, 0]);
      ctx.save(); ctx.strokeStyle = col; ctx.globalAlpha = o.rimAlpha || 0.35; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(P0[0], P0[1], r * view.scale, 0, 2 * Math.PI); ctx.stroke(); ctx.restore();
      void b;
    };
    // A wireframe box (a "body") posed by R, t with half-extents h.
    view.box = function (R, t, h, o) {
      o = o || {}; t = t || [0, 0, 0]; h = h || [0.5, 0.3, 0.15];
      var V = [];
      [-1, 1].forEach(function (sx) { [-1, 1].forEach(function (sy) { [-1, 1].forEach(function (sz) { V.push(v3.add(t, m3.mulV(R, [sx * h[0], sy * h[1], sz * h[2]]))); }); }); });
      var E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
      E.forEach(function (ed) { view.line(V[ed[0]], V[ed[1]], { color: o.color, width: o.width || 1.4, alpha: o.alpha == null ? 0.8 : o.alpha, dash: o.dash }); });
      if (o.nose !== false) view.arrow(t, v3.add(t, m3.mulV(R, [h[0] * 1.9, 0, 0])), { color: o.color || view.colors.text, width: 1.6, alpha: o.alpha == null ? 0.8 : o.alpha });
    };
    view.clear = function () {
      view.colors = G.colors();
      view.ctx.clearRect(0, 0, W, H);
    };

    function redraw() { view.clear(); if (opts.draw) opts.draw(view); }
    view.redraw = redraw;

    // pointer: handles first, orbit otherwise
    var drag = null;
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', function (ev) {
      var p = G.hitTest(canvas, ev);
      var hs = opts.handles ? opts.handles(view) || [] : [];
      var hit = null, best = Infinity;
      hs.forEach(function (h) { var d = Math.hypot(p.x - h.x, p.y - h.y); if (d <= (h.r || 12) && d < best) { hit = h; best = d; } });
      drag = hit ? { id: hit.id } : (opts.orbit === false ? null : { orbit: true, x: p.x, y: p.y, az: view.az, el: view.el });
      if (!drag) return;
      canvas.style.cursor = 'grabbing';
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ } }
      ev.preventDefault();
    });
    canvas.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      var p = G.hitTest(canvas, ev);
      if (drag.orbit) {
        view.az = drag.az - (p.x - drag.x) * 0.01;
        view.el = Math.max(-1.45, Math.min(1.45, drag.el + (p.y - drag.y) * 0.01));
        redraw();
      } else if (opts.onHandle) { opts.onHandle(drag.id, p.x, p.y, view); }
      ev.preventDefault();
    });
    function end() { drag = null; canvas.style.cursor = 'grab'; }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    // Inverse of project for a point constrained to the screen plane through the origin
    // shifted by `anchor` — used by drag handles that move in the view plane.
    view.unproject = function (x, y, anchor) {
      var b = basis(); anchor = anchor || [0, 0, 0];
      var a = view.project(anchor);
      var dx = (x - a[0]) / view.scale, dy = -(y - a[1]) / view.scale;
      return v3.add(anchor, v3.add(v3.scale(b.r, dx), v3.scale(b.u, dy)));
    };

    // setupCanvas sizes the backing store for the device pixel ratio and calls redraw now
    // and on every resize. It is deferred to a microtask so a page can create the view
    // first and define the state its draw callback reads afterwards.
    Promise.resolve().then(function () { G.setupCanvas(canvas, W, H, redraw); });
    return view;
  }

  // ---------------------------------------------------------------- simple 2D axes helper
  // plane2d(ctx, W, H, {xr:[a,b], yr:[c,d], pad}) -> {px, py, wx, wy, axes()}
  function plane2d(ctx, W, H, o) {
    o = o || {}; var pad = o.pad || 30, xr = o.xr || [-2, 2], yr = o.yr || [-2, 2];
    var sx = (W - 2 * pad) / (xr[1] - xr[0]), sy = (H - 2 * pad) / (yr[1] - yr[0]);
    if (o.equal !== false) { var s = Math.min(sx, sy); sx = s; sy = s; }
    var cx = W / 2 - sx * (xr[0] + xr[1]) / 2, cy = H / 2 + sy * (yr[0] + yr[1]) / 2;
    var P = {
      px: function (x) { return cx + sx * x; }, py: function (y) { return cy - sy * y; },
      wx: function (X) { return (X - cx) / sx; }, wy: function (Y) { return (cy - Y) / sy; },
      sx: sx, sy: sy
    };
    P.axes = function (col) {
      var c = global.Guide ? global.Guide.colors() : { text: '#222' };
      ctx.save(); ctx.strokeStyle = col || c.text; ctx.globalAlpha = 0.18; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, P.py(0)); ctx.lineTo(W, P.py(0)); ctx.moveTo(P.px(0), 0); ctx.lineTo(P.px(0), H); ctx.stroke();
      ctx.restore();
    };
    return P;
  }

  global.Lie = {
    m3: m3, v3: v3, mN: mN,
    so2: so2, so3: so3, se2: se2, se3: se3, quat: quat, euler: euler,
    numJac: numJac, vecPlus: vecPlus, vecMinus: vecMinus,
    projectSO3: projectSO3, kabsch: kabsch,
    gauss: gauss, lcg: lcg,
    fmt: fmt, fmtV: fmtV, matHTML: matHTML, sci: sci,
    view3d: view3d, plane2d: plane2d,
    deg: function (r) { return r * 180 / Math.PI; },
    rad: function (d) { return d * Math.PI / 180; }
  };
})(typeof window !== 'undefined' ? window : this);
