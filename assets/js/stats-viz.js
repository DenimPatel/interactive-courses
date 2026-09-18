/* stats-viz.js — the domain layer for the /math/statistics/ guide, the way
 * linalg-viz.js is the domain layer for /math/linear-algebra/ and serving-sim.js
 * is for /ai/llm-serving/. Loaded last, after the kit (guide-core.js) and after
 * linalg-viz.js on the pages that also want LinAlg.mat / LinAlg.plane.
 *
 * What lives here, and why:
 *   - The special functions (erf, lgamma, regularized incomplete beta/gamma)
 *     nothing in the repo provides, without which exact t / chi-square / F tail
 *     areas are impossible.
 *   - Named-distribution pdf/cdf/quantile and seeded samplers for every
 *     distribution the series draws from, plus the summary statistics.
 *   - Estimators (OLS, ridge, lasso, MLE), resampling (bootstrap, permutation,
 *     jackknife), classical tests, Bayesian helpers (conjugate updates,
 *     Metropolis, Gibbs, Laplace, R-hat), recursive filters (histogram, Kalman,
 *     EKF, particle) and the ML/causal metrics.
 *   - Stats.plot — the series' canvas widget, modelled directly on
 *     LinAlg.plane (assets/js/linalg-viz.js): Guide.setupCanvas plus
 *     Guide.dragHandles, the same px/py/wx/wy world<->pixel mapping and the same
 *     handles(specsOrFn, onChange) contract (world coordinates in and out).
 *
 * House rule: no Math.random() anywhere. Every sampler takes an `rng` first
 * argument, made with Stats.rng(seed). (GuideMath.gaussianNoise uses
 * Math.random() and is therefore deliberately not used here.)
 *
 * Exposes window.Stats. Depends on window.Guide for colors()/setupCanvas()/
 * dragHandles()/niceTicks() at call time. Does not depend on LinAlg; the few
 * matrix routines it needs (solve, inverse, chol) are local because their only
 * consumers are statistics pages. */
(function (global) {
  "use strict";

  function Guide() { return global.Guide; }
  function colors() { return Guide().colors(); }

  // =========================================================================
  // tiny linear-algebra helpers (local; LinAlg.mat is N-D and heavier)
  // =========================================================================
  function matZeros(m, n) { var A = []; for (var i = 0; i < m; i++) { var r = []; for (var j = 0; j < n; j++) r.push(0); A.push(r); } return A; }
  function matIdentity(n) { var A = matZeros(n, n); for (var i = 0; i < n; i++) A[i][i] = 1; return A; }
  function matClone(A) { return A.map(function (r) { return r.slice(); }); }
  function matTranspose(A) { var m = A.length, n = A[0].length, T = matZeros(n, m); for (var i = 0; i < m; i++) for (var j = 0; j < n; j++) T[j][i] = A[i][j]; return T; }
  function matMul(A, B) {
    var m = A.length, n = B[0].length, p = B.length, C = matZeros(m, n);
    for (var i = 0; i < m; i++) for (var j = 0; j < n; j++) { var s = 0; for (var k = 0; k < p; k++) s += A[i][k] * B[k][j]; C[i][j] = s; }
    return C;
  }
  function matVec(A, v) { return A.map(function (row) { var s = 0; for (var j = 0; j < v.length; j++) s += row[j] * v[j]; return s; }); }
  function vdot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  function vsub(a, b) { return a.map(function (x, i) { return x - b[i]; }); }
  function vadd(a, b) { return a.map(function (x, i) { return x + b[i]; }); }
  function vscale(a, k) { return a.map(function (x) { return x * k; }); }

  // Gaussian elimination with partial pivoting. Returns null if singular.
  function solveLinear(Ain, bin) {
    var n = Ain.length, A = matClone(Ain), b = bin.slice();
    for (var col = 0; col < n; col++) {
      var piv = col;
      for (var r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      if (Math.abs(A[piv][col]) < 1e-13) return null;
      if (piv !== col) { var t = A[piv]; A[piv] = A[col]; A[col] = t; var tb = b[piv]; b[piv] = b[col]; b[col] = tb; }
      for (r = col + 1; r < n; r++) {
        var f = A[r][col] / A[col][col];
        for (var c = col; c < n; c++) A[r][c] -= f * A[col][c];
        b[r] -= f * b[col];
      }
    }
    var x = new Array(n).fill(0);
    for (r = n - 1; r >= 0; r--) { var s = b[r]; for (c = r + 1; c < n; c++) s -= A[r][c] * x[c]; x[r] = s / A[r][r]; }
    return x;
  }

  function matInverse(A) {
    var n = A.length, M = matClone(A), I = matIdentity(n);
    for (var col = 0; col < n; col++) {
      var piv = col;
      for (var r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      if (Math.abs(M[piv][col]) < 1e-12) return null;
      if (piv !== col) { var t = M[piv]; M[piv] = M[col]; M[col] = t; var ti = I[piv]; I[piv] = I[col]; I[col] = ti; }
      var d = M[col][col];
      for (var j = 0; j < n; j++) { M[col][j] /= d; I[col][j] /= d; }
      for (var i2 = 0; i2 < n; i2++) {
        if (i2 === col) continue;
        var f = M[i2][col]; if (f === 0) continue;
        for (j = 0; j < n; j++) { M[i2][j] -= f * M[col][j]; I[i2][j] -= f * I[col][j]; }
      }
    }
    return I;
  }

  // Cholesky: A = L L^T, A symmetric positive definite (array of rows).
  // Returns lower-triangular L, or null if A is not PD.
  function chol(A) {
    var n = A.length, L = matZeros(n, n);
    for (var i = 0; i < n; i++) {
      for (var j = 0; j <= i; j++) {
        var s = A[i][j];
        for (var k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) {
          if (s <= 1e-14) return null;
          L[i][j] = Math.sqrt(s);
        } else {
          L[i][j] = s / L[j][j];
        }
      }
    }
    return L;
  }

  // =========================================================================
  // seeded RNG
  // =========================================================================
  function rng(seed) { return Guide().seededRandom(seed); }

  function gauss(r) {
    var u = 0, v = 0;
    while (u <= 1e-12) u = r();
    v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // =========================================================================
  // special functions
  // =========================================================================
  var LANCZOS = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
  ];
  function lgamma(z) {
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
    z -= 1;
    var x = LANCZOS[0];
    for (var i = 1; i < 9; i++) x += LANCZOS[i] / (z + i);
    var t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  function lbeta(a, b) { return lgamma(a) + lgamma(b) - lgamma(a + b); }

  var FPMIN = 1e-300;
  function gser(a, x) {
    var gln = lgamma(a), ap = a, sum = 1 / a, del = sum;
    for (var n = 1; n < 500; n++) {
      ap++; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  function gcf(a, x) {
    var gln = lgamma(a), b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (var i = 1; i < 500; i++) {
      var an = -i * (i - a);
      b += 2; d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; var del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-16) break;
    }
    return Math.exp(-x + a * Math.log(x) - gln) * h;
  }
  // regularized lower incomplete gamma P(a, x)
  function incGamma(a, x) {
    if (x < 0 || a <= 0) return NaN;
    if (x === 0) return 0;
    return x < a + 1 ? gser(a, x) : 1 - gcf(a, x);
  }
  // regularized upper incomplete gamma Q(a, x)
  function incGammaUpper(a, x) { return 1 - incGamma(a, x); }

  function betacf(a, b, x) {
    var qab = a + b, qap = a + 1, qam = a - 1;
    var c = 1, d = 1 - qab * x / qap; if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d; var h = d;
    for (var m = 1; m <= 300; m++) {
      var m2 = 2 * m;
      var aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; var del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-16) break;
    }
    return h;
  }
  // regularized incomplete beta I_x(a, b)
  function incBeta(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var bt = Math.exp(lbeta(a, b) * -1 + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }

  function erf(x) {
    if (x === 0) return 0;
    var p = incGamma(0.5, x * x);
    return x < 0 ? -p : p;
  }
  function erfc(x) { return 1 - erf(x); }

  // Inverse error function via a rational initial guess plus Newton refinement.
  function erfinv(y) {
    if (y <= -1) return -Infinity;
    if (y >= 1) return Infinity;
    if (y === 0) return 0;
    var a = 0.147;
    var ln1 = Math.log(1 - y * y);
    var t1 = 2 / (Math.PI * a) + ln1 / 2;
    var x = Math.sign(y) * Math.sqrt(Math.sqrt(t1 * t1 - ln1 / a) - t1);
    var SQRTPI = Math.sqrt(Math.PI);
    for (var i = 0; i < 3; i++) {
      var e = erf(x) - y;
      x -= e * SQRTPI / (2 * Math.exp(-x * x));
    }
    return x;
  }

  var special = {
    lgamma: lgamma, lbeta: lbeta, incGamma: incGamma, incGammaUpper: incGammaUpper,
    incBeta: incBeta, erf: erf, erfc: erfc, erfinv: erfinv
  };

  // =========================================================================
  // named distributions — each {pdf, cdf, quantile, mean, var}
  // =========================================================================
  function bisectQuantile(cdf, p, lo, hi, iters) {
    lo = lo == null ? -1e6 : lo; hi = hi == null ? 1e6 : hi;
    iters = iters || 200;
    var flo = cdf(lo), fhi = cdf(hi);
    if (p <= flo) return lo;
    if (p >= fhi) return hi;
    for (var i = 0; i < iters; i++) {
      var mid = 0.5 * (lo + hi), fm = cdf(mid);
      if (fm < p) lo = mid; else hi = mid;
      if (hi - lo < 1e-12 * (1 + Math.abs(mid))) break;
    }
    return 0.5 * (lo + hi);
  }

  function normPdf(x, mu, sigma) {
    mu = mu || 0; sigma = sigma == null ? 1 : sigma;
    var z = (x - mu) / sigma;
    return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
  }
  function normCdf(x, mu, sigma) {
    mu = mu || 0; sigma = sigma == null ? 1 : sigma;
    return 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2)));
  }
  // standard-normal inverse cdf
  function normQuantile(p, mu, sigma) {
    mu = mu || 0; sigma = sigma == null ? 1 : sigma;
    return mu + sigma * Math.SQRT2 * erfinv(2 * p - 1);
  }

  function tPdf(x, df) {
    return Math.exp(lgamma((df + 1) / 2) - lgamma(df / 2)) / Math.sqrt(df * Math.PI) *
      Math.pow(1 + x * x / df, -(df + 1) / 2);
  }
  function tCdf(x, df) {
    if (x === 0) return 0.5;
    var p = 0.5 * incBeta(df / 2, 0.5, df / (df + x * x));
    return x > 0 ? 1 - p : p;
  }
  function tQuantile(p, df) {
    if (p === 0.5) return 0;
    if (p <= 0 || p >= 1) return p <= 0 ? -Infinity : Infinity;
    var sign = p > 0.5 ? 1 : -1;
    var target = p > 0.5 ? 2 * p - 1 : 2 * (1 - p);
    // solve tCdf(t,df) = 0.5 + target/2 for t > 0
    var lo = 0, hi = 1;
    while (tCdf(hi, df) < 0.5 + target / 2 && hi < 1e8) hi *= 2;
    var t = bisectQuantile(function (v) { return tCdf(v, df); }, 0.5 + target / 2, lo, hi, 100);
    return sign * t;
  }

  function chi2Pdf(x, df) {
    if (x <= 0) return 0;
    var k = df / 2;
    return Math.exp((k - 1) * Math.log(x) - x / 2 - k * Math.LN2 - lgamma(k));
  }
  function chi2Cdf(x, df) { if (x <= 0) return 0; return incGamma(df / 2, x / 2); }
  // Wilson–Hilferty bracketing, then bisection for exactness.
  function chi2Quantile(p, df) {
    var g = normQuantile(p);
    var guess = df * Math.pow(1 - 2 / (9 * df) + g * Math.sqrt(2 / (9 * df)), 3);
    var hi = Math.max(guess, df) + 10 * Math.sqrt(2 * df) + 100;
    return bisectQuantile(function (x) { return chi2Cdf(x, df); }, p, 0, hi, 120);
  }

  function fPdf(x, d1, d2) {
    if (x <= 0) return 0;
    return Math.exp(0.5 * (d1 * Math.log(d1) + d2 * Math.log(d2)) + (d1 / 2 - 1) * Math.log(x) -
      ((d1 + d2) / 2) * Math.log(d1 * x + d2) - lbeta(d1 / 2, d2 / 2));
  }
  function fCdf(x, d1, d2) {
    if (x <= 0) return 0;
    return incBeta(d1 / 2, d2 / 2, d1 * x / (d1 * x + d2));
  }
  function fQuantile(p, d1, d2) {
    var hi = 1;
    while (fCdf(hi, d1, d2) < p && hi < 1e10) hi *= 2;
    return bisectQuantile(function (x) { return fCdf(x, d1, d2); }, p, 0, hi, 120);
  }

  function betaPdf(x, a, b) {
    if (x <= 0 || x >= 1) return 0;
    return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - lbeta(a, b));
  }
  function betaCdf(x, a, b) { if (x <= 0) return 0; if (x >= 1) return 1; return incBeta(a, b, x); }
  function betaQuantile(p, a, b) { return bisectQuantile(function (x) { return betaCdf(x, a, b); }, p, 0, 1, 120); }

  function gammaPdf(x, shape, scale) {
    scale = scale == null ? 1 : scale;
    if (x <= 0) return 0;
    return Math.exp((shape - 1) * Math.log(x) - x / scale - lgamma(shape) - shape * Math.log(scale));
  }
  function gammaCdf(x, shape, scale) {
    scale = scale == null ? 1 : scale;
    if (x <= 0) return 0;
    return incGamma(shape, x / scale);
  }
  function gammaQuantile(p, shape, scale) {
    scale = scale == null ? 1 : scale;
    var hi = scale * (shape + 10 * Math.sqrt(shape) + 20);
    return bisectQuantile(function (x) { return gammaCdf(x, shape, scale); }, p, 0, hi, 120);
  }

  function expPdf(x, rate) { return x < 0 ? 0 : rate * Math.exp(-rate * x); }
  function expCdf(x, rate) { return x < 0 ? 0 : 1 - Math.exp(-rate * x); }
  function expQuantile(p, rate) { return -Math.log(1 - p) / rate; }

  function uniformPdf(x, a, b) { return x < a || x > b ? 0 : 1 / (b - a); }
  function uniformCdf(x, a, b) { return x <= a ? 0 : (x >= b ? 1 : (x - a) / (b - a)); }
  function uniformQuantile(p, a, b) { return a + (b - a) * p; }

  function binomPdf(k, n, p) {
    if (k < 0 || k > n) return 0;
    return Math.exp(lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log(1 - p));
  }
  function binomCdf(k, n, p) {
    if (k < 0) return 0; if (k >= n) return 1;
    var s = 0; for (var i = 0; i <= Math.floor(k); i++) s += binomPdf(i, n, p);
    return Math.min(1, s);
  }
  function binomQuantile(q, n, p) {
    var s = 0;
    for (var k = 0; k <= n; k++) { s += binomPdf(k, n, p); if (s >= q - 1e-15) return k; }
    return n;
  }

  function poisPdf(k, lambda) {
    if (k < 0) return 0;
    return Math.exp(k * Math.log(lambda) - lambda - lgamma(k + 1));
  }
  function poisCdf(k, lambda) {
    if (k < 0) return 0;
    var s = 0; for (var i = 0; i <= Math.floor(k); i++) s += poisPdf(i, lambda);
    return Math.min(1, s);
  }
  function poisQuantile(q, lambda) {
    var s = 0;
    for (var k = 0; k < 10000; k++) { s += poisPdf(k, lambda); if (s >= q - 1e-15) return k; }
    return Infinity;
  }

  var dist = {
    normal: {
      pdf: normPdf, cdf: normCdf, quantile: normQuantile, sf: function (x, mu, sigma) { return 1 - normCdf(x, mu, sigma); },
      mean: function (mu, sigma) { return mu || 0; }, var: function (mu, sigma) { return (sigma == null ? 1 : sigma) * (sigma == null ? 1 : sigma); }
    },
    t: {
      pdf: tPdf, cdf: tCdf, quantile: tQuantile, sf: function (x, df) { return 1 - tCdf(x, df); },
      mean: function (df) { return df > 1 ? 0 : NaN; }, var: function (df) { return df > 2 ? df / (df - 2) : (df > 1 ? Infinity : NaN); }
    },
    chi2: {
      pdf: chi2Pdf, cdf: chi2Cdf, quantile: function (p, df) { return bisectQuantile(function (x) { return chi2Cdf(x, df); }, p, 0, Math.max(1, df) * 20 + 200, 120); },
      sf: function (x, df) { return 1 - chi2Cdf(x, df); }, mean: function (df) { return df; }, var: function (df) { return 2 * df; }
    },
    f: {
      pdf: fPdf, cdf: fCdf, quantile: fQuantile, sf: function (x, d1, d2) { return 1 - fCdf(x, d1, d2); },
      mean: function (d2) { return d2 > 2 ? d2 / (d2 - 2) : NaN; },
      var: function (d1, d2) { return d2 > 4 ? 2 * d2 * d2 * (d1 + d2 - 2) / (d1 * (d2 - 2) * (d2 - 2) * (d2 - 4)) : NaN; }
    },
    beta: { pdf: betaPdf, cdf: betaCdf, quantile: betaQuantile, mean: function (a, b) { return a / (a + b); }, var: function (a, b) { return a * b / ((a + b) * (a + b) * (a + b + 1)); } },
    gamma: { pdf: gammaPdf, cdf: gammaCdf, quantile: gammaQuantile, mean: function (s, sc) { return s * (sc == null ? 1 : sc); }, var: function (s, sc) { return s * (sc == null ? 1 : sc) * (sc == null ? 1 : sc); } },
    binomial: { pdf: binomPdf, cdf: binomCdf, quantile: binomQuantile, mean: function (n, p) { return n * p; }, var: function (n, p) { return n * p * (1 - p); } },
    poisson: { pdf: poisPdf, cdf: poisCdf, quantile: poisQuantile, mean: function (l) { return l; }, var: function (l) { return l; } },
    exponential: { pdf: expPdf, cdf: expCdf, quantile: expQuantile, mean: function (r) { return 1 / r; }, var: function (r) { return 1 / (r * r); } },
    uniform: { pdf: uniformPdf, cdf: uniformCdf, quantile: uniformQuantile, mean: function (a, b) { return (a + b) / 2; }, var: function (a, b) { return (b - a) * (b - a) / 12; } }
  };

  // =========================================================================
  // seeded samplers — every one takes `rng` first
  // =========================================================================
  var sample = {
    normal: function (r, mu, sigma) { mu = mu || 0; sigma = sigma == null ? 1 : sigma; return mu + sigma * gauss(r); },
    uniform: function (r, a, b) { a = a == null ? 0 : a; b = b == null ? 1 : b; return a + (b - a) * r(); },
    bernoulli: function (r, p) { return r() < p ? 1 : 0; },
    binomial: function (r, n, p) { var s = 0; for (var i = 0; i < n; i++) if (r() < p) s++; return s; },
    poisson: function (r, lambda) {
      if (lambda < 30) {
        var L = Math.exp(-lambda), k = 0, prod = 1;
        do { k++; prod *= r(); } while (prod > L);
        return k - 1;
      }
      return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gauss(r)));
    },
    exponential: function (r, rate) { return -Math.log(1 - r()) / (rate == null ? 1 : rate); },
    gamma: function (r, shape, scale) {
      scale = scale == null ? 1 : scale;
      if (shape < 1) {
        var u = r();
        return this.gamma(r, shape + 1, scale) * Math.pow(u, 1 / shape);
      }
      var d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
      for (;;) {
        var x, v;
        do { x = gauss(r); v = 1 + c * x; } while (v <= 0);
        v = v * v * v;
        var u2 = r();
        if (u2 < 1 - 0.0331 * x * x * x * x) return scale * d * v;
        if (Math.log(u2) < 0.5 * x * x + d * (1 - v + Math.log(v))) return scale * d * v;
      }
    },
    beta: function (r, a, b) {
      var x = this.gamma(r, a, 1), y = this.gamma(r, b, 1);
      return x / (x + y);
    },
    categorical: function (r, probs) {
      var u = r(), s = 0;
      for (var i = 0; i < probs.length; i++) { s += probs[i]; if (u < s) return i; }
      return probs.length - 1;
    },
    studentT: function (r, df) { return gauss(r) / Math.sqrt(this.gamma(r, df / 2, 2) / df); },
    chi2: function (r, df) { return this.gamma(r, df / 2, 2); },
    mvnormal: function (r, mean, cov) {
      var L = chol(cov);
      var n = mean.length, z = [];
      for (var i = 0; i < n; i++) z.push(gauss(r));
      var out = mean.slice();
      if (L) for (i = 0; i < n; i++) for (var j = 0; j <= i; j++) out[i] += L[i][j] * z[j];
      return out;
    }
  };

  // =========================================================================
  // summary statistics
  // =========================================================================
  function sMean(x) { var s = 0; for (var i = 0; i < x.length; i++) s += x[i]; return x.length ? s / x.length : NaN; }
  function sVariance(x, ddof) {
    ddof = ddof || 0;
    var n = x.length; if (n <= ddof) return NaN;
    var m = sMean(x), s = 0;
    for (var i = 0; i < n; i++) { var d = x[i] - m; s += d * d; }
    return s / (n - ddof);
  }
  function sSd(x, ddof) { return Math.sqrt(sVariance(x, ddof)); }
  // type-7 quantile (R's default), p in [0,1]
  function sQuantile(x, p) {
    if (!x.length) return NaN;
    var a = x.slice().sort(function (u, v) { return u - v; });
    if (p <= 0) return a[0];
    if (p >= 1) return a[a.length - 1];
    var h = (a.length - 1) * p, lo = Math.floor(h), frac = h - lo;
    return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * frac;
  }
  function sMedian(x) { return sQuantile(x, 0.5); }
  function sIqr(x) { return sQuantile(x, 0.75) - sQuantile(x, 0.25); }
  function sSkew(x) {
    var n = x.length, m = sMean(x), s = sSd(x, 0);
    if (!s) return 0;
    var acc = 0; for (var i = 0; i < n; i++) acc += Math.pow((x[i] - m) / s, 3);
    return acc * n / ((n - 1) * (n - 2)) * (n > 2 ? 1 : 0);
  }
  function sKurtosis(x) {
    var n = x.length, m = sMean(x), s2 = sVariance(x, 0);
    if (!s2) return 0;
    var acc = 0; for (var i = 0; i < n; i++) { var d = x[i] - m; acc += d * d * d * d; }
    return acc / (n * s2 * s2) - 3;
  }
  function sCov(x, y, ddof) {
    ddof = ddof || 0;
    var n = Math.min(x.length, y.length), mx = sMean(x), my = sMean(y), s = 0;
    for (var i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my);
    return s / (n - ddof);
  }
  function sCorr(x, y) {
    var sx = sSd(x, 0), sy = sSd(y, 0);
    if (!sx || !sy) return 0;
    return sCov(x, y, 0) / (sx * sy);
  }
  function sEcdf(data) {
    var a = data.slice().sort(function (u, v) { return u - v; });
    return a.map(function (v, i) { return { x: v, p: (i + 1) / a.length }; });
  }
  // opts: {bins (count or array of edges), domain:[lo,hi], density}
  function sHistogram(data, opts) {
    opts = opts || {};
    var lo, hi, edges;
    if (Array.isArray(opts.bins)) { edges = opts.bins.slice(); }
    else {
      var nb = opts.bins || 20;
      lo = opts.domain ? opts.domain[0] : Math.min.apply(null, data);
      hi = opts.domain ? opts.domain[1] : Math.max.apply(null, data);
      if (hi <= lo) hi = lo + 1;
      edges = [];
      for (var k = 0; k <= nb; k++) edges.push(lo + (hi - lo) * k / nb);
    }
    var counts = new Array(edges.length - 1).fill(0);
    for (var i = 0; i < data.length; i++) {
      var v = data[i];
      if (v < edges[0] || v > edges[edges.length - 1]) continue;
      var idx = Math.min(counts.length - 1, Math.floor((v - edges[0]) / (edges[1] - edges[0])));
      if (v === edges[edges.length - 1]) idx = counts.length - 1;
      counts[idx]++;
    }
    var width = edges[1] - edges[0];
    var dens = counts.map(function (c) { return c / (data.length * width); });
    return { edges: edges, counts: counts, density: dens, width: width, mode: opts.density ? dens : counts };
  }
  function sSilverman(data) {
    var n = data.length;
    if (n < 2) return 0.1;
    var s = sSd(data, 1);
    var iqr = sIqr(data);
    var a = Math.min(s, (iqr > 0 ? iqr / 1.349 : s));
    if (!a) a = s;
    return 0.9 * a * Math.pow(n, -0.2) || 0.1;
  }
  function sKde(data, h, opts) {
    opts = opts || {};
    if (h == null) h = sSilverman(data);
    if (!h) h = 0.1;
    var lo = opts.domain ? opts.domain[0] : Math.min.apply(null, data) - 3 * h;
    var hi = opts.domain ? opts.domain[1] : Math.max.apply(null, data) + 3 * h;
    var n = opts.n || 200, out = [];
    for (var i = 0; i < n; i++) {
      var x = lo + (hi - lo) * i / (n - 1), s = 0;
      for (var j = 0; j < data.length; j++) {
        var z = (x - data[j]) / h; s += Math.exp(-0.5 * z * z);
      }
      out.push([x, s / (data.length * h * Math.sqrt(2 * Math.PI))]);
    }
    return { points: out, h: h };
  }

  var summary = {
    mean: sMean, variance: sVariance, sd: sSd, median: sMedian, quantile: sQuantile,
    iqr: sIqr, skew: sSkew, kurtosis: sKurtosis, cov: sCov, corr: sCorr, ecdf: sEcdf,
    histogram: sHistogram, kde: sKde, silverman: sSilverman
  };

  // =========================================================================
  // estimators
  // =========================================================================
  function ols(X, y) {
    var n = X.length, p = X[0].length;
    var Xt = matTranspose(X), XtX = matMul(Xt, X), Xty = matVec(Xt, y);
    var beta = solveLinear(XtX, Xty);
    if (!beta) return null;
    var fit = matVec(X, beta);
    var resid = vsub(y, fit);
    var sse = vdot(resid, resid);
    var ybar = sMean(y), sst = 0;
    for (var i = 0; i < n; i++) { var d = y[i] - ybar; sst += d * d; }
    var df = n - p, sigma2 = df > 0 ? sse / df : NaN;
    var inv = matInverse(XtX);
    var cov = inv ? inv.map(function (row) { return row.map(function (v) { return v * sigma2; }); }) : null;
    var se = cov ? cov.map(function (row, k) { return Math.sqrt(Math.max(0, cov[k][k])); }) : null;
    return { beta: beta, se: se, cov: cov, resid: resid, sigma2: sigma2, sse: sse, r2: sst ? 1 - sse / sst : NaN, df: df, X: X, y: y };
  }

  function ridge(X, y, lambda) {
    var n = X.length, p = X[0].length;
    var Xt = matTranspose(X), XtX = matMul(Xt, X), Xty = matVec(Xt, y);
    for (var i = 0; i < p; i++) XtX[i][i] += lambda;
    var beta = solveLinear(XtX, Xty);
    return beta ? { beta: beta } : null;
  }

  // Coordinate descent lasso. Standardises columns internally for stability,
  // then returns coefficients on the original scale. opts: {iters, tol}.
  function lasso(X, y, lambda, opts) {
    opts = opts || {};
    var n = X.length, p = X[0].length, iters = opts.iters || 500, tol = opts.tol || 1e-7;
    var beta = new Array(p).fill(0), xj = new Array(p), norm2 = new Array(p);
    for (var j = 0; j < p; j++) {
      var col = X.map(function (r) { return r[j]; });
      xj[j] = col; norm2[j] = vdot(col, col) || 1;
    }
    var resid = y.slice();
    for (var it = 0; it < iters; it++) {
      var maxDelta = 0;
      for (j = 0; j < p; j++) {
        var rho = 0;
        for (var i = 0; i < n; i++) rho += xj[j][i] * (resid[i] + xj[j][i] * beta[j]);
        var newB = (Math.abs(rho) <= lambda / 2) ? 0 : (rho - Math.sign(rho) * lambda / 2) / norm2[j];
        var delta = newB - beta[j];
        if (delta !== 0) {
          for (i = 0; i < n; i++) resid[i] -= xj[j][i] * delta;
          beta[j] = newB;
          maxDelta = Math.max(maxDelta, Math.abs(delta));
        }
      }
      if (maxDelta < tol) break;
    }
    return { beta: beta };
  }

  // Generic 1-D maximum-likelihood / maximum of a scalar function on [lo,hi].
  // Ternary search on a unimodal objective, returning {x, value}.
  function mle1d(f, lo, hi, opts) {
    opts = opts || {};
    var iters = opts.iters || 200, tol = opts.tol || 1e-10;
    for (var i = 0; i < iters && hi - lo > tol; i++) {
      var m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
      if (f(m1) < f(m2)) lo = m1; else hi = m2;
    }
    var x = 0.5 * (lo + hi);
    return { x: x, value: f(x) };
  }

  // Observed Fisher information = -Hessian of the log-likelihood at theta,
  // by central differences. theta may be a number or an array.
  function fisherObserved(loglik, theta, h) {
    if (typeof theta === 'number') {
      h = h == null ? 1e-5 * Math.max(1, Math.abs(theta)) : h;
      return -(loglik(theta + h) - 2 * loglik(theta) + loglik(theta - h)) / (h * h);
    }
    var k = theta.length, H = matZeros(k, k), steps = new Array(k);
    for (var i = 0; i < k; i++) steps[i] = h == null ? 1e-5 * Math.max(1, Math.abs(theta[i])) : h;
    for (i = 0; i < k; i++) {
      var hi = steps[i], xp = theta.slice(), xm = theta.slice();
      xp[i] += hi; xm[i] -= hi;
      H[i][i] = (loglik(xp) - 2 * loglik(theta) + loglik(xm)) / (hi * hi);
      for (var j = i + 1; j < k; j++) {
        var hj = steps[j];
        var a = theta.slice(), b = theta.slice(), c = theta.slice(), d = theta.slice();
        a[i] += hi; a[j] += hj; b[i] += hi; b[j] -= hj; c[i] -= hi; c[j] += hj; d[i] -= hi; d[j] -= hj;
        var v = (loglik(a) - loglik(b) - loglik(c) + loglik(d)) / (4 * hi * hj);
        H[i][j] = -v; H[j][i] = -v;
      }
      H[i][i] = -H[i][i];
    }
    return H;
  }

  var est = { ols: ols, ridge: ridge, lasso: lasso, mle1d: mle1d, fisherObserved: fisherObserved };

  // =========================================================================
  // resampling
  // =========================================================================
  function bootstrap(data, stat, B, r) {
    B = B || 1000;
    var out = new Array(B), n = data.length;
    for (var b = 0; b < B; b++) {
      var res = new Array(n);
      for (var i = 0; i < n; i++) res[i] = data[Math.floor(r() * n)];
      out[b] = stat(res);
    }
    return out;
  }
  function percentileCI(samples, alpha) {
    alpha = alpha == null ? 0.05 : alpha;
    var a = samples.slice().sort(function (u, v) { return u - v; });
    function q(p) { return sQuantile(a, p); }
    return { lo: q(alpha / 2), hi: q(1 - alpha / 2), mean: sMean(a) };
  }
  function jackknife(data, stat) {
    var n = data.length, vals = new Array(n);
    for (var i = 0; i < n; i++) vals[i] = stat(data.slice(0, i).concat(data.slice(i + 1)));
    var m = sMean(vals);
    var se = Math.sqrt((n - 1) / n * vals.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0));
    return { values: vals, mean: m, bias: (n - 1) * (m - stat(data)), se: se };
  }
  // BCa interval. rng is used for the B bootstrap replicates.
  function bca(data, stat, B, r, alpha) {
    alpha = alpha == null ? 0.05 : alpha;
    B = B || 1000;
    var theta = stat(data);
    var boots = bootstrap(data, stat, B, r);
    var sorted = boots.slice().sort(function (u, v) { return u - v; });
    var less = 0;
    for (var i = 0; i < B; i++) if (boots[i] < theta) less++;
    var z0 = normQuantile(Math.min(Math.max(less / B, 1e-6), 1 - 1e-6));
    var jack = jackknife(data, stat).values, jm = sMean(jack);
    var num = 0, den = 0;
    for (i = 0; i < jack.length; i++) { var d = jm - jack[i]; num += d * d * d; den += d * d; }
    var a = den ? num / (6 * Math.pow(den, 1.5)) : 0;
    function adj(p) {
      var z = normQuantile(p);
      var zadj = z0 + (z0 + z) / (1 - a * (z0 + z));
      return normCdf(zadj);
    }
    return { lo: sQuantile(sorted, adj(alpha / 2)), hi: sQuantile(sorted, adj(1 - alpha / 2)), z0: z0, acceleration: a, theta: theta };
  }
  // Two-sample permutation test. stat(a,b) — defaults to difference in means.
  function permutationTest(a, b, stat, B, r) {
    B = B || 2000;
    stat = stat || function (x, y) { return sMean(x) - sMean(y); };
    var obs = stat(a, b), pool = a.concat(b), na = a.length, nullDist = new Array(B);
    for (var i = 0; i < B; i++) {
      for (var j = pool.length - 1; j > 0; j--) { var k = Math.floor(r() * (j + 1)); var t = pool[j]; pool[j] = pool[k]; pool[k] = t; }
      nullDist[i] = stat(pool.slice(0, na), pool.slice(na));
    }
    var count = 0;
    for (i = 0; i < B; i++) if (Math.abs(nullDist[i]) >= Math.abs(obs)) count++;
    return { stat: obs, p: (count + 1) / (B + 1), null: nullDist };
  }

  var resample = { bootstrap: bootstrap, percentileCI: percentileCI, bca: bca, jackknife: jackknife, permutationTest: permutationTest };

  // =========================================================================
  // classical tests — each returns {stat, df, p, ci}
  // =========================================================================
  function pFromT(stat, df) { return 2 * (1 - tCdf(Math.abs(stat), df)); }
  function tTest(a, b, opts) {
    opts = opts || {};
    if (typeof b === 'number') { // one-sample
      var n = a.length, m = sMean(a), sd = sSd(a, 1);
      var stat = (m - b) / (sd / Math.sqrt(n));
      var df = n - 1, tc = tQuantile(1 - 0.05 / 2, df);
      return { stat: stat, df: df, p: pFromT(stat, df), ci: [m - tc * sd / Math.sqrt(n), m + tc * sd / Math.sqrt(n)], mean: m, se: sd / Math.sqrt(n) };
    }
    var n1 = a.length, n2 = b.length;
    if (opts.welch || opts.unequal) return welch(a, b, opts);
    var m1 = sMean(a), m2 = sMean(b), sp2 = ((n1 - 1) * sVariance(a, 1) + (n2 - 1) * sVariance(b, 1)) / (n1 + n2 - 2);
    var se = Math.sqrt(sp2 * (1 / n1 + 1 / n2));
    var stat2 = (m1 - m2) / se, df2 = n1 + n2 - 2;
    var tc2 = tQuantile(1 - (opts.alpha || 0.05) / 2, df2);
    return { stat: stat2, df: df2, p: pFromT(stat2, df2), ci: [m1 - m2 - tc2 * se, m1 - m2 + tc2 * se], diff: m1 - m2, se: se };
  }
  function welch(a, b, opts) {
    opts = opts || {};
    var n1 = a.length, n2 = b.length, v1 = sVariance(a, 1), v2 = sVariance(b, 1);
    var se = Math.sqrt(v1 / n1 + v2 / n2);
    var stat = (sMean(a) - sMean(b)) / se;
    var df = Math.pow(v1 / n1 + v2 / n2, 2) / (Math.pow(v1 / n1, 2) / (n1 - 1) + Math.pow(v2 / n2, 2) / (n2 - 1));
    var tc = tQuantile(1 - (opts.alpha || 0.05) / 2, df);
    return { stat: stat, df: df, p: pFromT(stat, df), ci: [sMean(a) - sMean(b) - tc * se, sMean(a) - sMean(b) + tc * se] };
  }
  function zTest(x, sigma, mu0, alpha) {
    alpha = alpha || 0.05;
    var n = x.length, m = sMean(x), se = sigma / Math.sqrt(n);
    var stat = (m - mu0) / se, p = 2 * (1 - normCdf(Math.abs(stat)));
    var zc = normQuantile(1 - alpha / 2);
    return { stat: stat, df: Infinity, p: p, ci: [m - zc * se, m + zc * se] };
  }
  // obs/exp: arrays of counts. If exp omitted and obs is a 2-D contingency
  // table, performs the independence test.
  function chi2Test(obs, exp) {
    var stat = 0, df = 0;
    if (exp) {
      for (var i = 0; i < obs.length; i++) {
        if (exp[i] > 0) stat += (obs[i] - exp[i]) * (obs[i] - exp[i]) / exp[i];
      }
      df = obs.length - 1;
    } else {
      var R = obs.length, C = obs[0].length, rowT = [], colT = [], total = 0;
      for (i = 0; i < R; i++) { rowT[i] = 0; for (var j = 0; j < C; j++) { rowT[i] += obs[i][j]; total += obs[i][j]; } }
      for (j = 0; j < C; j++) { colT[j] = 0; for (i = 0; i < R; i++) colT[j] += obs[i][j]; }
      for (i = 0; i < R; i++) for (j = 0; j < C; j++) {
        var E = rowT[i] * colT[j] / total;
        if (E > 0) stat += (obs[i][j] - E) * (obs[i][j] - E) / E;
      }
      df = (R - 1) * (C - 1);
    }
    return { stat: stat, df: df, p: 1 - chi2Cdf(stat, df) };
  }
  function fTest(a, b) {
    var v1 = sVariance(a, 1), v2 = sVariance(b, 1);
    var stat = v1 / v2, d1 = a.length - 1, d2 = b.length - 1;
    var p = 2 * Math.min(fCdf(stat, d1, d2), 1 - fCdf(stat, d1, d2));
    return { stat: stat, df: [d1, d2], p: Math.min(1, p) };
  }
  // Likelihood-ratio test: 2*(loglikAlt - loglikNull) ~ chi2(df).
  function lrt(loglikNull, loglikAlt, df) {
    var stat = 2 * (loglikAlt - loglikNull);
    return { stat: stat, df: df, p: 1 - chi2Cdf(stat, df) };
  }
  function bonferroni(pvals, alpha) {
    alpha = alpha == null ? 0.05 : alpha;
    var m = pvals.length, adj = pvals.map(function (p) { return Math.min(1, p * m); });
    return { reject: adj.map(function (a) { return a <= alpha; }), adjusted: adj, method: 'bonferroni' };
  }
  function benjaminiHochberg(pvals, alpha) {
    alpha = alpha == null ? 0.05 : alpha;
    var m = pvals.length;
    var order = pvals.map(function (p, i) { return { p: p, i: i }; }).sort(function (u, v) { return u.p - v.p; });
    var adj = new Array(m), reject = new Array(m).fill(false), maxRej = -1;
    for (var k = 0; k < m; k++) if (order[k].p <= (k + 1) / m * alpha) maxRej = k;
    for (k = 0; k < m; k++) {
      if (k <= maxRej) reject[order[k].i] = true;
      adj[order[k].i] = Math.min(1, order[k].p * m / (k + 1));
    }
    // enforce monotonicity of adjusted p-values
    var running = 1;
    for (k = m - 1; k >= 0; k--) { running = Math.min(running, order[k].p * m / (k + 1)); adj[order[k].i] = running; }
    return { reject: reject, adjusted: adj, method: 'benjamini-hochberg' };
  }

  var test = { tTest: tTest, welch: welch, zTest: zTest, chi2Test: chi2Test, fTest: fTest, lrt: lrt, bonferroni: bonferroni, benjaminiHochberg: benjaminiHochberg, pFromT: pFromT };

  // =========================================================================
  // Bayesian helpers
  // =========================================================================
  // Beta-Binomial conjugate update. Prior Beta(a,b) + s successes in n trials.
  function betaBinomial(a, b, successes, trialsOrFailures) {
    var failures = trialsOrFailures == null ? 0 : (typeof trialsOrFailures === 'number' && trialsOrFailures >= successes ? trialsOrFailures - successes : trialsOrFailures);
    var A = a + successes, B = b + failures;
    return {
      a: A, b: B, mean: A / (A + B), mode: (A > 1 && B > 1) ? (A - 1) / (A + B - 2) : (A / (A + B)),
      var: A * B / ((A + B) * (A + B) * (A + B + 1)),
      sd: Math.sqrt(A * B / ((A + B) * (A + B) * (A + B + 1))),
      alpha: A, beta: B
    };
  }
  // Gaussian-Gaussian fusion: prior mean mu0 with variance v0, observation xbar
  // with variance v (of the mean). Returns the posterior {mu, var, sigma, prior, obs}.
  function normalNormal(mu0, v0, xbar, v) {
    var prec = 1 / v0 + 1 / v, mu = (mu0 / v0 + xbar / v) / prec, out = 1 / prec;
    return { mu: mu, var: out, sigma: Math.sqrt(out), prior: { mu: mu0, var: v0 }, obs: { mu: xbar, var: v } };
  }
  // Random-walk Metropolis–Hastings. logpost(x) may return -Infinity outside the
  // support. Returns {chain, accepted, accept, propSd}.
  function metropolis(logpost, x0, steps, propSd, r) {
    var dim = Array.isArray(x0) ? x0.length : 1;
    var chain = [], accepted = 0;
    var x = Array.isArray(x0) ? x0.slice() : [x0];
    var lp = logpost(Array.isArray(x0) ? x : x[0]);
    for (var i = 0; i < steps; i++) {
      var prop = x.slice();
      for (var d = 0; d < dim; d++) prop[d] += propSd * gauss(r);
      var lpp = logpost(Array.isArray(x0) ? prop : prop[0]);
      var acc = Math.log(r()) < (lpp - lp);
      if (acc) { x = prop; lp = lpp; accepted++; }
      chain.push(Array.isArray(x0) ? x.slice() : x[0]);
    }
    return { chain: chain, accepted: accepted, accept: accepted / steps, propSd: propSd };
  }
  // Two-block Gibbs sampler. logcond(x, y) and logcondY(y, x) return the log
  // conditional densities. Returns {chain:[[x,y],...], accept:1}.
  function gibbs2(logcondX, logcondY, x0, y0, steps, r) {
    var x = x0, y = y0, chain = [];
    function sliceSample(logf, cur, width, rr) {
      // simple grid-free slice sampler
      var lp = logf(cur), u = Math.log(rr()) + lp;
      var lo = cur - width * rr(), hi = cur + width * rr();
      while (logf(lo) > u) lo -= width;
      while (logf(hi) > u) hi += width;
      for (var i = 0; i < 100; i++) {
        var mid = lo + rr() * (hi - lo);
        if (logf(mid) > u) return mid;
        if (mid < cur) lo = mid; else hi = mid;
      }
      return cur;
    }
    for (var s = 0; s < steps; s++) {
      x = sliceSample(function (v) { return logcondX(v, y); }, x, 1, r);
      y = sliceSample(function (v) { return logcondY(v, x); }, y, 1, r);
      chain.push([x, y]);
    }
    return { chain: chain, accept: 1 };
  }
  // Laplace approximation at the mode: posterior ~ Normal(mode, H^-1), where H
  // is the negative Hessian of the log-posterior at the mode.
  function laplace(logpost, mode, h) {
    var H = fisherObserved(logpost, mode, h);
    var num = typeof mode === 'number' ? 1 / H : null;
    var cov = typeof mode === 'number' ? [[num]] : matInverse(H);
    return { mean: mode, cov: cov, precision: H, sigma: typeof mode === 'number' ? Math.sqrt(num) : cov.map(function (r2, i) { return Math.sqrt(Math.max(0, cov[i][i])); }) };
  }
  // Gelman–Rubin R-hat over an array of chains (arrays of scalars).
  function rhat(chains) {
    var m = chains.length, n = chains[0].length;
    var means = chains.map(sMean), grand = sMean(means);
    var B = n * means.reduce(function (s, mm) { return s + (mm - grand) * (mm - grand); }, 0) / (m - 1);
    var W = sMean(chains.map(function (c) { return sVariance(c, 1); }));
    var varPlus = (n - 1) / n * W + B / n;
    return Math.sqrt(varPlus / W);
  }

  var bayes = { betaBinomial: betaBinomial, normalNormal: normalNormal, metropolis: metropolis, gibbs2: gibbs2, laplace: laplace, rhat: rhat };

  // =========================================================================
  // recursive state estimation
  // =========================================================================
  // 1-D histogram Bayes filter. opts: {n, domain:[lo,hi], initial(fn|array)}.
  // Returns {xs, p, predict(motion, blur), update(likelihoodFn), normalize(),
  // mean(), map(), entropy()}.
  function histogram1d(opts) {
    opts = opts || {};
    var n = opts.n || 61;
    var lo = opts.domain ? opts.domain[0] : 0, hi = opts.domain ? opts.domain[1] : 1;
    var xs = [], p = [];
    for (var i = 0; i < n; i++) xs.push(lo + (hi - lo) * i / (n - 1));
    if (typeof opts.initial === 'function') p = xs.map(opts.initial);
    else if (Array.isArray(opts.initial)) p = opts.initial.slice();
    else p = new Array(n).fill(1 / n);
    function normalize() {
      var s = 0; for (var k = 0; k < n; k++) s += p[k];
      if (s <= 0) { for (k = 0; k < n; k++) p[k] = 1 / n; return; }
      for (k = 0; k < n; k++) p[k] /= s;
    }
    normalize();
    var obj = {
      n: n, xs: xs, p: p,
      normalize: normalize,
      // motion: displacement in world units; blur: Gaussian sd in world units.
      predict: function (motion, blur) {
        var dx = xs[1] - xs[0];
        var out = new Array(n).fill(0);
        var sigma = Math.max(1e-9, (blur || 0) / dx);
        for (var src = 0; src < n; src++) {
          var target = src + (motion || 0) / dx;
          if (sigma < 1e-6) {
            var ti = Math.round(target);
            if (ti >= 0 && ti < n) out[ti] += p[src];
          } else {
            for (var j = 0; j < n; j++) {
              var w = Math.exp(-0.5 * Math.pow((j - target) / sigma, 2));
              out[j] += p[src] * w;
            }
          }
        }
        p = out; normalize(); return obj;
      },
      // likelihoodFn(x) returns a non-negative measurement likelihood.
      update: function (likelihoodFn) {
        for (var k = 0; k < n; k++) p[k] *= Math.max(0, likelihoodFn(xs[k]));
        normalize(); return obj;
      },
      mean: function () { var s = 0; for (var k = 0; k < n; k++) s += xs[k] * p[k]; return s; },
      map: function () { var bi = 0; for (var k = 1; k < n; k++) if (p[k] > p[bi]) bi = k; return xs[bi]; },
      variance: function () { var m = obj.mean(), s = 0; for (var k = 0; k < n; k++) s += p[k] * (xs[k] - m) * (xs[k] - m); return s; },
      entropy: function () { var s = 0; for (var k = 0; k < n; k++) if (p[k] > 0) s -= p[k] * Math.log(p[k]); return s; },
      set: function (arr) { p = arr.slice(); normalize(); return obj; }
    };
    return obj;
  }

  var kalman = {
    // x' = A x + noise(Q);  Sigma' = A Sigma A^T + Q
    predict: function (mu, Sigma, A, Q) {
      var Am = matVec(A, mu), S = matMul(matMul(A, Sigma), matTranspose(A));
      for (var i = 0; i < S.length; i++) for (var j = 0; j < S[i].length; j++) S[i][j] += (Q ? Q[i][j] : 0);
      return { mu: Am, Sigma: S };
    },
    // z = H x + noise(R); returns {mu, Sigma, K, innovation, S}
    update: function (mu, Sigma, z, H, R) {
      var Hm = matVec(H, mu), innov = vsub(z, Hm);
      var S = matMul(matMul(H, Sigma), matTranspose(H));
      for (var i = 0; i < S.length; i++) for (var j = 0; j < S[i].length; j++) S[i][j] += (R ? R[i][j] : 0);
      var Si = matInverse(S), K = matMul(matMul(Sigma, matTranspose(H)), Si);
      var newMu = vadd(mu, matVec(K, innov));
      var KH = matMul(K, H);
      var I = matIdentity(mu.length), newSigma = matMul(vsubMat(I, KH), Sigma);
      return { mu: newMu, Sigma: newSigma, K: K, innovation: innov, S: S };
    }
  };
  function vsubMat(A, B) { return A.map(function (r, i) { return r.map(function (v, j) { return v - B[i][j]; }); }); }

  // Extended Kalman filter: f and h are nonlinear; F and H are their Jacobians
  // evaluated by central differences. Single predict/update wrappers.
  var ekf = {
    predict: function (mu, Sigma, f, Q) {
      var fm = f(mu), F = jacobian(f, mu), S = matMul(matMul(F, Sigma), matTranspose(F));
      for (var i = 0; i < S.length; i++) for (var j = 0; j < S[i].length; j++) S[i][j] += (Q ? Q[i][j] : 0);
      return { mu: fm, Sigma: S, F: F };
    },
    update: function (mu, Sigma, z, h, R) {
      var hm = h(mu), H = jacobian(h, mu), innov = vsub(z, hm);
      var S = matMul(matMul(H, Sigma), matTranspose(H));
      for (var i = 0; i < S.length; i++) for (var j = 0; j < S[i].length; j++) S[i][j] += (R ? R[i][j] : 0);
      var K = matMul(matMul(Sigma, matTranspose(H)), matInverse(S));
      var newMu = vadd(mu, matVec(K, innov));
      var newSigma = matMul(vsubMat(matIdentity(mu.length), matMul(K, H)), Sigma);
      return { mu: newMu, Sigma: newSigma, K: K, innovation: innov, S: S };
    }
  };
  function jacobian(f, x, h) {
    var n = x.length, f0 = f(x), m = f0.length, J = matZeros(m, n);
    for (var j = 0; j < n; j++) {
      var hj = h || 1e-6 * Math.max(1, Math.abs(x[j]));
      var xp = x.slice(), xm = x.slice(); xp[j] += hj; xm[j] -= hj;
      var fp = f(xp), fm = f(xm);
      for (var i = 0; i < m; i++) J[i][j] = (fp[i] - fm[i]) / (2 * hj);
    }
    return J;
  }

  // Particle filter. opts: {n, initial(rng) -> state, propagate(state, rng),
  // likelihood(state) -> weight}. Returns {particles, weights, propagate(),
  // update(), resample(rng), ess()}.
  function particle(opts) {
    opts = opts || {};
    var N = opts.n || 200;
    var r = opts.rng || rng(1);
    var particles = [], weights = new Array(N).fill(1 / N);
    for (var i = 0; i < N; i++) particles.push(opts.initial(r));
    function normalizeW() {
      var s = 0; for (var k = 0; k < N; k++) s += weights[k];
      if (s <= 0) { for (k = 0; k < N; k++) weights[k] = 1 / N; return; }
      for (k = 0; k < N; k++) weights[k] /= s;
    }
    var obj = {
      particles: particles, weights: weights, n: N,
      propagate: function () {
        for (var k = 0; k < N; k++) particles[k] = opts.propagate(particles[k], r, k);
        return obj;
      },
      update: function () {
        for (var k = 0; k < N; k++) weights[k] *= Math.max(0, opts.likelihood(particles[k]));
        normalizeW(); return obj;
      },
      // systematic resampling
      resample: function () {
        var cdf = [], s = 0;
        for (var k = 0; k < N; k++) { s += weights[k]; cdf.push(s); }
        var u0 = r() / N, newP = [], idx = 0;
        for (k = 0; k < N; k++) {
          var target = u0 + k / N;
          while (target > cdf[idx] && idx < N - 1) idx++;
          newP.push(particles[idx]);
        }
        particles = newP;
        for (k = 0; k < N; k++) weights[k] = 1 / N;
        return obj;
      },
      ess: function () { var s = 0; for (var k = 0; k < N; k++) s += weights[k] * weights[k]; return 1 / s; },
      mean: function () {
        if (typeof particles[0] === 'number') { var m = 0; for (var k = 0; k < N; k++) m += weights[k] * particles[k]; return m; }
        var d = particles[0].length, out = new Array(d).fill(0);
        for (k = 0; k < N; k++) for (var j = 0; j < d; j++) out[j] += weights[k] * particles[k][j];
        return out;
      },
      variance: function () {
        if (typeof particles[0] !== 'number') return null;
        var m = obj.mean(), v = 0;
        for (var k = 0; k < N; k++) v += weights[k] * (particles[k] - m) * (particles[k] - m);
        return v;
      },
      pairs: function () { return particles.map(function (p, k) { return { state: p, weight: weights[k] }; }); }
    };
    return obj;
  }

  var filter = { histogram1d: histogram1d, kalman: kalman, ekf: ekf, jacobian: jacobian, particle: particle };

  // =========================================================================
  // prediction metrics
  // =========================================================================
  function confusion(yTrue, yPred, positive) {
    positive = positive == null ? 1 : positive;
    var tp = 0, tn = 0, fp = 0, fn = 0;
    for (var i = 0; i < yTrue.length; i++) {
      var t = yTrue[i] === positive, p = yPred[i] === positive;
      if (t && p) tp++; else if (!t && !p) tn++; else if (!t && p) fp++; else fn++;
    }
    var precision = tp + fp ? tp / (tp + fp) : NaN, recall = tp + fn ? tp / (tp + fn) : NaN;
    return { tp: tp, tn: tn, fp: fp, fn: fn, precision: precision, recall: recall, tpr: recall, fpr: fp + tn ? fp / (fp + tn) : NaN, accuracy: (tp + tn) / yTrue.length };
  }
  // scores: higher = more positive. Returns thresholds descending with paired tpr/fpr.
  function roc(yTrue, scores) {
    var pairs = yTrue.map(function (t, i) { return { y: t, s: scores[i] }; });
    pairs.sort(function (a, b) { return b.s - a.s; });
    var P = 0, N = 0;
    for (var i = 0; i < pairs.length; i++) if (pairs[i].y === 1) P++; else N++;
    var tpr = [0], fpr = [0], thr = [Infinity];
    var tp = 0, fp = 0, prev = null;
    for (i = 0; i < pairs.length; i++) {
      var s = pairs[i].s;
      if (prev != null && s !== prev) {
        tpr.push(tp / P); fpr.push(fp / N); thr.push(prev);
      }
      if (pairs[i].y === 1) tp++; else fp++;
      prev = s;
    }
    tpr.push(tp / P); fpr.push(fp / N); thr.push(prev);
    return { tpr: tpr, fpr: fpr, thresholds: thr };
  }
  function pr(yTrue, scores) {
    var pairs = yTrue.map(function (t, i) { return { y: t, s: scores[i] }; });
    pairs.sort(function (a, b) { return b.s - a.s; });
    var P = yTrue.reduce(function (s, v) { return s + (v === 1 ? 1 : 0); }, 0);
    var tp = 0, fp = 0, recall = [0], precision = [1], thr = [Infinity];
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i].y === 1) tp++; else fp++;
      if (i < pairs.length - 1 && pairs[i].s === pairs[i + 1].s) continue;
      recall.push(tp / P); precision.push(tp + fp ? tp / (tp + fp) : 1); thr.push(pairs[i].s);
    }
    return { recall: recall, precision: precision, thresholds: thr };
  }
  function auc(xs, ys) {
    var a = 0;
    for (var i = 1; i < xs.length; i++) a += 0.5 * (ys[i] + ys[i - 1]) * (xs[i] - xs[i - 1]);
    return Math.abs(a);
  }
  function calibrationBins(probs, yTrue, bins) {
    bins = bins || 10;
    var edges = [], counts = new Array(bins).fill(0), sums = new Array(bins).fill(0), pos = new Array(bins).fill(0);
    for (var k = 0; k <= bins; k++) edges.push(k / bins);
    for (var i = 0; i < probs.length; i++) {
      var b = Math.min(bins - 1, Math.floor(probs[i] * bins));
      if (b < 0) b = 0;
      counts[b]++; sums[b] += probs[i]; pos[b] += (yTrue[i] === 1 ? 1 : 0);
    }
    var out = [];
    for (k = 0; k < bins; k++) if (counts[k]) out.push({ lo: edges[k], hi: edges[k + 1], count: counts[k], confidence: sums[k] / counts[k], accuracy: pos[k] / counts[k] });
    return out;
  }
  function brier(probs, yTrue) {
    var s = 0; for (var i = 0; i < probs.length; i++) { var d = probs[i] - yTrue[i]; s += d * d; }
    return s / probs.length;
  }
  function logLoss(probs, yTrue) {
    var s = 0, eps = 1e-15;
    for (var i = 0; i < probs.length; i++) {
      var p = Math.min(1 - eps, Math.max(eps, probs[i]));
      s += -(yTrue[i] * Math.log(p) + (1 - yTrue[i]) * Math.log(1 - p));
    }
    return s / probs.length;
  }
  function ece(probs, yTrue, bins) {
    var cb = calibrationBins(probs, yTrue, bins), n = probs.length, s = 0;
    for (var i = 0; i < cb.length; i++) s += cb[i].count / n * Math.abs(cb[i].confidence - cb[i].accuracy);
    return s;
  }
  // Split-conformal quantile with the finite-sample (n+1) correction.
  function conformalQuantile(scores, alpha) {
    alpha = alpha == null ? 0.1 : alpha;
    var a = scores.slice().sort(function (u, v) { return u - v; });
    var idx = Math.ceil((a.length + 1) * (1 - alpha)) - 1;
    return a[Math.min(a.length - 1, Math.max(0, idx))];
  }

  var metric = { confusion: confusion, roc: roc, pr: pr, auc: auc, calibrationBins: calibrationBins, brier: brier, logLoss: logLoss, ece: ece, conformalQuantile: conformalQuantile };

  // =========================================================================
  // causal inference
  // =========================================================================
  // Inverse-probability weighting for the average treatment effect.
  function ipw(y, t, ps) {
    var s1 = 0, s0 = 0, w1 = 0, w0 = 0;
    for (var i = 0; i < y.length; i++) {
      if (t[i] === 1) { s1 += y[i] / ps[i]; w1 += 1 / ps[i]; }
      else { s0 += y[i] / (1 - ps[i]); w0 += 1 / (1 - ps[i]); }
    }
    return { ate: s1 / w1 - s0 / w0, mu1: s1 / w1, mu0: s0 / w0 };
  }
  // Nearest-neighbour propensity matching (with replacement). Returns ATT estimate.
  function matchNearest(y, t, ps, caliper) {
    var treated = [], control = [];
    for (var i = 0; i < y.length; i++) (t[i] === 1 ? treated : control).push({ y: y[i], ps: ps[i], i: i });
    var diffs = [], used = 0;
    for (var a = 0; a < treated.length; a++) {
      var best = -1, bd = Infinity;
      for (var b = 0; b < control.length; b++) {
        var d = Math.abs(treated[a].ps - control[b].ps);
        if (d < bd) { bd = d; best = b; }
      }
      if (best >= 0 && (caliper == null || bd <= caliper)) { diffs.push(treated[a].y - control[best].y); used++; }
    }
    return { att: diffs.length ? diffs.reduce(function (s, v) { return s + v; }, 0) / diffs.length : NaN, matched: used, of: treated.length };
  }
  // Difference-in-differences on a 2x2 group x period design.
  function did(y, group, post) {
    var s = {};
    for (var i = 0; i < y.length; i++) {
      var key = group[i] + ',' + post[i];
      if (!s[key]) s[key] = { n: 0, sum: 0 };
      s[key].n++; s[key].sum += y[i];
    }
    function m(k) { return s[k] ? s[k].sum / s[k].n : NaN; }
    var est = (m('1,1') - m('1,0')) - (m('0,1') - m('0,0'));
    return { estimate: est, cells: s };
  }
  // Two-stage least squares with instrument(s) Z, regressor X, outcome y.
  function iv2sls(Z, X, y) {
    var xcol = X.map(function (r) { return r[0]; });
    var Zt = matTranspose(Z);
    var pi = solveLinear(matMul(Zt, Z), matVec(Zt, xcol));
    var Xhat = matMul(Z, pi.map(function (v) { return [v]; }));
    var Xht = matTranspose(Xhat);
    var beta = solveLinear(matMul(Xht, Xhat), matVec(Xht, y));
    return { beta: beta, firstStage: Xhat };
  }

  var causal = { ipw: ipw, matchNearest: matchNearest, did: did, iv2sls: iv2sls };

  // =========================================================================
  // Stats.plot — the series' canvas widget, modelled on LinAlg.plane
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

    // fnOrPoints: a function y=f(x) sampled across xRange, or an array of
    // [x,y] pairs (nulls / non-finite values break the path).
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

    // bins: [{x0, x1, h, color?}] — vertical histogram columns on a baseline
    // (opts.base, default yRange[0]).
    function columns(bins, o) {
      o = o || {};
      var c = colors(), base = o.base != null ? o.base : yRange[0];
      ctx.save();
      withClip(function () {
        bins.forEach(function (bn, i) {
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

    function rug(vals, o) {
      o = o || {};
      var c = colors(), base = o.base != null ? o.base : yRange[0], len = o.len || 0.04 * (yRange[1] - yRange[0]);
      ctx.save();
      ctx.strokeStyle = o.color || c.text; ctx.globalAlpha = o.alpha == null ? 0.5 : o.alpha; ctx.lineWidth = 1;
      withClip(function () {
        vals.forEach(function (v) { ctx.beginPath(); ctx.moveTo(px(v), py(base)); ctx.lineTo(px(v), py(base + len)); ctx.stroke(); });
      });
      ctx.globalAlpha = 1; ctx.restore();
    }

    // ECDF staircase from [{x,p}] points.
    function step(points, o) {
      o = o || {};
      var c = colors();
      ctx.save();
      ctx.strokeStyle = o.color || c.accent; ctx.lineWidth = o.width || 2;
      withClip(function () {
        ctx.beginPath();
        for (var i = 0; i < points.length; i++) {
          var X = px(points[i].x), Y = py(points[i].p);
          if (i === 0) ctx.moveTo(X, Y); else { ctx.lineTo(X, py(points[i - 1].p)); ctx.lineTo(X, Y); }
        }
        ctx.stroke();
      });
      ctx.restore();
    }

    // Shaded band between two functions or two point-arrays.
    function band(lo, hi, o) {
      o = o || {};
      var c = colors();
      var n = o.samples || 160;
      var loFn = typeof lo === 'function' ? lo : null, hiFn = typeof hi === 'function' ? hi : null;
      var a = o.a != null ? o.a : xRange[0], b = o.b != null ? o.b : xRange[1];
      var loPts = loFn ? [] : lo, hiPts = hiFn ? [] : hi;
      if (loFn) for (var i = 0; i <= n; i++) { var x = a + (b - a) * i / n; loPts.push([x, loFn(x)]); }
      if (hiFn) for (i = 0; i <= n; i++) { var x2 = a + (b - a) * i / n; hiPts.push([x2, hiFn(x2)]); }
      ctx.save();
      ctx.fillStyle = o.color || 'rgba(43,95,255,0.16)';
      withClip(function () {
        ctx.beginPath();
        for (i = 0; i < loPts.length; i++) { var X = px(loPts[i][0]), Y = py(loPts[i][1]); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }
        for (var j = hiPts.length - 1; j >= 0; j--) ctx.lineTo(px(hiPts[j][0]), py(hiPts[j][1]));
        ctx.closePath(); ctx.fill();
      });
      ctx.restore();
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

    // Covariance ellipse: image of the k-sigma circle under chol(cov), centred
    // at mean. Deliberately the same construction as LinAlg.plane.ellipse.
    function ellipse(cov, mean, k, o) {
      o = o || {};
      var c = colors();
      k = k == null ? 1 : k;
      var L = chol(cov);
      if (!L) return [];
      var N = o.samples || 120, pts = [];
      mean = mean || [0, 0];
      for (var i = 0; i <= N; i++) {
        var t = 2 * Math.PI * i / N, ux = Math.cos(t) * k, uy = Math.sin(t) * k;
        pts.push([mean[0] + L[0][0] * ux, mean[1] + L[1][0] * ux + L[1][1] * uy]);
      }
      ctx.save();
      ctx.strokeStyle = o.color || c.accent2; ctx.lineWidth = o.width || 2;
      ctx.setLineDash(o.dash || []);
      withClip(function () {
        ctx.beginPath();
        for (i = 0; i < pts.length; i++) { var X = px(pts[i][0]), Y = py(pts[i][1]); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }
        ctx.stroke();
      });
      if (o.fill) { ctx.fillStyle = o.fill; withClip(function () { ctx.beginPath(); for (i = 0; i < pts.length; i++) { var X2 = px(pts[i][0]), Y2 = py(pts[i][1]); if (i === 0) ctx.moveTo(X2, Y2); else ctx.lineTo(X2, Y2); } ctx.closePath(); ctx.fill(); }); }
      ctx.setLineDash([]); ctx.restore();
      return pts;
    }

    // pts: [{x, y, lo, hi, color?}] — vertical error bars with optional caps.
    function errorbars(pts, o) {
      o = o || {};
      var c = colors(), cap = o.cap == null ? 4 : o.cap;
      ctx.save();
      ctx.strokeStyle = o.color || c.text; ctx.lineWidth = o.width || 1.5; ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
      withClip(function () {
        pts.forEach(function (p) {
          var X = px(p.x), Yl = py(p.hi != null ? p.hi : p.y), Yh = py(p.lo != null ? p.lo : p.y);
          ctx.beginPath(); ctx.moveTo(X, Yl); ctx.lineTo(X, Yh); ctx.stroke();
          if (cap) {
            ctx.beginPath(); ctx.moveTo(X - cap, Yl); ctx.lineTo(X + cap, Yl); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(X - cap, Yh); ctx.lineTo(X + cap, Yh); ctx.stroke();
          }
        });
      });
      ctx.globalAlpha = 1; ctx.restore();
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

    // Draggable world-coordinate handles. specs is an array or a function
    // returning one of {id, x, y, r, color, label}. onChange(id, wx, wy).
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
      columns: columns, rug: rug, step: step, band: band, points: points,
      vline: vline, hline: hline, ellipse: ellipse, errorbars: errorbars,
      text: text, legend: legend, handles: handles,
      resize: setup.resize,
      // Direct, unclipped Canvas2D access for the occasional bespoke flourish.
      raw: function (fn) { ctx.save(); fn(ctx); ctx.restore(); }
    };
  }

  // =========================================================================
  // export
  // =========================================================================
  global.Stats = {
    rng: rng, gauss: gauss,
    special: special,
    dist: dist,
    sample: sample,
    summary: summary,
    chol: chol,
    est: est,
    resample: resample,
    test: test,
    bayes: bayes,
    filter: filter,
    metric: metric,
    causal: causal,
    plot: plot,
    // expose the small matrix helpers the filters return values in
    mat: { zeros: matZeros, identity: matIdentity, clone: matClone, transpose: matTranspose, mul: matMul, mulVec: matVec, inverse: matInverse, solve: solveLinear, chol: chol, det: function (A) { return A.length === 2 ? A[0][0] * A[1][1] - A[0][1] * A[1][0] : NaN; } }
  };
})(window);