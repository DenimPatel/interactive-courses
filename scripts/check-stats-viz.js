#!/usr/bin/env node
/* Numerics self-check for assets/js/stats-viz.js.
 *
 * The repo has no test framework, and a wrong incomplete-beta or incomplete-gamma
 * silently poisons a dozen statistics pages (every exact t / chi-square / F tail
 * area, every confidence interval). This script loads the browser file into a
 * minimal Node sandbox and asserts a set of values that are independently known.
 *
 * Run: node scripts/check-stats-viz.js
 * Exits non-zero on the first failed assertion, printing the component, the
 * expected value and the value actually produced. */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'assets', 'js', 'stats-viz.js');

// --- minimal browser sandbox -------------------------------------------------
const windowObj = {};
windowObj.Guide = {
  seededRandom: function (seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  },
  colors: function () {
    return { accent: '#2b5fff', accent2: '#d6006c', accent400: '#5d85fd', accent700: '#0b3cd0', text: '#201e1d', divider: '#ccc', font: 'sans-serif', mono: 'monospace' };
  },
  niceTicks: function (min, max, target) {
    target = Math.max(1, target || 6);
    if (!isFinite(min) || !isFinite(max) || max <= min) return [];
    const raw = (max - min) / target;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : (norm < 3 ? 2 : (norm < 7 ? 5 : 10))) * mag;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }
};

// stats-viz.js calls (function (global) { ... })(window), so evaluating it with a
// `window` parameter bound to our sandbox puts window.Stats on windowObj.
new Function('window', fs.readFileSync(SRC, 'utf8'))(windowObj);
const Stats = windowObj.Stats;
if (!Stats) { console.error('check-stats-viz: stats-viz.js did not export window.Stats'); process.exit(1); }

// --- assertion helpers -------------------------------------------------------
let failures = 0, checks = 0;
function close(actual, expected, tol, label) {
  checks++;
  const ok = isFinite(actual) && Math.abs(actual - expected) <= tol;
  if (!ok) {
    failures++;
    console.error('  FAIL ' + label + ': expected ' + expected + ' (±' + tol + '), got ' + actual);
  }
}
function eq(actual, expected, label) {
  checks++;
  if (actual !== expected) { failures++; console.error('  FAIL ' + label + ': expected ' + expected + ', got ' + actual); }
}
function truthy(cond, label) {
  checks++;
  if (!cond) { failures++; console.error('  FAIL ' + label); }
}
function section(name) { console.log('· ' + name); }

// --- special functions -------------------------------------------------------
section('special functions');
close(Stats.special.erf(1), 0.8427007929497149, 1e-10, 'erf(1)');
close(Stats.special.erf(0.5), 0.5204998778130465, 1e-10, 'erf(0.5)');
close(Stats.special.erfinv(Stats.special.erf(0.7)), 0.7, 1e-9, 'erfinv∘erf(0.7)');
close(Stats.special.lgamma(5), Math.log(24), 1e-10, 'lgamma(5) = log 24');
close(Stats.special.incBeta(1, 1, 0.5), 0.5, 1e-12, 'I_0.5(1,1)');
close(Stats.special.incGamma(1.5, 3.9075), 0.95, 5e-4, 'P(1.5, 3.9075) ≈ 0.95');
close(Stats.special.incBeta(2, 3, 0.5), 0.6875, 1e-10, 'I_0.5(2,3)');

// --- normal ------------------------------------------------------------------
section('normal');
close(Stats.dist.normal.cdf(1.96), 0.9750021048517795, 1e-8, 'Φ(1.96) = 0.975');
close(Stats.dist.normal.cdf(0), 0.5, 1e-12, 'Φ(0) = 0.5');
close(Stats.dist.normal.pdf(0), 1 / Math.sqrt(2 * Math.PI), 1e-12, 'φ(0)');
close(Stats.dist.normal.quantile(0.975), 1.959963984540054, 1e-6, 'z_0.975 = 1.96');
close(Stats.dist.normal.sf(1.96), 0.024997895148220435, 1e-8, 'upper tail at 1.96');

// --- t -----------------------------------------------------------------------
section('Student t');
close(Stats.dist.t.quantile(0.975, 10), 2.2281388519649385, 1e-4, 't_10 97.5% quantile = 2.228');
close(Stats.dist.t.cdf(2.2281388519649385, 10), 0.975, 1e-5, 't_10 cdf(2.228) = 0.975');
close(Stats.dist.t.quantile(0.95, 30), 1.6972608865939564, 1e-4, 't_30 95% quantile');
close(Stats.dist.t.cdf(0, 7), 0.5, 1e-12, 't cdf at 0');

// --- chi-square --------------------------------------------------------------
section('chi-square');
close(Stats.dist.chi2.cdf(7.815, 3), 0.95, 1e-3, 'χ²_3 cdf(7.815) = 0.95');
close(Stats.dist.chi2.quantile(0.95, 3), 7.814727903251179, 1e-3, 'χ²_3 95% quantile = 7.815');
close(Stats.dist.chi2.quantile(0.95, 1), 3.841458820694124, 1e-3, 'χ²_1 95% quantile = 3.841');
close(Stats.dist.chi2.sf(3.841458820694124, 1), 0.05, 1e-5, 'χ²_1 upper tail at 3.841');

// --- F -----------------------------------------------------------------------
section('F');
close(Stats.dist.f.cdf(9.552094496, 2, 3), 0.95, 1e-3, 'F(2,3) 95% quantile = 9.552');
close(Stats.dist.f.quantile(0.95, 2, 3), 9.552094496, 1e-2, 'F(2,3) quantile round-trip');
close(Stats.dist.f.cdf(5.409451, 3, 5), 0.95, 1e-3, 'F(3,5) 95% quantile = 5.409');
close(Stats.dist.f.sf(5.409451, 3, 5), 0.05, 1e-4, 'F(3,5) upper tail at 5.409');

// --- beta / gamma ------------------------------------------------------------
section('beta and gamma');
close(Stats.dist.beta.pdf(0.5, 2, 3), 1.5, 1e-10, 'Beta(2,3) density at 0.5');
close(Stats.dist.gamma.pdf(2, 3, 1), 2 * Math.exp(-2), 1e-12, 'Gamma(3,1) density at 2');
close(Stats.dist.gamma.cdf(Stats.dist.gamma.quantile(0.8, 4, 2), 4, 2), 0.8, 1e-5, 'Gamma quantile/cdf round-trip');

// --- Bayesian conjugate updates ---------------------------------------------
section('Bayesian updates');
let bb = Stats.bayes.betaBinomial(1, 1, 8, 12);
close(bb.a, 9, 1e-12, 'Beta(1,1)+8 successes → a = 9');
close(bb.b, 5, 1e-12, 'Beta(1,1)+4 failures → b = 5');
close(bb.mean, 9 / 14, 1e-12, 'Beta(9,5) posterior mean = 9/14');
// Part 17's scalar Gaussian fusion: prior N(0,1), observation 2 with variance 1.
const fusion = Stats.bayes.normalNormal(0, 1, 2, 1);
close(fusion.mu, 1, 1e-12, 'Gaussian fusion mean = 1');
close(fusion.var, 0.5, 1e-12, 'Gaussian fusion variance = 0.5');

// --- Kalman update must match the closed-form scalar fusion ------------------
section('Kalman filter');
const kpred = Stats.filter.kalman.predict([0], [[1]], [[1]], [[0]]);
close(kpred.mu[0], 0, 1e-12, 'Kalman predict mean');
close(kpred.Sigma[0][0], 1, 1e-12, 'Kalman predict variance');
const kupd = Stats.filter.kalman.update([0], [[1]], [2], [[1]], [[1]]);
close(kupd.mu[0], fusion.mu, 1e-12, 'Kalman update mean = fusion mean');
close(kupd.Sigma[0][0], fusion.var, 1e-12, 'Kalman update variance = fusion variance');
close(kupd.K[0][0], 0.5, 1e-12, 'Kalman gain = 0.5');
// Predict-then-update on a 1-D random walk with Q > 0.
const kp2 = Stats.filter.kalman.predict([0], [[1]], [[1]], [[0.25]]);
const ku2 = Stats.filter.kalman.update(kp2.mu, kp2.Sigma, [3], [[1]], [[2]]);
close(ku2.Sigma[0][0], 1 / (1 / 1.25 + 1 / 2), 1e-12, 'Kalman posterior precision fusion');

// --- OLS against a hand-computed fit ----------------------------------------
section('estimators');
const X = [[1, 0], [1, 1], [1, 2], [1, 3]];
const yv = [1, 3, 5, 7];
const fit = Stats.est.ols(X, yv);
close(fit.beta[0], 1, 1e-9, 'OLS intercept');
close(fit.beta[1], 2, 1e-9, 'OLS slope');
close(fit.r2, 1, 1e-9, 'OLS R² = 1 for exact line');
close(fit.sigma2, 0, 1e-9, 'OLS residual variance = 0');
const noisy = Stats.est.ols([[1, 0], [1, 1], [1, 2]], [1, 2, 4]);
close(noisy.beta[1], 1.5, 1e-9, 'OLS slope on noisy data');

// --- bootstrap / permutation vs a large-sample normal approximation ----------
section('resampling');
const r = Stats.rng(20260914);
const big = [];
for (let i = 0; i < 400; i++) big.push(Stats.sample.normal(r, 5, 2));
const boots = Stats.resample.bootstrap(big, Stats.summary.mean, 800, r);
const ci = Stats.resample.percentileCI(boots, 0.05);
truthy(ci.lo < 5 && ci.hi > 5, 'bootstrap 95% CI covers the true mean 5');
truthy(ci.hi - ci.lo < 1.2, 'bootstrap CI is tight at n=400');
const A = [], B = [];
for (let i = 0; i < 150; i++) { A.push(Stats.sample.normal(r, 0, 1)); B.push(Stats.sample.normal(r, 0.8, 1)); }
const perm = Stats.resample.permutationTest(A, B, null, 2000, r);
truthy(perm.p < 0.01, 'permutation test detects a 0.8 shift');
const permNull = Stats.resample.permutationTest(A, A.slice(), null, 1000, r);
truthy(permNull.p > 0.05, 'permutation test on identical groups is not significant');

// --- classical tests ---------------------------------------------------------
section('tests');
const onesample = Stats.test.tTest([1, 2, 3, 4, 5], 0);
close(onesample.df, 4, 1e-12, 'one-sample t df');
close(onesample.mean, 3, 1e-12, 'one-sample mean');
const two = Stats.test.tTest([1, 2, 3, 4, 5], [2, 3, 4, 5, 6]);
close(two.stat, -1, 1e-9, 'pooled two-sample t = -1');
const w = Stats.test.welch([1, 2, 3, 4, 5, 6], [2, 3]);
truthy(isFinite(w.p) && w.p >= 0 && w.p <= 1, 'Welch p in [0,1]');
const chi = Stats.test.chi2Test([10, 20, 30], [20, 20, 20]);
close(chi.stat, 10, 1e-9, 'chi-square goodness-of-fit stat = 10');
close(chi.df, 2, 1e-12, 'chi-square df = 2');
const lr = Stats.test.lrt(-100, -95, 2);
close(lr.stat, 10, 1e-12, 'LRT stat = 2·Δloglik');
const bh = Stats.test.benjaminiHochberg([0.001, 0.02, 0.04, 0.5]);
truthy(bh.reject[0] && bh.reject[1] && !bh.reject[2] && !bh.reject[3], 'BH rejects the two smallest p-values (0.04 misses its cutoff)');
const bonf = Stats.test.bonferroni([0.001, 0.02, 0.04, 0.5], 0.05);
truthy(bonf.reject[0] && !bonf.reject[2], 'Bonferroni rejects only the smallest');

// --- metrics -----------------------------------------------------------------
section('metrics');
const ytrue = [0, 0, 1, 1], scores = [0.1, 0.4, 0.35, 0.9];
const rocc = Stats.metric.roc(ytrue, scores);
close(Stats.metric.auc(rocc.fpr, rocc.tpr), 0.75, 1e-9, 'ROC AUC = 0.75 for this ranking');
close(Stats.metric.brier([1, 0], [1, 0]), 0, 1e-12, 'Brier score of perfect predictions');
truthy(Stats.metric.logLoss([0.5, 0.5], [1, 0]) > 0, 'log-loss is positive');
close(Stats.metric.ece([0.5, 0.5], [1, 0], 2), 0, 1e-9, 'ECE of a calibrated 50/50 predictor');

// --- causal ------------------------------------------------------------------
section('causal');
const didres = Stats.causal.did([1, 2, 3, 4, 5, 6, 7, 8], [0, 0, 0, 0, 1, 1, 1, 1], [0, 0, 1, 1, 0, 0, 1, 1]);
truthy(isFinite(didres.estimate), 'difference-in-differences produces a finite estimate');

// --- report ------------------------------------------------------------------
console.log('');
if (failures) {
  console.error('check-stats-viz: ' + failures + ' of ' + checks + ' checks FAILED');
  process.exit(1);
}
console.log('check-stats-viz: all ' + checks + ' checks passed');