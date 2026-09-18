#!/usr/bin/env node
/* Numerics self-check for the Multimodal & Generative Media domain layers
 * (assets/js/genmedia-viz.js and, once they exist, diffusion-viz.js and
 * multimodal-viz.js).
 *
 * The repo has no test framework. These files will carry every number the two
 * new guides draw — noise schedules, samplers, score functions, guidance
 * algebra, STFT/mel/RVQ, contrastive losses, token-budget arithmetic — and a
 * wrong schedule exponent or a misplaced mel bin silently poisons a whole act.
 * This script loads the browser files into a minimal Node sandbox and asserts
 * values that are independently known.
 *
 * Run: node scripts/check-genmedia-viz.js
 * Exits non-zero on the first failure, printing the component, the expected
 * value and the value actually produced. Mirrors scripts/check-stats-viz.js. */
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'assets', 'js');
const CORE = path.join(DIR, 'genmedia-viz.js');
const OPTIONAL = ['diffusion-viz.js', 'multimodal-viz.js'].map((f) => path.join(DIR, f));

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

// The domain files call (function (global) { … })(window).
new Function('window', fs.readFileSync(CORE, 'utf8'))(windowObj);
for (const f of OPTIONAL) {
  if (fs.existsSync(f)) new Function('window', fs.readFileSync(f, 'utf8'))(windowObj);
}
const GM = windowObj.GenMedia;
if (!GM) { console.error('check-genmedia-viz: genmedia-viz.js did not export window.GenMedia'); process.exit(1); }

// --- assertion helpers -------------------------------------------------------
let failures = 0, checks = 0;
function close(actual, expected, tol, label) {
  checks++;
  const ok = typeof actual === 'number' && isFinite(actual) && Math.abs(actual - expected) <= tol;
  if (!ok) { failures++; console.error('  FAIL ' + label + ': expected ' + expected + ' (±' + tol + '), got ' + actual); }
}
function eq(actual, expected, label) {
  checks++;
  if (actual !== expected) { failures++; console.error('  FAIL ' + label + ': expected ' + expected + ', got ' + actual); }
}
function truthy(cond, label) {
  checks++;
  if (!cond) { failures++; console.error('  FAIL ' + label); }
}
function section(name) { console.log('\u00b7 ' + name); }

// --- seeded randomness -------------------------------------------------------
section('seeded randomness');
{
  const a = GM.rng(12345), b = GM.rng(12345);
  const xa = a(), xb = b();
  eq(xa, xb, 'rng is deterministic for a given seed');
  truthy(xa >= 0 && xa < 1, 'rng output is in [0,1)');
  const r = GM.rng(777);
  let s = 0, s2 = 0, n = 4000;
  for (let i = 0; i < n; i++) { const g = GM.gauss(r); s += g; s2 += g * g; }
  const mu = s / n, va = s2 / n - mu * mu;
  close(mu, 0, 0.07, 'gauss mean ≈ 0');
  close(va, 1, 0.12, 'gauss variance ≈ 1');
}

// --- softmax / losses --------------------------------------------------------
section('softmax and contrastive losses');
{
  const p = GM.attn.softmax([1, 2, 3]);
  close(p.reduce((a, b) => a + b, 0), 1, 1e-12, 'softmax sums to 1');
  close(p[2], 0.6652409557748219, 1e-10, 'softmax([1,2,3])[2]');

  // A 2×2 problem with logits [[1,0],[0,1]] and temperature 1.
  const sim = [[1, 0], [0, 1]];
  const expected = -Math.log(Math.E / (Math.E + 1));
  close(expected, 0.31326168751822286, 1e-12, 'sanity: −log(e/(e+1))');
  close(GM.attn.infoNCE(sim, 1), expected, 1e-9, 'InfoNCE on the identity matrix');
  // diagonal logit 1 (positive), off-diagonal logit 0 (negative).
  close(GM.attn.sigmoidLoss(sim, { temperature: 1, bias: 0 }), (2 * Math.log(1 + Math.exp(-1)) + 2 * Math.log(2)) / 4, 1e-12, 'SigLIP loss on the identity matrix');

  // A perfectly aligned similarity matrix should give a lower InfoNCE loss.
  const r = GM.rng(9);
  const A = [], B = [];
  for (let i = 0; i < 4; i++) { const v = [GM.gauss(r), GM.gauss(r)]; A.push(v); B.push(v.slice()); }
  const aligned = GM.attn.simMatrix(A, B);
  truthy(GM.attn.infoNCE(aligned, 0.1) < GM.attn.infoNCE(aligned, 5), 'lower temperature sharpens the contrastive loss');
  close(GM.attn.cosine([1, 0], [1, 0]), 1, 1e-12, 'cosine of identical vectors');
  close(GM.attn.cosine([1, 0], [0, 1]), 0, 1e-12, 'cosine of orthogonal vectors');
}

// --- DSP: FFT / STFT / mel / RVQ --------------------------------------------
section('DSP');
{
  const sr = 8000, n = 1024;
  const sig = GM.dsp.tone(1000, sr, n, 1);
  const st = GM.dsp.stft(sig, { winSize: 256, hop: 256, sr: sr });
  eq(st.bins, 129, 'STFT bins = winSize/2 + 1');
  truthy(st.frames >= 3, 'STFT produces several frames');
  const peak = GM.dsp.argmax(st.mag[1]);
  eq(peak, 32, 'a 1 kHz tone at 8 kHz peaks in bin f·N/sr = 32');

  const bank = GM.dsp.melFilterbank(8, 129, sr);
  eq(bank.filters.length, 8, 'mel filterbank has nMels rows');
  bank.filters.forEach((f, i) => close(f.reduce((a, b) => a + b, 0), 1, 1e-9, 'mel row ' + i + ' sums to 1'));
  truthy(bank.filters.every((f) => f.every((v) => v >= 0)), 'mel filters are non-negative');
  close(GM.dsp.hzToMel(1000) / GM.dsp.hzToMel(100), 2595 * Math.log10(1 + 1000 / 700) / (2595 * Math.log10(1 + 100 / 700)), 1e-12, 'hzToMel scales as defined');

  const x = [0, 0.3, 0.7, 1.0];
  const q = GM.dsp.rvq(x, { stages: 3, levels: 4 });
  close(q.errors[0], 0.145, 1e-9, 'RVQ stage-0 error = input variance');
  truthy(q.errors[1] < q.errors[0] && q.errors[2] < q.errors[1] && q.errors[3] < q.errors[2], 'RVQ error strictly decreases with stages');
  truthy(GM.dsp.mse(q.recon, x) < q.errors[0] && GM.dsp.mse(q.recon, x) < q.errors[1], 'RVQ reconstruction beats its first two stages');

  // Mel spectrogram, frame energy and codec rates.
  const mixed = GM.dsp.add(GM.dsp.tone(600, sr, 512, 0.9), GM.dsp.silence(512));
  const ms = GM.dsp.melSpectrogram(mixed, { winSize: 256, hop: 128, sr: sr, nMels: 16 });
  truthy(ms.frames.length > 0 && ms.frames[0].length === 16, 'mel spectrogram has one row per mel band');
  truthy(ms.frames[0].some((v) => v > 0), 'mel spectrogram of a tone is non-zero');
  const energy = GM.dsp.frameEnergy(GM.dsp.add(GM.dsp.tone(600, sr, 512, 0.9), GM.dsp.silence(512)), 128, 64);
  truthy(energy.every((v) => v >= 0), 'frame energy is non-negative');
  eq(GM.dsp.tokenRate(75, 8), 600, 'EnCodec-style token rate = frame rate × codebooks');
  close(GM.dsp.bitrateKbps(75, 8, 10), 6, 1e-12, '75 Hz × 8 codebooks × 10 bits = 6 kbps');
}

// --- cost arithmetic ---------------------------------------------------------
section('token and FLOP arithmetic');
{
  const p1 = GM.cost.patchify(224, 16);
  eq(p1.tokens, 196, '224² image, 16² patches → 196 tokens');
  eq(p1.grid, 14, '224/16 = 14 patches per side');
  eq(GM.cost.patchify(64, 8).tokens, 64, '64² image, 8² patches → 64 tokens');

  const v = GM.cost.videoTokens(72, 720, 1280, 2, 4, 8);
  eq(v.tokens, 64800, '72 frames → 18×45×80 = 64,800 video tokens');
  eq(v.latentFrames, 18, 'temporal compression 4 → 18 latent frames');

  const flops = GM.cost.transformerFlops({ layers: 1, d: 8, seq: 4, ff: 32 });
  eq(flops, 6656, 'one transformer block at d=8, seq=4, ff=32');

  const kv = GM.cost.kvCacheBytes({ layers: 1, kvHeads: 1, headDim: 4, tokens: 8, bytes: 2 });
  eq(kv, 128, 'KV bytes = 2·L·H·d·T·β');
}

// --- timeline ----------------------------------------------------------------
section('latency timeline');
{
  const b = GM.timeline.budget([{ name: 'asr', ms: 60 }, { name: 'net', ms: 30 }, { name: 'ttft', ms: 120 }, { name: 'tts', ms: 40 }]);
  eq(b.total, 250, 'latency budget sums its stages');
  eq(b.segments[2].start, 90, 'third stage starts after the first two');
  const t = GM.timeline.turn({ speechMs: 2000, netMs: 30, ttftMs: 120, ttsFirstMs: 40 });
  eq(t.gapMs, 190, 'turn gap = network + TTFT + TTS first chunk');
}

// --- tiny MLP trainer --------------------------------------------------------
section('tiny MLP trainer');
{
  const xs = [[0], [0.25], [0.5], [0.75], [1]];
  const ys = [[0], [1], [0.5], [0.2], [0.9]];
  const a = GM.net.mlp([1, 8, 1], 42);
  truthy(GM.net.paramCount(a) > 0, 'MLP reports a positive parameter count');
  truthy(Math.abs(GM.net.forward(a, [0.5])[0]) < 5, 'fresh MLP forward pass is finite');
  const ta = GM.net.train(a, xs, ys, { lr: 0.08, epochs: 400 });
  truthy(ta.loss < ta.losses[0], 'training reduces the loss');
  truthy(ta.losses[0] > 0.02, 'the initial loss is non-trivial, so the decrease is meaningful');
  const b2 = GM.net.mlp([1, 8, 1], 42);
  const tb = GM.net.train(b2, xs, ys, { lr: 0.08, epochs: 400 });
  close(tb.loss, ta.loss, 1e-12, 'training is deterministic for a fixed seed and data order');
}

// --- plot / raster surface ---------------------------------------------------
section('widget surface');
{
  truthy(typeof GM.plot === 'function', 'GenMedia.plot exists');
  truthy(typeof GM.raster === 'function', 'GenMedia.raster exists');
  const im = GM.img.checkerboard(8, 4);
  eq(im.data.length, 8 * 8 * 3, 'procedural checkerboard is w·h·c floats');
  eq(im.data[0], 0, 'checkerboard starts dark');
  const grad = GM.img.gradient(4);
  close(grad.data[(0 * 4 + 3) * 3], 1, 1e-12, 'gradient R channel reaches 1 at the right edge');
  close(grad.data[(3 * 4 + 0) * 3 + 1], 1, 1e-12, 'gradient G channel reaches 1 at the bottom');
}

// --- optional diffusion layer (present from Act 2 onward) --------------------
if (windowObj.Diffusion) {
  const D = windowObj.Diffusion;
  section('diffusion schedules and samplers');
  // Cosine schedule ᾱ_t, cumulative-product identities.
  const lin = D.schedule('linear', 1000);
  truthy(lin.alphaBar.length === 1000, 'linear schedule has T entries');
  close(lin.alphaBar[0], 1 - lin.betas[0], 1e-12, 'ᾱ_1 = 1 − β_1');
  truthy(lin.alphaBar.every((a, i) => i === 0 || a <= lin.alphaBar[i - 1] + 1e-12), 'ᾱ is non-increasing');
  truthy(lin.alphaBar[999] < 1e-4, 'ᾱ_T is near zero for the linear schedule');
  const cos = D.schedule('cosine', 1000);
  truthy(cos.alphaBar[0] > lin.alphaBar[0], 'cosine schedule destroys the signal more slowly at first');
  truthy(cos.alphaBar[999] < 0.01, 'cosine ᾱ_T is near zero');

  // q(x_t|x_0) has unit marginal variance when x_0 is unit-variance.
  const r = GM.rng(2026);
  const ab = lin.alphaBar[499];
  let m = 0, v = 0, N = 20000;
  for (let i = 0; i < N; i++) { const x0 = GM.gauss(r); const xt = D.qSample(r, x0, ab); m += xt; v += xt * xt; }
  m /= N; v = v / N - m * m;
  close(v, 1, 0.05, 'q(x_t|x_0) keeps unit marginal variance');
  close(m, 0, 0.05, 'q(x_t|x_0) has zero mean');

  // DDIM is deterministic and round-trips x_T = α_T x_0 + σ_T ε.
  close(D.epsFromX0(0.5, 1.0, 0.64), -0.5, 1e-12, 'ε = (x_t − √ᾱ·x_0)/√(1−ᾱ)');
  const s1 = D.ddimSample(lin, 4, 1234, { x0: 1.0 });
  const s2 = D.ddimSample(lin, 4, 1234, { x0: 1.0 });
  eq(s1, s2, 'DDIM with the same seed is deterministic');
  const rt = D.ddimRoundTrip(lin, 50, 1234.5, 77);
  close(rt, 1234.5, 1e-6, 'DDIM round-trips a scalar x_0');

  // Flow matching: the straight path and its constant velocity.
  close(D.flowX(0, 1, 0.2), 1, 1e-12, 'flow starts at x_0 at t=0');
  close(D.flowX(1, 1, 0.2), 0.2, 1e-12, 'flow reaches x_1 at t=1');
  close(D.flowX(0.25, 0, 1), 0.25, 1e-12, 'flow is linear in t');
  close(D.flowVelocity(5, -3), -8, 1e-12, 'flow velocity = x_1 − x_0, constant in t');

  // The score of a Gaussian is −(x−μ)/σ².
  close(D.gaussScore(2.5, 1.0, 2.0), -1.5 / 4, 1e-12, 'score of N(μ,σ²) at x');
  close(D.scoreFromEps(-0.5, 0.25), 0.5 / Math.sqrt(1 - 0.25), 1e-12, 'ε-prediction → score');

  // Classifier-free guidance algebra.
  close(D.cfg(2, 3, 5), 7, 1e-12, 'CFG = w·cond + (1−w)·uncond');
  close(D.cfg(0, 3, 5), 3, 1e-12, 'CFG at w=0 is the unconditional prediction');
  close(D.cfg(1, 3, 5), 5, 1e-12, 'CFG at w=1 is the conditional prediction');
  close(D.cfgRescale(5, 1), 5, 1e-12, 'CFG rescale at ratio 1 is a no-op');
  close(D.cfgRescale(7, 5 / 7), 5, 1e-12, 'CFG rescale matches the conditional std');

  // Backbone and latent helpers.
  const bd = D.ditBreakdown({ imageSize: 32, patch: 2, layers: 2, d: 8, ff: 32 });
  eq(bd.tokens, 256, 'DiT breakdown patchifies 32² into 256 tokens');
  eq(bd.adaLN, 96, 'adaLN-Zero costs 6·d per block');
  close(D.adaLNZero(2, 0, 0), 2, 1e-12, 'adaLN-Zero is the identity at γ=β=0');
  const u = D.unetBreakdown({ channels: [32, 64], blocks: 2 });
  truthy(u.params > 0 && u.levels.length === 2, 'U-Net breakdown reports a positive count per level');
  const chk = GM.img.checkerboard(16, 4);
  const vaeRt = D.vaeRoundTrip(chk, 4);
  eq(vaeRt.latent.w, 4, 'VAE round trip pools a 16² image to 4×4');
  truthy(vaeRt.mse >= 0 && vaeRt.mse < 0.05, 'checkerboard survives a 4× pool/upsample with small error');
  close(D.curvedPath(0, 1, 0.2, 0.6), 1, 1e-12, 'curved path shares x_0 at t=0');
  close(D.curvedPath(1, 1, 0.2, 0.6), 0.2, 1e-12, 'curved path shares x_1 at t=1');
  close(D.guidanceEffect(2, 3, 5).extrapolation, 2, 1e-12, 'guidance extrapolation = (w−1)(cond−uncond)');

  // Solvers, control and video.
  const sig = D.karrasSigmas(8, 0.01, 80, 7);
  eq(sig.length, 8, 'Karras sigma list length');
  truthy(sig.every((s, i) => i === 0 || s <= sig[i - 1] + 1e-12), 'Karras sigmas are non-increasing');
  close(sig[0], 80, 1e-9, 'Karras starts at sigma_max');
  close(sig[7], 0.01, 1e-9, 'Karras ends at sigma_min');

  const x0s = 1.0, start = D.forwardX(lin, x0s, lin.T, 0.7);
  const nearOracle = (x, t) => { const ab = D.abAt(lin, t); return D.epsFromX0(x, x0s, ab) * (1 + 0.15 * (1 - ab)); };
  const solve = (method, steps) => D.odeSolve(lin, { method: method, steps: steps, start: start, predict: nearOracle });
  const ref = solve('euler', 20000);
  const e4 = solve('euler', 4), e128 = solve('euler', 128);
  truthy(Math.abs(e128 - ref) < Math.abs(e4 - ref), 'Euler converges as the step count grows');
  const h16 = solve('heun', 16), h256 = solve('heun', 256);
  truthy(Math.abs(h256 - ref) < Math.abs(h16 - ref), 'Heun converges as the step count grows');

  const vac = D.videoAttentionCost({ frames: 8, h: 8, w: 8, patch: 2 });
  eq(vac.tokens, 128, 'video token count');
  eq(vac.full, 16384, 'full 3-D attention cost');
  eq(vac.factorized, 3072, 'factorized attention cost');
  close(vac.ratio, 16384 / 3072, 1e-9, '3-D / factorized attention ratio');

  const dW = D.loraDelta([[0, 0], [0, 0]], [[1, 0]], [[1], [0]], 2);
  close(dW[0][0], 2, 1e-12, 'LoRA delta = (alpha/rank)·B·A');
  eq(dW[0][1], 0, 'LoRA delta leaves the other entries alone');

  const drift = D.temporalDrift(12, 0.9, 5);
  truthy(drift[11] > drift[0], 'autoregressive drift grows over the rollout');
}

// --- optional multimodal layer (present from Act 6 onward) -------------------
if (windowObj.Multimodal) {
  const M = windowObj.Multimodal;
  section('multimodal layers');
  truthy(typeof M.vit.tokens === 'function', 'Multimodal.vit.tokens exists');
  eq(M.vit.tokens(224, 16), 196, 'ViT token count 224/16');
  eq(M.tiles.tiles(672, 336, 336), 2, 'AnyRes tiling divides an image into crops');

  const im = GM.img.checkerboard(8, 2);
  const pk = M.vit.patchify(im, 4);
  eq(pk.patches.length, 4, 'a 8² image with 4² patches yields 4 tokens');
  eq(pk.patches[0].length, 4 * 4 * 3, 'each patch vector is patch²·channels');
  const pe = M.vit.positional(4, 8);
  eq(pe.length, 4, 'positional embeddings: one row per token');
  eq(pe[0].length, 8, 'positional embedding dimension');

  const zs = M.contrastive.zeroShot([1, 0], [[1, 0], [0, 1], [1, 1]], 0.07);
  close(zs.probs.reduce((a, b) => a + b, 0), 1, 1e-12, 'zero-shot probabilities sum to 1');
  truthy(zs.probs[0] > zs.probs[1], 'zero-shot favours the aligned class');
  const sim = [[1, 0.2], [0.1, 0.9]];
  truthy(M.contrastive.infoNCE(sim, 0.1) > 0, 'InfoNCE is positive');
  truthy(M.contrastive.sigmoidLoss(sim, {}) > 0, 'SigLIP loss is positive');

  const ranked = M.retrieval.rank([1, 0], [[0, 1], [1, 0], [0.7, 0.1]]);
  eq(ranked[0].index, 1, 'retrieval ranks the nearest gallery item first');
  eq(M.retrieval.topK([1, 0], [[0, 1], [1, 0]], 1).length, 1, 'topK returns k items');

  const rc = M.gen.rasterCells(3);
  eq(rc.length, 9, 'raster order enumerates a 3×3 grid');
  eq(rc[0].step, 0, 'raster order starts top-left');
  eq(rc[8].step, 8, 'raster order ends bottom-right');
  const ns = M.gen.nextScaleCells(4, 2);
  truthy(ns.every((c, i) => i === 0 || c.level >= ns[i - 1].level), 'next-scale order is coarse-to-fine');
  eq(ns.filter((c) => c.level === 0).length, 4, 'next-scale level 0 is the 2×2 coarse pass');
  const mc = M.gen.maskedCells(3, 7);
  eq(new Set(mc.map((c) => c.step)).size, 9, 'masked order permutes every cell exactly once');

  eq(M.cost.imageTokens(224, 16, 1), 196, 'image token cost at patch 16');
  eq(M.cost.imageTokens(224, 16, 2), 49, 'a 2×2 merge quarters the token budget');
  truthy(M.cost.kvBytes(196, 32, 8, 128, 2) > 0, 'image tokens add to the KV cache');
  eq(M.modalities.length, 5, 'the modality zoo lists five modalities');

  // GRPO group-relative advantage: the group is its own baseline.
  const grp = M.rl.groupAdvantage([0, 1, 2]);
  close(grp.mean, 1, 1e-12, 'GRPO group mean');
  close(grp.std, Math.sqrt(2 / 3), 1e-12, 'GRPO group std (population)');
  close(grp.advantages[0], -1 / Math.sqrt(2 / 3), 1e-12, 'GRPO advantage of the worst sample');
  close(grp.advantages[2], 1 / Math.sqrt(2 / 3), 1e-12, 'GRPO advantage of the best sample');
  close(grp.advantages.reduce((a, b) => a + b, 0), 0, 1e-12, 'GRPO advantages sum to zero');
  const flatGroup = M.rl.groupAdvantage([0.5, 0.5, 0.5]);
  truthy(flatGroup.std === 0 && flatGroup.advantages.every((a) => a === 0), 'a degenerate GRPO group carries no advantage');
}

// --- report ------------------------------------------------------------------
console.log('');
if (failures) {
  console.error('check-genmedia-viz: ' + failures + ' of ' + checks + ' checks FAILED');
  process.exit(1);
}
console.log('check-genmedia-viz: all ' + checks + ' checks passed');
