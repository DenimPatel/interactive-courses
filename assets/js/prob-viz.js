/* prob-viz.js — the probability domain layer for the Probability guide.
 * Distributions, special functions, seeded RNG, a range-flexible plot widget,
 * MVN geometry, Markov chains, information measures, filters and MCMC.
 * ES5, no dependencies beyond window.Guide and window.LinAlg. Exposes window.Prob. */
(function (global) {
  "use strict";

  function G() { return global.Guide; }
  function LA() { return global.LinAlg.mat; }
  function colors() { return G().colors(); }

  var LOG_SQRT_2PI = 0.5 * Math.log(2 * Math.PI);
  var SQRT2PI = Math.sqrt(2 * Math.PI);

  // =========================================================================
  // special functions
  // =========================================================================
  function lgamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1;
    var a = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
      771.32342877765313, -176.61502916214059, 12.507343278686905,
      -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    var t = x + 7.5;
    var s = a[0];
    for (var i = 1; i < 9; i++) s += a[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(s);
  }

  function lbeta(a, b) { return lgamma(a) + lgamma(b) - lgamma(a + b); }

  function logChoose(n, k) {
    if (k < 0 || k > n) return -Infinity;
    return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
  }

  var GAMMA_EPS = 1e-15, GAMMA_MAXIT = 300, GAMMA_FPMIN = 1e-300;

  function gser(a, x) {
    var gln = lgamma(a);
    var ap = a, sum = 1 / a, del = sum;
    for (var n = 1; n < GAMMA_MAXIT; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * GAMMA_EPS) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - gln);
  }

  function gcf(a, x) {
    var gln = lgamma(a);
    var b = x + 1 - a, c = 1 / GAMMA_FPMIN, d = 1 / b, h = d;
    for (var i = 1; i < GAMMA_MAXIT; i++) {
      var an = -i * (i - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < GAMMA_FPMIN) d = GAMMA_FPMIN;
      c = b + an / c;
      if (Math.abs(c) < GAMMA_FPMIN) c = GAMMA_FPMIN;
      d = 1 / d;
      var del = d * c;
      h *= del;
      if (Math.abs(del - 1) < GAMMA_EPS) break;
    }
    return Math.exp(-x + a * Math.log(x) - gln) * h;
  }

  function regIncGamma(a, x) {
    if (a <= 0 || x < 0) return NaN;
    if (x === 0) return 0;
    if (x < a + 1) return gser(a, x);
    return 1 - gcf(a, x);
  }

  var BETA_EPS = 1e-15, BETA_MAXIT = 300, BETA_FPMIN = 1e-300;

  function betacf(a, b, x) {
    var qab = a + b, qap = a + 1, qam = a - 1;
    var c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < BETA_FPMIN) d = BETA_FPMIN;
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= BETA_MAXIT; m++) {
      var m2 = 2 * m;
      var aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < BETA_FPMIN) d = BETA_FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < BETA_FPMIN) c = BETA_FPMIN;
      d = 1 / d;
      h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < BETA_FPMIN) d = BETA_FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < BETA_FPMIN) c = BETA_FPMIN;
      d = 1 / d;
      var del = d * c;
      h *= del;
      if (Math.abs(del - 1) < BETA_EPS) break;
    }
    return h;
  }

  function regIncBeta(a, b, x) {
    if (a <= 0 || b <= 0 || x < 0 || x > 1) return NaN;
    if (x === 0) return 0;
    if (x === 1) return 1;
    var bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }

  function erf(x) {
    if (x === 0) return 0;
    var v = regIncGamma(0.5, x * x);
    return x > 0 ? v : -v;
  }

  function erfinv(y) {
    if (y <= -1) return -Infinity;
    if (y >= 1) return Infinity;
    if (y === 0) return 0;
    var w = -Math.log((1 - y) * (1 + y));
    var a = 0.147;
    var t = 2 / (Math.PI * a) - w / 2;
    var sgn = y < 0 ? -1 : 1;
    var x = sgn * Math.sqrt(Math.sqrt(t * t + w / a) - t);
    var twoOverSqrtPi = 2 / Math.sqrt(Math.PI);
    for (var i = 0; i < 3; i++) {
      var e = erf(x) - y;
      x -= e / (twoOverSqrtPi * Math.exp(-x * x));
    }
    return x;
  }

  // =========================================================================
  // seeding — every draw from ONE stream
  // =========================================================================
  function sNormal(u, mu, sigma) {
    var a = Math.max(u(), 1e-12), b = u();
    return mu + sigma * Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
  }
  function sExp(u, lambda) { return -Math.log(1 - u()) / lambda; }
  function sBernoulli(u, p) { return u() < p ? 1 : 0; }
  function sGeometric(u, p) {
    if (p >= 1) return 1;
    return Math.floor(Math.log(1 - u()) / Math.log(1 - p)) + 1;
  }
  function sPoisson(u, lambda) {
    if (lambda <= 0) return 0;
    if (lambda < 30) {
      var L = Math.exp(-lambda), k = 0, pr = 1;
      do { k++; pr *= u(); } while (pr > L && k < 1000000);
      return k - 1;
    }
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * sNormal(u, 0, 1)));
  }
  function sBinomial(u, n, p) {
    if (p <= 0) return 0;
    if (p >= 1) return n;
    if (n <= 60) {
      var s = 0;
      for (var i = 0; i < n; i++) s += u() < p ? 1 : 0;
      return s;
    }
    var mu = n * p, sig = Math.sqrt(n * p * (1 - p));
    return Math.max(0, Math.min(n, Math.round(mu + sig * sNormal(u, 0, 1))));
  }
  function sGamma(u, k, theta) {
    if (k < 1) {
      var uu = Math.max(u(), 1e-300);
      return sGamma(u, 1 + k, theta) * Math.pow(uu, 1 / k);
    }
    var d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      var x, z;
      do { x = sNormal(u, 0, 1); z = 1 + c * x; } while (z <= 0);
      z = z * z * z;
      var v = u();
      if (v < 1 - 0.0331 * x * x * x * x) return d * z * theta;
      if (Math.log(v) < 0.5 * x * x + d * (1 - z + Math.log(z))) return d * z * theta;
    }
  }
  function sBeta(u, a, b) {
    var x = sGamma(u, a, 1), y = sGamma(u, b, 1);
    if (x + y <= 0) return 0.5;
    return x / (x + y);
  }
  function sCategorical(u, probs) {
    var sum = 0, i;
    for (i = 0; i < probs.length; i++) sum += probs[i];
    var r = u() * sum, c = 0;
    for (i = 0; i < probs.length; i++) {
      c += probs[i];
      if (r < c) return i;
    }
    return probs.length - 1;
  }

  function rngFrom(base) {
    function r() { return base(); }
    r.uniform = function () { return base(); };
    r.normal = function (mu, sigma) { return sNormal(base, mu == null ? 0 : mu, sigma == null ? 1 : sigma); };
    r.exp = function (lambda) { return sExp(base, lambda == null ? 1 : lambda); };
    r.bernoulli = function (p) { return sBernoulli(base, p); };
    r.binomial = function (n, p) { return sBinomial(base, n, p); };
    r.geometric = function (p) { return sGeometric(base, p); };
    r.poisson = function (lambda) { return sPoisson(base, lambda); };
    r.gamma = function (k, theta) { return sGamma(base, k, theta == null ? 1 : theta); };
    r.beta = function (a, b) { return sBeta(base, a, b); };
    r.categorical = function (probs) { return sCategorical(base, probs); };
    r.shuffle = function (arr) {
      var out = arr.slice();
      for (var i = out.length - 1; i > 0; i--) {
        var j = Math.floor(base() * (i + 1));
        var t = out[i]; out[i] = out[j]; out[j] = t;
      }
      return out;
    };
    r.choice = function (arr) { return arr[Math.floor(base() * arr.length)]; };
    return r;
  }

  function makeRng(seed) { return rngFrom(G().seededRandom(seed == null ? 1 : seed)); }

  function ensureRng(rng, seed) {
    if (rng && typeof rng.normal === 'function' && typeof rng.uniform === 'function') return rng;
    if (typeof rng === 'function') return rngFrom(rng);
    return makeRng(seed == null ? 1 : seed);
  }

  function streamOf(rng) {
    if (!rng) return null;
    if (typeof rng === 'function') return rng;
    if (typeof rng.uniform === 'function') return function () { return rng.uniform(); };
    return null;
  }

  var seedCounter = 1000;
  function nextSeed() { seedCounter++; return seedCounter; }

  function makeSampler(fn) {
    var fb = null, seed = nextSeed();
    return function (rng) {
      var u = streamOf(rng);
      if (!u) { if (!fb) fb = makeRng(seed); u = fb; }
      return fn(u);
    };
  }

  function bisectQuantile(cdf, q, lo, hi) {
    if (q <= 0) return lo;
    if (q >= 1) return hi;
    var a = lo, b = hi, guard = 0;
    if (!isFinite(a)) {
      a = -1;
      while (cdf(a) > q && guard++ < 400) a *= 2;
    }
    guard = 0;
    if (!isFinite(b)) {
      b = 1;
      while (cdf(b) < q && guard++ < 400) b *= 2;
    }
    for (var i = 0; i < 200; i++) {
      var m = (a + b) / 2;
      if (cdf(m) < q) a = m; else b = m;
    }
    return (a + b) / 2;
  }

  function discreteSupport(quantile, lo) {
    var hi = quantile(1 - 1e-9);
    if (!isFinite(hi)) hi = lo + 999;
    hi = Math.min(hi, lo + 10000);
    var arr = [];
    for (var k = lo; k <= hi; k++) arr.push(k);
    return arr;
  }

  // =========================================================================
  // distributions
  // =========================================================================
  function discreteDist(cfg) {
    var d = {};
    d.pmf = cfg.pmf;
    d.cdf = cfg.cdf;
    d.quantile = cfg.quantile;
    d.mean = cfg.mean;
    d.variance = cfg.variance;
    d.support = cfg.support;
    d.sample = makeSampler(cfg.sample);
    return d;
  }
  function continuousDist(cfg) {
    var d = {};
    d.pdf = cfg.pdf;
    d.cdf = cfg.cdf;
    d.quantile = cfg.quantile;
    d.mean = cfg.mean;
    d.variance = cfg.variance;
    d.support = cfg.support;
    d.sample = makeSampler(cfg.sample);
    return d;
  }

  function bernoulli(p) {
    return discreteDist({
      pmf: function (k) { return k === 0 ? 1 - p : (k === 1 ? p : 0); },
      cdf: function (k) { return k < 0 ? 0 : (k < 1 ? 1 - p : 1); },
      quantile: function (q) { return q <= 1 - p ? 0 : 1; },
      mean: p, variance: p * (1 - p), support: [0, 1],
      sample: function (u) { return sBernoulli(u, p); }
    });
  }

  function binomial(n, p) {
    function pmf(k) {
      if (k < 0 || k > n || Math.floor(k) !== k) return 0;
      if (p <= 0) return k === 0 ? 1 : 0;
      if (p >= 1) return k === n ? 1 : 0;
      return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
    }
    function cdf(k) {
      var kk = Math.floor(k);
      if (kk < 0) return 0;
      if (kk >= n) return 1;
      var s = 0;
      for (var i = 0; i <= kk; i++) s += pmf(i);
      return Math.min(1, s);
    }
    return discreteDist({
      pmf: pmf, cdf: cdf,
      quantile: function (q) {
        for (var k = 0; k <= n; k++) if (cdf(k) >= q) return k;
        return n;
      },
      mean: n * p, variance: n * p * (1 - p),
      support: (function () { var a = []; for (var k = 0; k <= n; k++) a.push(k); return a; })(),
      sample: function (u) { return sBinomial(u, n, p); }
    });
  }

  function geometric(p) {
    function pmf(k) { return k >= 1 ? Math.pow(1 - p, k - 1) * p : 0; }
    function cdf(k) { return k < 1 ? 0 : 1 - Math.pow(1 - p, Math.floor(k)); }
    function quantile(q) {
      if (q <= 0) return 1;
      var k = 1;
      while (cdf(k) < q && k < 100000) k++;
      return k;
    }
    return discreteDist({
      pmf: pmf, cdf: cdf, quantile: quantile,
      mean: 1 / p, variance: (1 - p) / (p * p),
      support: discreteSupport(quantile, 1),
      sample: function (u) { return sGeometric(u, p); }
    });
  }

  function negBinomial(r, p) {
    function pmf(k) {
      if (k < 0 || Math.floor(k) !== k) return 0;
      return Math.exp(logChoose(k + r - 1, k) + r * Math.log(p) + k * Math.log(1 - p));
    }
    function cdf(k) {
      var kk = Math.floor(k);
      if (kk < 0) return 0;
      var s = 0;
      for (var i = 0; i <= kk; i++) s += pmf(i);
      return Math.min(1, s);
    }
    function quantile(q) {
      var k = 0;
      while (cdf(k) < q && k < 100000) k++;
      return k;
    }
    return discreteDist({
      pmf: pmf, cdf: cdf, quantile: quantile,
      mean: r * (1 - p) / p, variance: r * (1 - p) / (p * p),
      support: discreteSupport(quantile, 0),
      sample: function (u) {
        var total = 0;
        for (var i = 0; i < r; i++) total += sGeometric(u, p);
        return total - r;
      }
    });
  }

  function poisson(lambda) {
    function pmf(k) {
      if (k < 0 || Math.floor(k) !== k) return 0;
      if (lambda === 0) return k === 0 ? 1 : 0;
      return Math.exp(-lambda + k * Math.log(lambda) - lgamma(k + 1));
    }
    function cdf(k) {
      var kk = Math.floor(k);
      if (kk < 0) return 0;
      var s = 0;
      for (var i = 0; i <= kk; i++) s += pmf(i);
      return Math.min(1, s);
    }
    function quantile(q) {
      var k = 0, s = pmf(0);
      while (s < q && k < 100000) { k++; s += pmf(k); }
      return k;
    }
    return discreteDist({
      pmf: pmf, cdf: cdf, quantile: quantile,
      mean: lambda, variance: lambda,
      support: discreteSupport(quantile, 0),
      sample: function (u) { return sPoisson(u, lambda); }
    });
  }

  function uniform(a, b) {
    var w = b - a;
    return continuousDist({
      pdf: function (x) { return (x >= a && x <= b) ? 1 / w : 0; },
      cdf: function (x) { return x <= a ? 0 : (x >= b ? 1 : (x - a) / w); },
      quantile: function (q) { return a + w * q; },
      mean: (a + b) / 2, variance: w * w / 12, support: [a, b],
      sample: function (u) { return a + w * u(); }
    });
  }

  function exponential(lambda) {
    function cdf(x) { return x <= 0 ? 0 : 1 - Math.exp(-lambda * x); }
    return continuousDist({
      pdf: function (x) { return x < 0 ? 0 : lambda * Math.exp(-lambda * x); },
      cdf: cdf,
      quantile: function (q) { return -Math.log(1 - q) / lambda; },
      mean: 1 / lambda, variance: 1 / (lambda * lambda), support: [0, Infinity],
      sample: function (u) { return sExp(u, lambda); }
    });
  }

  function normal(mu, sigma) {
    function cdf(x) { return 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2))); }
    return continuousDist({
      pdf: function (x) {
        var z = (x - mu) / sigma;
        return Math.exp(-0.5 * z * z) / (sigma * SQRT2PI);
      },
      cdf: cdf,
      quantile: function (q) { return mu + sigma * Math.SQRT2 * erfinv(2 * q - 1); },
      mean: mu, variance: sigma * sigma, support: [-Infinity, Infinity],
      sample: function (u) { return sNormal(u, mu, sigma); }
    });
  }

  function gamma(k, theta) {
    function pdf(x) {
      if (x < 0) return 0;
      if (x === 0) return k < 1 ? Infinity : (k === 1 ? 1 / theta : 0);
      return Math.exp((k - 1) * Math.log(x) - x / theta - lgamma(k) - k * Math.log(theta));
    }
    function cdf(x) { return x <= 0 ? 0 : regIncGamma(k, x / theta); }
    return continuousDist({
      pdf: pdf, cdf: cdf,
      quantile: function (q) { return bisectQuantile(cdf, q, 0, Infinity); },
      mean: k * theta, variance: k * theta * theta, support: [0, Infinity],
      sample: function (u) { return sGamma(u, k, theta); }
    });
  }

  function beta(a, b) {
    function pdf(x) {
      if (x < 0 || x > 1) return 0;
      if (x === 0) return a < 1 ? Infinity : (a === 1 ? b : 0);
      if (x === 1) return b < 1 ? Infinity : (b === 1 ? a : 0);
      return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - lbeta(a, b));
    }
    function cdf(x) { return x <= 0 ? 0 : (x >= 1 ? 1 : regIncBeta(a, b, x)); }
    return continuousDist({
      pdf: pdf, cdf: cdf,
      quantile: function (q) { return bisectQuantile(cdf, q, 0, 1); },
      mean: a / (a + b), variance: a * b / ((a + b) * (a + b) * (a + b + 1)),
      support: [0, 1],
      sample: function (u) { return sBeta(u, a, b); }
    });
  }

  function studentT(nu) {
    function pdf(x) {
      return Math.exp(lgamma((nu + 1) / 2) - lgamma(nu / 2) - 0.5 * Math.log(nu * Math.PI)
        - ((nu + 1) / 2) * Math.log(1 + x * x / nu));
    }
    function cdf(x) {
      var v = regIncBeta(nu / 2, 0.5, nu / (nu + x * x));
      return x >= 0 ? 1 - v / 2 : v / 2;
    }
    var mean = nu > 1 ? 0 : NaN;
    var variance = nu > 2 ? nu / (nu - 2) : (nu > 1 ? Infinity : NaN);
    return continuousDist({
      pdf: pdf, cdf: cdf,
      quantile: function (q) { return bisectQuantile(cdf, q, -Infinity, Infinity); },
      mean: mean, variance: variance, support: [-Infinity, Infinity],
      sample: function (u) { return sNormal(u, 0, 1) / Math.sqrt(sGamma(u, nu / 2, 2) / nu); }
    });
  }

  function chiSquared(k) {
    var g = gamma(k / 2, 2);
    return continuousDist({
      pdf: g.pdf, cdf: g.cdf, quantile: g.quantile,
      mean: k, variance: 2 * k, support: [0, Infinity],
      sample: function (u) { return sGamma(u, k / 2, 2); }
    });
  }

  function cauchy(x0, gamma0) {
    function cdf(x) { return 0.5 + Math.atan((x - x0) / gamma0) / Math.PI; }
    return continuousDist({
      pdf: function (x) { var z = (x - x0) / gamma0; return 1 / (Math.PI * gamma0 * (1 + z * z)); },
      cdf: cdf,
      quantile: function (q) { return x0 + gamma0 * Math.tan(Math.PI * (q - 0.5)); },
      mean: NaN, variance: Infinity, support: [-Infinity, Infinity],
      sample: function (u) { return x0 + gamma0 * Math.tan(Math.PI * (u() - 0.5)); }
    });
  }

  function lognormal(mu, sigma) {
    function cdf(x) { return x <= 0 ? 0 : 0.5 * (1 + erf((Math.log(x) - mu) / (sigma * Math.SQRT2))); }
    return continuousDist({
      pdf: function (x) {
        if (x <= 0) return 0;
        var z = (Math.log(x) - mu) / sigma;
        return Math.exp(-0.5 * z * z) / (x * sigma * SQRT2PI);
      },
      cdf: cdf,
      quantile: function (q) { return Math.exp(mu + sigma * Math.SQRT2 * erfinv(2 * q - 1)); },
      mean: Math.exp(mu + sigma * sigma / 2),
      variance: (Math.exp(sigma * sigma) - 1) * Math.exp(2 * mu + sigma * sigma),
      support: [0, Infinity],
      sample: function (u) { return Math.exp(sNormal(u, mu, sigma)); }
    });
  }

  // =========================================================================
  // plot widget
  // =========================================================================
  function plot(canvas, opts) {
    opts = opts || {};
    var W = opts.W || 640, H = opts.H || 360;
    var padL = opts.padL != null ? opts.padL : 44, padR = opts.padR != null ? opts.padR : 16;
    var padT = opts.padT != null ? opts.padT : 12, padB = opts.padB != null ? opts.padB : 28;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var xRange = (opts.xRange || [0, 1]).slice();
    var yRange = (opts.yRange || [0, 1]).slice();
    var setup = G().setupCanvas(canvas, W, H, function () { if (opts.onResize) opts.onResize(); });
    var ctx = setup.ctx;
    var legendEntries = [];

    function px(x) { return padL + plotW * (x - xRange[0]) / (xRange[1] - xRange[0]); }
    function py(y) { return padT + plotH * (1 - (y - yRange[0]) / (yRange[1] - yRange[0])); }
    function wx(X) { return xRange[0] + (xRange[1] - xRange[0]) * (X - padL) / plotW; }
    function wy(Y) { return yRange[0] + (yRange[1] - yRange[0]) * (padT + plotH - Y) / plotH; }

    function clip() {
      ctx.beginPath();
      ctx.rect(padL, padT, plotW, plotH);
      ctx.clip();
    }

    function clear() {
      ctx.clearRect(0, 0, W, H);
      legendEntries = [];
    }

    function setRange(nx, ny) {
      if (nx) { xRange[0] = nx[0]; xRange[1] = nx[1]; }
      if (ny) { yRange[0] = ny[0]; yRange[1] = ny[1]; }
      if (opts.onResize) opts.onResize(); else clear();
    }

    function fmtTick(x) {
      if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
      return Math.abs(x) < 1 ? x.toFixed(2) : x.toFixed(1);
    }

    function axes(a) {
      a = a || {};
      var c = colors();
      var step = a.step || 1;
      ctx.save();
      ctx.strokeStyle = a.color || c.divider; ctx.lineWidth = a.width || 1;
      ctx.fillStyle = c.text;
      ctx.font = (a.fontSize || 10) + 'px ' + c.font;
      var xAxis = (yRange[0] <= 0 && yRange[1] >= 0) ? py(0) : padT + plotH;
      var yAxis = (xRange[0] <= 0 && xRange[1] >= 0) ? px(0) : padL;
      ctx.beginPath(); ctx.moveTo(padL, xAxis); ctx.lineTo(padL + plotW, xAxis); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(yAxis, padT); ctx.lineTo(yAxis, padT + plotH); ctx.stroke();
      var startX = Math.ceil(xRange[0] / step) * step;
      for (var x = startX; x <= xRange[1] + 1e-9; x += step) {
        var X = px(x);
        ctx.beginPath(); ctx.moveTo(X, xAxis - 3); ctx.lineTo(X, xAxis + 3); ctx.stroke();
        if (a.labels !== false) { ctx.textAlign = 'center'; ctx.fillText(fmtTick(x), X, xAxis + 14); }
      }
      var startY = Math.ceil(yRange[0] / step) * step;
      for (var y = startY; y <= yRange[1] + 1e-9; y += step) {
        var Y = py(y);
        ctx.beginPath(); ctx.moveTo(yAxis - 3, Y); ctx.lineTo(yAxis + 3, Y); ctx.stroke();
        if (a.labels !== false) { ctx.textAlign = 'right'; ctx.fillText(fmtTick(y), yAxis - 6, Y + 3); }
      }
      if (a.xLabel) { ctx.textAlign = 'center'; ctx.fillText(a.xLabel, padL + plotW / 2, H - 4); }
      if (a.yLabel) {
        ctx.save(); ctx.translate(11, padT + plotH / 2); ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center'; ctx.fillText(a.yLabel, 0, 0); ctx.restore();
      }
      ctx.restore();
    }

    function grid(gr) {
      gr = gr || {};
      var c = colors();
      var step = gr.step || 1;
      ctx.save();
      ctx.strokeStyle = gr.color || c.divider;
      ctx.lineWidth = gr.width != null ? gr.width : 0.5;
      ctx.globalAlpha = gr.alpha != null ? gr.alpha : 0.6;
      ctx.beginPath();
      var sx = Math.ceil(xRange[0] / step) * step;
      for (var x = sx; x <= xRange[1] + 1e-9; x += step) { ctx.moveTo(px(x), padT); ctx.lineTo(px(x), padT + plotH); }
      var sy = Math.ceil(yRange[0] / step) * step;
      for (var y = sy; y <= yRange[1] + 1e-9; y += step) { ctx.moveTo(padL, py(y)); ctx.lineTo(padL + plotW, py(y)); }
      ctx.stroke();
      ctx.restore();
    }

    function curve(fn, o) {
      o = o || {};
      var c = colors();
      var from = o.from != null ? o.from : xRange[0];
      var to = o.to != null ? o.to : xRange[1];
      var N = o.samples || 240;
      ctx.save();
      clip();
      ctx.strokeStyle = o.color || c.accent;
      ctx.lineWidth = o.width || 2;
      if (o.dash) ctx.setLineDash(o.dash);
      ctx.beginPath();
      var started = false;
      for (var i = 0; i <= N; i++) {
        var x = from + (to - from) * i / N;
        var y = fn(x);
        if (y == null || !isFinite(y)) { started = false; continue; }
        var X = px(x), Y = py(y);
        if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
      }
      ctx.stroke();
      ctx.restore();
      if (o.label) legendEntries.push({ label: o.label, color: o.color || c.accent, dash: o.dash });
    }

    function area(fn, a, b, o) {
      o = o || {};
      var c = colors();
      var base = o.base != null ? o.base : 0;
      var N = o.samples || 240;
      ctx.save();
      clip();
      ctx.beginPath();
      ctx.moveTo(px(a), py(base));
      for (var i = 0; i <= N; i++) {
        var x = a + (b - a) * i / N;
        var y = fn(x);
        if (y == null || !isFinite(y)) y = base;
        ctx.lineTo(px(x), py(y));
      }
      ctx.lineTo(px(b), py(base));
      ctx.closePath();
      ctx.fillStyle = o.color || 'rgba(43,95,255,0.2)';
      ctx.fill();
      ctx.restore();
      if (o.label) legendEntries.push({ label: o.label, color: o.color || 'rgba(43,95,255,0.2)', fill: true });
    }

    function inferWidth(items) {
      var diffs = [], i;
      for (i = 1; i < items.length; i++) {
        var a = items[i].x != null ? items[i].x : (items[i].x0 + items[i].x1) / 2;
        var b = items[i - 1].x != null ? items[i - 1].x : (items[i - 1].x0 + items[i - 1].x1) / 2;
        var d = Math.abs(a - b);
        if (d > 1e-12) diffs.push(d);
      }
      if (!diffs.length) return 0.8;
      diffs.sort(function (p, q) { return p - q; });
      return diffs[Math.floor(diffs.length / 2)] * 0.8;
    }

    function bars(items, o) {
      o = o || {};
      var c = colors();
      var baseline = o.baseline != null ? o.baseline : 0;
      var w = o.width != null ? o.width : inferWidth(items);
      ctx.save();
      clip();
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var x0, x1;
        if (it.x0 != null && it.x1 != null) { x0 = it.x0; x1 = it.x1; }
        else { x0 = it.x - w / 2; x1 = it.x + w / 2; }
        var X0 = px(x0), X1 = px(x1), Y = py(it.y), Yb = py(baseline);
        ctx.fillStyle = it.color || o.color || c.accent;
        ctx.fillRect(Math.min(X0, X1), Math.min(Y, Yb), Math.max(1, Math.abs(X1 - X0)), Math.abs(Yb - Y));
      }
      ctx.restore();
      if (o.label) legendEntries.push({ label: o.label, color: o.color || c.accent, fill: true });
    }

    function steps(fn, o) {
      o = o || {};
      var c = colors();
      var from = o.from != null ? o.from : xRange[0];
      var to = o.to != null ? o.to : xRange[1];
      var N = o.samples || 240;
      ctx.save();
      clip();
      ctx.strokeStyle = o.color || c.accent2;
      ctx.lineWidth = o.width || 2;
      if (o.dash) ctx.setLineDash(o.dash);
      ctx.beginPath();
      var prev = null;
      for (var i = 0; i <= N; i++) {
        var x = from + (to - from) * i / N;
        var y = fn(x);
        if (y == null || !isFinite(y)) continue;
        var X = px(x), Y = py(y);
        if (prev == null) ctx.moveTo(X, Y);
        else { ctx.lineTo(X, prev); ctx.lineTo(X, Y); }
        prev = Y;
      }
      ctx.stroke();
      ctx.restore();
      if (o.label) legendEntries.push({ label: o.label, color: o.color || c.accent2, dash: o.dash });
    }

    function points(pts, o) {
      o = o || {};
      var c = colors();
      ctx.save();
      clip();
      ctx.fillStyle = o.color || c.accent;
      for (var i = 0; i < pts.length; i++) {
        ctx.beginPath();
        ctx.arc(px(pts[i].x), py(pts[i].y), o.r || 3, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.restore();
      if (o.label) legendEntries.push({ label: o.label, color: o.color || c.accent });
    }

    function lineLabel(text, X, Y, color) {
      if (!text) return;
      var c = colors();
      ctx.font = '11px ' + c.font;
      ctx.fillStyle = color || c.text;
      ctx.textAlign = 'left';
      ctx.fillText(text, X + 4, Y - 4);
    }

    function vline(x, o) {
      o = o || {};
      var c = colors();
      var X = px(x);
      ctx.save();
      clip();
      ctx.strokeStyle = o.color || c.accent2;
      ctx.lineWidth = o.width || 1.5;
      if (o.dash) ctx.setLineDash(o.dash);
      ctx.beginPath(); ctx.moveTo(X, padT); ctx.lineTo(X, padT + plotH); ctx.stroke();
      lineLabel(o.labelText != null ? o.labelText : (typeof o.label === 'string' ? o.label : null), X, padT + 12, o.color);
      ctx.restore();
    }

    function hline(y, o) {
      o = o || {};
      var c = colors();
      var Y = py(y);
      ctx.save();
      clip();
      ctx.strokeStyle = o.color || c.accent2;
      ctx.lineWidth = o.width || 1.5;
      if (o.dash) ctx.setLineDash(o.dash);
      ctx.beginPath(); ctx.moveTo(padL, Y); ctx.lineTo(padL + plotW, Y); ctx.stroke();
      lineLabel(o.labelText != null ? o.labelText : (typeof o.label === 'string' ? o.label : null), padL + 4, Y, o.color);
      ctx.restore();
    }

    function band(x0, x1, o) {
      o = o || {};
      var c = colors();
      ctx.save();
      clip();
      ctx.fillStyle = o.color || 'rgba(214,0,108,0.12)';
      var X0 = px(x0), X1 = px(x1);
      ctx.fillRect(Math.min(X0, X1), padT, Math.abs(X1 - X0), plotH);
      ctx.restore();
      if (o.label) legendEntries.push({ label: o.label, color: o.color || 'rgba(214,0,108,0.12)', fill: true });
    }

    function legend(items) {
      var c = colors();
      var list = items || legendEntries;
      if (!list.length) return;
      ctx.save();
      ctx.font = '12px ' + c.font;
      var pad = 8, lineH = 18, sw = 16, textW = 0, i;
      for (i = 0; i < list.length; i++) textW = Math.max(textW, ctx.measureText(list[i].label).width);
      var boxW = textW + sw + 22 + 2 * pad;
      var boxH = list.length * lineH + 2 * pad;
      var x0 = padL + plotW - boxW - 8, y0 = padT + 8;
      ctx.fillStyle = 'rgba(255,255,255,0.86)';
      ctx.strokeStyle = c.divider;
      ctx.lineWidth = 1;
      ctx.fillRect(x0, y0, boxW, boxH);
      ctx.strokeRect(x0, y0, boxW, boxH);
      for (i = 0; i < list.length; i++) {
        var e = list[i];
        var ey = y0 + pad + i * lineH;
        var sy = ey + lineH / 2 - 1;
        if (e.fill) {
          ctx.fillStyle = e.color;
          ctx.fillRect(x0 + pad, sy - 6, sw, 12);
        } else {
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 2.4;
          if (e.dash) ctx.setLineDash(e.dash);
          ctx.beginPath(); ctx.moveTo(x0 + pad, sy); ctx.lineTo(x0 + pad + sw, sy); ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.fillStyle = c.text;
        ctx.textAlign = 'left';
        ctx.fillText(e.label, x0 + pad + sw + 8, ey + lineH / 2 + 4);
      }
      ctx.restore();
    }

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
        destroy: function () { if (dh) dh.destroy(); }
      };
      var dh = G().dragHandles(canvas, function () {
        return resolve().map(function (h) {
          return { id: h.id, x: px(h.x), y: py(h.y), r: (h.r || 9) + (o.grab || 5) };
        });
      }, function (id, X, Y) { onChange(id, wx(X), wy(Y)); }, { cursor: o.cursor || 'grab' });
      return mgr;
    }

    return {
      ctx: ctx, canvas: canvas, W: W, H: H, plotW: plotW, plotH: plotH,
      xRange: xRange, yRange: yRange, px: px, py: py, wx: wx, wy: wy,
      setRange: setRange, clear: clear, axes: axes, grid: grid, curve: curve,
      area: area, bars: bars, steps: steps, points: points, vline: vline,
      hline: hline, band: band, legend: legend, handles: handles, resize: setup.resize
    };
  }

  // =========================================================================
  // histograms
  // =========================================================================
  function hist(samples, opts) {
    opts = opts || {};
    var nb = opts.bins || 20;
    var n = samples.length;
    var lo, hi;
    if (opts.range) { lo = opts.range[0]; hi = opts.range[1]; }
    else {
      lo = Infinity; hi = -Infinity;
      for (var i = 0; i < n; i++) { if (samples[i] < lo) lo = samples[i]; if (samples[i] > hi) hi = samples[i]; }
      if (!isFinite(lo)) { lo = 0; hi = 1; }
    }
    if (hi <= lo) hi = lo + 1;
    var binWidth = (hi - lo) / nb;
    var counts = [];
    for (i = 0; i < nb; i++) counts.push(0);
    for (i = 0; i < n; i++) {
      var x = samples[i];
      if (x < lo || x > hi) continue;
      var idx = Math.floor((x - lo) / binWidth);
      if (idx >= nb) idx = nb - 1;
      if (idx < 0) idx = 0;
      counts[idx]++;
    }
    var density = !!opts.density;
    var bins = [], maxY = 0;
    for (i = 0; i < nb; i++) {
      var x0 = lo + i * binWidth, x1 = x0 + binWidth;
      var center = (x0 + x1) / 2;
      var d = n > 0 ? counts[i] / (n * binWidth) : 0;
      var y = density ? d : counts[i];
      if (y > maxY) maxY = y;
      bins.push({ x0: x0, x1: x1, center: center, count: counts[i], density: d, y: y });
    }
    return { bins: bins, binWidth: binWidth, n: n, max: maxY, total: n, density: density };
  }

  // =========================================================================
  // multivariate normal
  // =========================================================================
  function cholesky(A) {
    var n = A.length, L = LA().zeros(n, n), i, j, k;
    for (i = 0; i < n; i++) {
      for (j = 0; j <= i; j++) {
        var s = A[i][j];
        for (k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) L[i][j] = Math.sqrt(Math.max(0, s));
        else L[i][j] = L[j][j] > 1e-300 ? s / L[j][j] : 0;
      }
    }
    return L;
  }

  function forwardSolve(L, d) {
    var n = L.length, y = new Array(n);
    for (var i = 0; i < n; i++) {
      var s = d[i];
      for (var j = 0; j < i; j++) s -= L[i][j] * y[j];
      y[i] = L[i][i] > 1e-300 ? s / L[i][i] : 0;
    }
    return y;
  }

  function submatrix(A, rows, cols) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var row = [];
      for (var j = 0; j < cols.length; j++) row.push(A[rows[i]][cols[j]]);
      out.push(row);
    }
    return out;
  }

  function mvn(mu, Sigma) {
    var n = mu.length;
    var L = cholesky(Sigma);
    var logDet = 0;
    for (var i = 0; i < n; i++) logDet += Math.log(Math.max(L[i][i], 1e-300));

    function pdf(x) {
      var d = new Array(n);
      for (var i = 0; i < n; i++) d[i] = x[i] - mu[i];
      var y = forwardSolve(L, d);
      var q = 0;
      for (i = 0; i < n; i++) q += y[i] * y[i];
      return Math.exp(-0.5 * (n * Math.log(2 * Math.PI) + 2 * logDet + q));
    }

    function sample(rng) {
      var u = streamOf(rng);
      var fb = null;
      if (!u) { fb = makeRng(nextSeed()); u = fb; }
      var z = new Array(n);
      for (var i = 0; i < n; i++) z[i] = sNormal(u, 0, 1);
      var out = new Array(n);
      for (i = 0; i < n; i++) {
        var s = mu[i];
        for (var j = 0; j <= i; j++) s += L[i][j] * z[j];
        out[i] = s;
      }
      return out;
    }

    function marginal(i) { return { mu: mu[i], sigma2: Sigma[i][i] }; }

    function conditional(idx, vals) {
      var mask = new Array(n);
      for (var i = 0; i < n; i++) mask[i] = idx.indexOf(i) !== -1;
      var rem = [];
      for (i = 0; i < n; i++) if (!mask[i]) rem.push(i);
      var S11 = submatrix(Sigma, rem, rem);
      var S12 = submatrix(Sigma, rem, idx);
      var S22 = submatrix(Sigma, idx, idx);
      var S21 = LA().transpose(S12);
      var inv = LA().inverse(S22);
      if (!inv) inv = LA().pinv(S22);
      var diff = [];
      for (i = 0; i < idx.length; i++) diff.push(vals[i] - mu[idx[i]]);
      var A1 = LA().mul(S12, inv);
      var shift = LA().mulVec(A1, diff);
      var cMu = [];
      for (i = 0; i < rem.length; i++) cMu.push(mu[rem[i]] + shift[i]);
      var A2 = LA().mul(A1, S21);
      var cSig = [];
      for (i = 0; i < rem.length; i++) {
        var row = [];
        for (var j = 0; j < rem.length; j++) row.push(S11[i][j] - A2[i][j]);
        cSig.push(row);
      }
      return { mu: cMu, Sigma: cSig };
    }

    return { pdf: pdf, sample: sample, chol: L, marginal: marginal, conditional: conditional };
  }

  function confEllipse(Sigma, mu, nSigma) {
    nSigma = nSigma == null ? 1 : nSigma;
    mu = mu || [0, 0];
    var e = LA().eigSym(Sigma);
    var vals = e.values, V = e.vectors;
    var a = nSigma * Math.sqrt(Math.max(vals[0], 0));
    var b = nSigma * Math.sqrt(Math.max(vals[1], 0));
    var pts = [], N = 72;
    for (var i = 0; i < N; i++) {
      var t = 2 * Math.PI * i / N;
      var ca = a * Math.cos(t), sb = b * Math.sin(t);
      pts.push([mu[0] + V[0][0] * ca + V[0][1] * sb, mu[1] + V[1][0] * ca + V[1][1] * sb]);
    }
    pts.push(pts[0].slice());
    return pts;
  }

  // =========================================================================
  // Markov chains
  // =========================================================================
  function chain(P) {
    var n = P.length;
    function step(dist) {
      var out = [];
      for (var j = 0; j < n; j++) {
        var s = 0;
        for (var i = 0; i < n; i++) s += dist[i] * P[i][j];
        out.push(s);
      }
      return out;
    }
    function power(k) {
      var R = LA().identity(n);
      var base = P.map(function (r) { return r.slice(); });
      while (k > 0) {
        if (k & 1) R = LA().mul(R, base);
        base = LA().mul(base, base);
        k >>= 1;
      }
      return R;
    }
    function distributionAfter(dist, k) {
      var d = dist.slice();
      for (var i = 0; i < k; i++) d = step(d);
      return d;
    }
    function stationary(tol) {
      tol = tol == null ? 1e-14 : tol;
      var d = [], i;
      for (i = 0; i < n; i++) d.push(1 / n);
      for (var it = 0; it < 200000; it++) {
        var nd = step(d), diff = 0;
        for (i = 0; i < n; i++) diff = Math.max(diff, Math.abs(nd[i] - d[i]));
        d = nd;
        if (diff < tol) break;
      }
      var s = 0;
      for (i = 0; i < n; i++) s += d[i];
      for (i = 0; i < n; i++) d[i] = s > 0 ? d[i] / s : 1 / n;
      return d;
    }
    function isStationary(dist, tol) {
      tol = tol == null ? 1e-9 : tol;
      var nd = step(dist);
      for (var i = 0; i < n; i++) if (Math.abs(nd[i] - dist[i]) > tol) return false;
      return true;
    }
    return {
      step: step, power: power, distributionAfter: distributionAfter,
      stationary: stationary, isStationary: isStationary
    };
  }

  // =========================================================================
  // information measures
  // =========================================================================
  function entropy(p, opts) {
    opts = opts || {};
    var base = opts.base == null ? Math.E : opts.base;
    var s = 0;
    for (var i = 0; i < p.length; i++) if (p[i] > 0) s -= p[i] * Math.log(p[i]);
    return base === Math.E ? s : s / Math.log(base);
  }

  function crossEntropy(p, q) {
    var s = 0;
    for (var i = 0; i < p.length; i++) {
      if (p[i] <= 0) continue;
      if (q[i] <= 0) return Infinity;
      s -= p[i] * Math.log(q[i]);
    }
    return s;
  }

  function kl(p, q) { return crossEntropy(p, q) - entropy(p); }

  function js(p, q) {
    var m = [], i;
    for (i = 0; i < p.length; i++) m.push(0.5 * (p[i] + q[i]));
    return 0.5 * kl(p, m) + 0.5 * kl(q, m);
  }

  function mutualInfo(joint) {
    var r = joint.length, c = joint[0].length, i, j;
    var px = [], py = [];
    for (i = 0; i < r; i++) px.push(0);
    for (j = 0; j < c; j++) py.push(0);
    for (i = 0; i < r; i++) for (j = 0; j < c; j++) { px[i] += joint[i][j]; py[j] += joint[i][j]; }
    var mi = 0;
    for (i = 0; i < r; i++) for (j = 0; j < c; j++) {
      var pxy = joint[i][j];
      if (pxy <= 0 || px[i] <= 0 || py[j] <= 0) continue;
      mi += pxy * Math.log(pxy / (px[i] * py[j]));
    }
    return mi;
  }

  // =========================================================================
  // state helpers
  // =========================================================================
  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function stateClone(x) { return isArr(x) ? x.slice() : x; }

  // =========================================================================
  // filters
  // =========================================================================
  function histogramFilter(o) {
    var n = o.n, x0 = o.x0, x1 = o.x1;
    var dx = (x1 - x0) / n;
    var centers = [], bel = [], i;
    for (i = 0; i < n; i++) centers.push(x0 + (i + 0.5) * dx);
    for (i = 0; i < n; i++) bel.push(1 / n);

    function normalize() {
      var s = 0;
      for (var k = 0; k < n; k++) s += bel[k];
      for (k = 0; k < n; k++) bel[k] = s > 0 ? bel[k] / s : 1 / n;
      return bel;
    }
    function setPrior(prior) {
      for (var k = 0; k < n; k++) bel[k] = typeof prior === 'function' ? prior(centers[k]) : prior[k];
      normalize();
    }
    function update(fn) {
      for (var k = 0; k < n; k++) bel[k] *= fn(centers[k]);
      normalize();
    }
    function predict(op) {
      op = op || {};
      var sigma = op.sigma || 0, shift = op.shift || 0, wrap = op.wrap;
      var nb = [], k;
      for (k = 0; k < n; k++) nb.push(0);
      for (k = 0; k < n; k++) {
        if (bel[k] === 0) continue;
        if (sigma > 0) {
          var maxk = Math.ceil(3 * sigma / dx);
          for (var d = -maxk; d <= maxk; d++) {
            var j = k + d;
            if (wrap) j = ((j % n) + n) % n;
            if (j < 0 || j >= n) continue;
            nb[j] += bel[k] * Math.exp(-0.5 * Math.pow(d * dx / sigma, 2));
          }
        } else {
          nb[k] += bel[k];
        }
      }
      if (shift) {
        var sc = Math.round(shift / dx), sb = [];
        for (k = 0; k < n; k++) sb.push(0);
        for (k = 0; k < n; k++) {
          var jj = k + sc;
          if (wrap) jj = ((jj % n) + n) % n;
          if (jj < 0 || jj >= n) continue;
          sb[jj] = nb[k];
        }
        for (k = 0; k < n; k++) bel[k] = sb[k];
      } else {
        for (k = 0; k < n; k++) bel[k] = nb[k];
      }
      normalize();
      return bel;
    }
    function ent() {
      var s = 0;
      for (var k = 0; k < n; k++) if (bel[k] > 0) s -= bel[k] * Math.log(bel[k]);
      return s;
    }
    return {
      bel: bel, centers: centers, dx: dx, setPrior: setPrior, normalize: normalize,
      update: update, predict: predict, entropy: ent
    };
  }

  function sym(M) {
    for (var i = 0; i < M.length; i++) for (var j = i + 1; j < M.length; j++) {
      var v = (M[i][j] + M[j][i]) / 2; M[i][j] = v; M[j][i] = v;
    }
    return M;
  }

  function kalman(o) {
    var F = o.F, H = o.H, Q = o.Q, R = o.R, B = o.B || null;
    var x = o.x0.slice();
    var P = o.P0.map(function (r) { return r.slice(); });
    var n = F.length;
    var api = { x: x, P: P };

    function predict(u) {
      var Fx = LA().mulVec(F, x), i;
      if (B != null && u != null) {
        if (isArr(B[0])) {
          var uv = isArr(u) ? u : [u];
          var Bu = LA().mulVec(B, uv);
          for (i = 0; i < Fx.length; i++) Fx[i] += Bu[i];
        } else {
          var us = isArr(u) ? u[0] : u;
          for (i = 0; i < Fx.length; i++) Fx[i] += B[i] * us;
        }
      }
      x = Fx;
      var FP = LA().mul(F, P);
      P = sym(LA().add(LA().mul(FP, LA().transpose(F)), Q));
      api.x = x; api.P = P;
    }

    function update(z) {
      z = isArr(z) ? z : [z];
      var Hx = LA().mulVec(H, x), i;
      var y = z.map(function (zi, k) { return zi - Hx[k]; });
      var Ht = LA().transpose(H);
      var S = LA().add(LA().mul(LA().mul(H, P), Ht), R);
      var Sinv = LA().inverse(S);
      var K = LA().mul(LA().mul(P, Ht), Sinv);
      var Ky = LA().mulVec(K, y);
      var nx = x.map(function (xi, k) { return xi + Ky[k]; });
      var KH = LA().mul(K, H);
      var I = LA().identity(n);
      var M = [];
      for (i = 0; i < n; i++) {
        var row = [];
        for (var j = 0; j < n; j++) row.push(I[i][j] - KH[i][j]);
        M.push(row);
      }
      x = nx;
      P = sym(LA().mul(M, P));
      api.x = x; api.P = P;
    }

    function logLikelihood(z) {
      z = isArr(z) ? z : [z];
      var Hx = LA().mulVec(H, x), i, j;
      var Ht = LA().transpose(H);
      var S = LA().add(LA().mul(LA().mul(H, P), Ht), R);
      var Sinv = LA().inverse(S);
      if (!Sinv) return -Infinity;
      var d = z.map(function (zi, k) { return zi - Hx[k]; });
      var q = 0;
      for (i = 0; i < d.length; i++) {
        var rs = 0;
        for (j = 0; j < d.length; j++) rs += Sinv[i][j] * d[j];
        q += d[i] * rs;
      }
      var lu = LA().lu(S), logdet = 0;
      for (i = 0; i < S.length; i++) logdet += Math.log(Math.abs(lu.U[i][i]));
      return -0.5 * (d.length * Math.log(2 * Math.PI) + logdet + q);
    }

    api.predict = predict; api.update = update; api.logLikelihood = logLikelihood;
    return api;
  }

  function numericJac(g, xx, u) {
    var base = g(xx, u), m = base.length, k = xx.length;
    var J = LA().zeros(m, k);
    for (var j = 0; j < k; j++) {
      var xp = xx.slice();
      var step = 1e-6 * Math.max(1, Math.abs(xx[j]));
      xp[j] += step;
      var gp = g(xp, u);
      for (var i = 0; i < m; i++) J[i][j] = (gp[i] - base[i]) / step;
    }
    return J;
  }

  function ekf(o) {
    var x = o.x0.slice();
    var P = o.P0.map(function (r) { return r.slice(); });
    var n = x.length;
    var Q = o.Q, R = o.R;
    var f = o.f, h = o.h, Ff = o.F, Hf = o.H;
    var api = { x: x, P: P };

    function predict(u) {
      var xp = f(x, u);
      var FJ = Ff ? Ff(x, u) : numericJac(f, x, u);
      P = sym(LA().add(LA().mul(LA().mul(FJ, P), LA().transpose(FJ)), Q));
      x = xp;
      api.x = x; api.P = P;
    }

    function update(z) {
      z = isArr(z) ? z : [z];
      var Hx = h(x), i;
      var HJ = Hf ? Hf(x) : numericJac(function (xx) { return h(xx); }, x, null);
      var y = z.map(function (zi, k) { return zi - Hx[k]; });
      var Ht = LA().transpose(HJ);
      var S = LA().add(LA().mul(LA().mul(HJ, P), Ht), R);
      var Sinv = LA().inverse(S);
      var K = LA().mul(LA().mul(P, Ht), Sinv);
      var Ky = LA().mulVec(K, y);
      var nx = x.map(function (xi, k) { return xi + Ky[k]; });
      var KH = LA().mul(K, HJ);
      var I = LA().identity(n);
      var M = [];
      for (i = 0; i < n; i++) {
        var row = [];
        for (var j = 0; j < n; j++) row.push(I[i][j] - KH[i][j]);
        M.push(row);
      }
      x = nx;
      P = sym(LA().mul(M, P));
      api.x = x; api.P = P;
    }

    function logLikelihood(z) {
      z = isArr(z) ? z : [z];
      var Hx = h(x);
      var HJ = Hf ? Hf(x) : numericJac(function (xx) { return h(xx); }, x, null);
      var Ht = LA().transpose(HJ);
      var S = LA().add(LA().mul(LA().mul(HJ, P), Ht), R);
      var Sinv = LA().inverse(S);
      if (!Sinv) return -Infinity;
      var d = z.map(function (zi, k) { return zi - Hx[k]; });
      var q = 0, i, j;
      for (i = 0; i < d.length; i++) {
        var rs = 0;
        for (j = 0; j < d.length; j++) rs += Sinv[i][j] * d[j];
        q += d[i] * rs;
      }
      var lu = LA().lu(S), logdet = 0;
      for (i = 0; i < S.length; i++) logdet += Math.log(Math.abs(lu.U[i][i]));
      return -0.5 * (d.length * Math.log(2 * Math.PI) + logdet + q);
    }

    api.predict = predict; api.update = update; api.logLikelihood = logLikelihood;
    return api;
  }

  function particleFilter(o) {
    var n = o.n, i;
    var rngObj = ensureRng(o.rng, 7);
    var particles = [], weights = [];
    for (i = 0; i < n; i++) { particles.push(o.init(rngObj)); weights.push(1 / n); }

    function normalize() {
      var s = 0;
      for (var k = 0; k < n; k++) s += weights[k];
      for (k = 0; k < n; k++) weights[k] = s > 0 ? weights[k] / s : 1 / n;
    }
    function predict(u) { for (i = 0; i < n; i++) particles[i] = o.motion(particles[i], u, rngObj); }
    function update(z) { for (i = 0; i < n; i++) weights[i] *= o.weight(particles[i], z); normalize(); }
    function doResample() {
      var cum = [], c = 0, k;
      for (k = 0; k < n; k++) { c += weights[k]; cum.push(c); }
      var start = rngObj() / n, out = [], idx = 0;
      for (k = 0; k < n; k++) {
        var pos = start + k / n;
        while (pos > cum[idx] && idx < n - 1) idx++;
        out.push(stateClone(particles[idx]));
      }
      for (k = 0; k < n; k++) { particles[k] = out[k]; weights[k] = 1 / n; }
      normalize();
    }
    function estimate() {
      if (isArr(particles[0])) {
        var m = stateClone(particles[0]);
        for (var d = 0; d < m.length; d++) {
          var s = 0;
          for (i = 0; i < n; i++) s += weights[i] * particles[i][d];
          m[d] = s;
        }
        return m;
      }
      var s2 = 0;
      for (i = 0; i < n; i++) s2 += weights[i] * particles[i];
      return s2;
    }
    return {
      particles: particles, weights: weights, predict: predict, update: update,
      resample: doResample, estimate: estimate
    };
  }

  // =========================================================================
  // MCMC
  // =========================================================================
  function metropolis(logp, opts) {
    opts = opts || {};
    var rngObj = ensureRng(opts.rng, 11);
    var x = stateClone(opts.x0 == null ? 0 : opts.x0);
    var h = opts.step == null ? 1 : opts.step;
    var lp = logp(x);
    var api = { x: stateClone(x), samples: [], accepted: 0, rate: 0 };

    function step() {
      var len = isArr(x) ? x.length : 1, i;
      var prop = stateClone(x);
      if (isArr(prop)) {
        for (i = 0; i < len; i++) {
          var s = isArr(h) ? h[i] : h;
          prop[i] += s * sNormal(rngObj, 0, 1);
        }
      } else {
        prop = x + h * sNormal(rngObj, 0, 1);
      }
      var lpp;
      try { lpp = logp(prop); } catch (e) { lpp = -Infinity; }
      if (isFinite(lpp) && Math.log(Math.max(rngObj(), 1e-300)) < lpp - lp) {
        x = prop; lp = lpp; api.accepted++;
      }
      api.x = stateClone(x);
      api.samples.push(stateClone(x));
      api.rate = api.samples.length ? api.accepted / api.samples.length : 0;
    }
    api.step = step;
    api.setStep = function (nh) { h = nh; };
    return api;
  }

  function gibbs(conditionals, opts) {
    opts = opts || {};
    var rngObj = ensureRng(opts.rng, 13);
    var x = stateClone(opts.x0 == null ? 0 : opts.x0);
    var api = { x: stateClone(x), samples: [] };
    function step() {
      for (var i = 0; i < conditionals.length; i++) x[i] = conditionals[i](x, rngObj);
      api.x = stateClone(x);
      api.samples.push(stateClone(x));
    }
    api.step = step;
    return api;
  }

  function hmc(logp, gradLogp, opts) {
    opts = opts || {};
    var rngObj = ensureRng(opts.rng, 17);
    var x = isArr(opts.x0) ? opts.x0.slice() : [opts.x0 == null ? 0 : opts.x0];
    var dim = x.length;
    var epsilon = opts.epsilon == null ? 0.1 : opts.epsilon;
    var L = opts.L == null ? 10 : opts.L;
    var api = { x: x.slice(), samples: [], accepted: 0, rate: 0 };
    function grad(xx) { var g = gradLogp(xx); return isArr(g) ? g : [g]; }
    function kinetic(p) { var s = 0; for (var i = 0; i < p.length; i++) s += p[i] * p[i]; return 0.5 * s; }
    function step() {
      var p = [], i;
      for (i = 0; i < dim; i++) p.push(sNormal(rngObj, 0, 1));
      var xp = x.slice(), pp = p.slice();
      var g = grad(xp);
      for (i = 0; i < dim; i++) pp[i] += 0.5 * epsilon * g[i];
      for (var l = 0; l < L; l++) {
        for (i = 0; i < dim; i++) xp[i] += epsilon * pp[i];
        g = grad(xp);
        if (l < L - 1) for (i = 0; i < dim; i++) pp[i] += epsilon * g[i];
      }
      for (i = 0; i < dim; i++) pp[i] += 0.5 * epsilon * g[i];
      var H0 = -logp(x) + kinetic(p);
      var H1 = -logp(xp) + kinetic(pp);
      if (Math.log(Math.max(rngObj(), 1e-300)) < H0 - H1) { x = xp; api.accepted++; }
      api.x = x.slice();
      api.samples.push(x.slice());
      api.rate = api.samples.length ? api.accepted / api.samples.length : 0;
    }
    api.step = step;
    return api;
  }

  // =========================================================================
  // export
  // =========================================================================
  global.Prob = {
    rng: makeRng,
    dist: {
      bernoulli: bernoulli, binomial: binomial, geometric: geometric,
      negBinomial: negBinomial, poisson: poisson, uniform: uniform,
      exponential: exponential, normal: normal, gamma: gamma, beta: beta,
      studentT: studentT, chiSquared: chiSquared, cauchy: cauchy, lognormal: lognormal
    },
    sf: {
      erf: erf, erfinv: erfinv, lgamma: lgamma, lbeta: lbeta,
      regIncGamma: regIncGamma, regIncBeta: regIncBeta, logChoose: logChoose
    },
    plot: plot,
    hist: hist,
    mvn: mvn,
    confEllipse: confEllipse,
    chain: chain,
    info: {
      entropy: entropy, crossEntropy: crossEntropy, kl: kl, js: js, mutualInfo: mutualInfo
    },
    filters: {
      histogramFilter: histogramFilter, kalman: kalman, ekf: ekf, particleFilter: particleFilter
    },
    mcmc: { metropolis: metropolis, gibbs: gibbs, hmc: hmc }
  };
})(window);