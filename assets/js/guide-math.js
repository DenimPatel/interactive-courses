/* Guide kit — subject-neutral vector/matrix helpers for NEW interactive guide pages.
 * These are the byte-for-byte algorithms already duplicated across the multi-view-geometry
 * and nonlinear-optimization pages (MVG.sub/add/scale/dot/cross/norm/normalize/matVec/
 * orbitCamera in vision/multi-view-geometry/pinhole-camera/index.html and siblings;
 * solveN in vision/nonlinear-optimization/{pose-graph,slam}/index.html; jacobiEigenSymmetric
 * in vision/multi-view-geometry/epipolar/index.html; gaussianNoise/deg2rad/rad2deg in
 * vision/nonlinear-optimization/rotations/index.html) — promoted here so a NEW page can
 * `include` this file instead of re-pasting them. The 19 existing vision pages are left
 * exactly as they are; only new pages should reach for window.GuideMath.
 * Load before any page-specific <script>. */
(function (global) {
  "use strict";

  // ---- 3-vectors ----
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function norm(a) { return Math.hypot(a[0], a[1], a[2]); }
  function normalize(a) { var n = norm(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; }
  // R as array-of-rows (3x3); returns R*v.
  function matVec(R, v) { return [dot(R[0], v), dot(R[1], v), dot(R[2], v)]; }

  // Camera pose from orbit params: right/down/forward camera-space axes (standard CV
  // convention, y-down). Returns { C: [x,y,z], R: [right, down, forward] }.
  function orbitCamera(az, el, dist, lookAt) {
    lookAt = lookAt || [0, 0, 0];
    var C = [
      lookAt[0] + dist * Math.cos(el) * Math.sin(az),
      lookAt[1] + dist * Math.sin(el),
      lookAt[2] + dist * Math.cos(el) * Math.cos(az)
    ];
    var forward = normalize(sub(lookAt, C));
    var right = normalize(cross(forward, [0, 1, 0]));
    var down = cross(forward, right);
    return { C: C, R: [right, down, forward] };
  }

  // Solve an N x N linear system H*x = -g by Gaussian elimination with partial
  // pivoting (the normal-equations solve every Gauss-Newton/Levenberg-Marquardt
  // step in the optimization guide reduces to). Returns null if singular.
  function solveLinearN(H, g, n) {
    n = n || H.length;
    var A = H.map(function (row) { return row.slice(); });
    var b = g.map(function (v) { return -v; });
    for (var col = 0; col < n; col++) {
      var piv = col;
      for (var r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      if (Math.abs(A[piv][col]) < 1e-10) return null;
      if (piv !== col) {
        var t = A[piv]; A[piv] = A[col]; A[col] = t;
        var tb = b[piv]; b[piv] = b[col]; b[col] = tb;
      }
      for (r = col + 1; r < n; r++) {
        var f = A[r][col] / A[col][col];
        for (var c = col; c < n; c++) A[r][c] -= f * A[col][c];
        b[r] -= f * b[col];
      }
    }
    var x = new Array(n).fill(0);
    for (r = n - 1; r >= 0; r--) {
      var s = b[r];
      for (c = r + 1; c < n; c++) s -= A[r][c] * x[c];
      x[r] = s / A[r][r];
    }
    return x;
  }

  // Symmetric eigendecomposition by the cyclic Jacobi method. Ain: n x n symmetric
  // matrix (array-of-rows). Returns { values: [n], vectors: n x n (columns are
  // eigenvectors) }. Used for SVD-via-eigendecomposition (AtA, homography DLT, etc).
  function jacobiEigenSymmetric(Ain, n) {
    n = n || Ain.length;
    var A = Ain.map(function (row) { return row.slice(); });
    var V = [];
    for (var i = 0; i < n; i++) { V.push([]); for (var j = 0; j < n; j++) V[i].push(i === j ? 1 : 0); }
    for (var sweep = 0; sweep < 60; sweep++) {
      for (var p = 0; p < n - 1; p++) {
        for (var q = p + 1; q < n; q++) {
          if (Math.abs(A[p][q]) < 1e-13) continue;
          var theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
          var sgn = theta >= 0 ? 1 : -1;
          var t = sgn / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
          var c = 1 / Math.sqrt(t * t + 1), s = t * c;
          var app = A[p][p], aqq = A[q][q], apq = A[p][q];
          A[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
          A[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
          A[p][q] = 0; A[q][p] = 0;
          for (var i2 = 0; i2 < n; i2++) {
            if (i2 !== p && i2 !== q) {
              var aip = A[i2][p], aiq = A[i2][q];
              A[i2][p] = c * aip - s * aiq; A[p][i2] = A[i2][p];
              A[i2][q] = s * aip + c * aiq; A[q][i2] = A[i2][q];
            }
          }
          for (i2 = 0; i2 < n; i2++) {
            var vip = V[i2][p], viq = V[i2][q];
            V[i2][p] = c * vip - s * viq;
            V[i2][q] = s * vip + c * viq;
          }
        }
      }
    }
    var values = []; for (var d = 0; d < n; d++) values.push(A[d][d]);
    return { values: values, vectors: V };
  }

  // Box-Muller Gaussian noise generator.
  function gaussianNoise(std) {
    var u = Math.max(Math.random(), 1e-9), v = Math.random();
    return std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function deg2rad(d) { return d * Math.PI / 180; }
  function rad2deg(r) { return r * 180 / Math.PI; }

  global.GuideMath = {
    sub: sub, add: add, scale: scale, dot: dot, cross: cross,
    norm: norm, normalize: normalize, matVec: matVec, orbitCamera: orbitCamera,
    solveLinearN: solveLinearN, jacobiEigenSymmetric: jacobiEigenSymmetric,
    gaussianNoise: gaussianNoise, deg2rad: deg2rad, rad2deg: rad2deg
  };
})(window);
