/* diffusion-viz.js — the domain layer for /ai/generative-media/ (Volume I of the
 * Multimodal & Generative Media arc). Loaded after genmedia-viz.js.
 *
 * What lives here: the noise schedules and their cumulative products, the
 * forward process in closed form, the score function and its relation to the
 * ε-prediction, the DDPM / DDIM / Euler / flow-matching samplers, VE/VP SDE
 * coefficients, classifier-free guidance algebra, a toy VAE and latent pooling,
 * a 2-D toy distribution for the "train a denoiser" demos, and the U-Net/DiT
 * cost wrappers. Everything else — seeded randomness, plotting, rasters, the
 * tiny MLP, DSP, contrastive losses — is in genmedia-viz.js.
 *
 * Indexing convention: schedule.alphaBar[i] holds ᾱ for timestep t = i + 1, with
 * t = 0 meaning "clean" (ᾱ = 1). abAt(sch, t) resolves that, so callers never
 * have to remember the offset.
 *
 * House rules: ES5, one global, lazy GenMedia/Guide access, no Math.random().
 * Exposes window.Diffusion. */
(function (global) {
  "use strict";

  function GM() { return global.GenMedia; }
  function colors() { return global.Guide.colors(); }

  // =========================================================================
  // schedules
  // =========================================================================
  function finish(kind, T, betas, alphas, alphaBar) {
    var sqrtAlphaBar = [], sqrtOneMinus = [], snr = [];
    for (var i = 0; i < T; i++) {
      var ab = alphaBar[i];
      sqrtAlphaBar.push(Math.sqrt(ab));
      sqrtOneMinus.push(Math.sqrt(Math.max(0, 1 - ab)));
      snr.push(ab / Math.max(1e-12, 1 - ab));
    }
    return {
      kind: kind, T: T, betas: betas, alphas: alphas, alphaBar: alphaBar,
      sqrtAlphaBar: sqrtAlphaBar, sqrtOneMinusAlphaBar: sqrtOneMinus, snr: snr
    };
  }

  function linearSchedule(T, opts) {
    var b0 = opts.betaStart == null ? 1e-4 : opts.betaStart;
    var b1 = opts.betaEnd == null ? 0.02 : opts.betaEnd;
    var betas = [], alphas = [], alphaBar = [], cum = 1;
    for (var i = 0; i < T; i++) {
      var b = b0 + (b1 - b0) * i / (T - 1);
      betas.push(b); alphas.push(1 - b); cum *= (1 - b); alphaBar.push(cum);
    }
    return finish('linear', T, betas, alphas, alphaBar);
  }

  function cosineSchedule(T, opts) {
    var s = opts.s == null ? 0.008 : opts.s;
    var f0 = Math.cos((s / (1 + s)) * Math.PI / 2);
    var raw = [], i;
    for (i = 0; i < T; i++) {
      var t = i + 1;
      var f = Math.cos(((t / T) + s) / (1 + s) * Math.PI / 2);
      raw.push((f * f) / (f0 * f0));
    }
    var betas = [], alphas = [], alphaBar = [], prev = 1;
    for (i = 0; i < T; i++) {
      var ab = Math.min(1, raw[i]);
      var b = 1 - ab / prev;
      if (b < 1e-8) b = 1e-8;
      if (b > 0.999) b = 0.999;
      var abAdj = prev * (1 - b);
      betas.push(b); alphas.push(1 - b); alphaBar.push(abAdj);
      prev = abAdj;
    }
    return finish('cosine', T, betas, alphas, alphaBar);
  }

  function schedule(kind, T, opts) {
    opts = opts || {};
    T = T || 1000;
    return kind === 'cosine' ? cosineSchedule(T, opts) : linearSchedule(T, opts);
  }

  // ᾱ_t with t = 0 meaning clean.
  function abAt(sch, t) {
    if (t <= 0) return 1;
    if (t >= sch.T) return sch.alphaBar[sch.T - 1];
    return sch.alphaBar[t - 1];
  }

  // SNR(t) = ᾱ_t / (1 − ᾱ_t), the shape every schedule diagram plots.
  function snrAt(sch, t) { var ab = abAt(sch, t); return ab / Math.max(1e-12, 1 - ab); }

  // The log-SNR slope, which is what "linear" and "cosine" actually differ in.
  function logSnr(sch) {
    var out = [];
    for (var t = 1; t <= sch.T; t++) { var ab = abAt(sch, t); out.push(Math.log(Math.max(1e-9, ab) / Math.max(1e-9, 1 - ab))); }
    return out;
  }

  // =========================================================================
  // forward process and its inverses
  // =========================================================================
  // x_t = √ᾱ·x_0 + √(1−ᾱ)·ε, the closed form of the whole forward chain.
  function forwardX(sch, x0, t, eps) {
    var ab = abAt(sch, t);
    return Math.sqrt(ab) * x0 + Math.sqrt(Math.max(0, 1 - ab)) * eps;
  }

  // One draw from q(x_t | x_0) for a scalar (or vector) x_0.
  function qSample(r, x0, ab) {
    return Math.sqrt(ab) * x0 + Math.sqrt(Math.max(0, 1 - ab)) * GM().gauss(r);
  }

  // ε = (x_t − √ᾱ·x_0) / √(1−ᾱ)
  function epsFromX0(xt, x0, ab) {
    return (xt - Math.sqrt(ab) * x0) / Math.sqrt(Math.max(1e-12, 1 - ab));
  }

  // x_0 = (x_t − √(1−ᾱ)·ε) / √ᾱ
  function x0FromEps(xt, eps, ab) {
    return (xt - Math.sqrt(Math.max(0, 1 - ab)) * eps) / Math.sqrt(Math.max(1e-12, ab));
  }

  // v-prediction: v = α_t ε − σ_t x_0 (Salimans & Ho), where α_t = √ᾱ, σ_t = √(1−ᾱ).
  function vFromX0(x0, eps, ab) { return Math.sqrt(ab) * eps - Math.sqrt(Math.max(0, 1 - ab)) * x0; }
  function x0FromV(v, xt, ab) {
    var a = Math.sqrt(ab), s = Math.sqrt(Math.max(0, 1 - ab));
    return a * xt - s * v;
  }

  // Apply per-pixel Gaussian noise to a flat [0,1] image, for the raster demos.
  function addNoise(data, ab, r) {
    var out = new Array(data.length), k = Math.sqrt(Math.max(0, 1 - ab)), s = Math.sqrt(ab);
    for (var i = 0; i < data.length; i++) out[i] = s * data[i] + k * GM().gauss(r);
    return out;
  }

  // =========================================================================
  // samplers
  // =========================================================================
  // Timesteps from T down to 0 in `steps` even spans (deduplicated).
  function timesteps(T, steps) {
    var ts = [], prev = null;
    for (var k = steps; k >= 0; k--) {
      var t = Math.round(T * k / steps);
      if (t !== prev) { ts.push(t); prev = t; }
    }
    return ts;
  }

  // One deterministic DDIM step (η = 0), expressed as an x_0 reconstruction.
  function ddimStep(x, abT, abPrev, epsPred) {
    var x0 = x0FromEps(x, epsPred, abT);
    return Math.sqrt(abPrev) * x0 + Math.sqrt(Math.max(0, 1 - abPrev)) * epsPred;
  }

  // One ancestral DDPM step: returns {x, mean, var}.
  function ddpmStep(x, abT, abPrev, epsPred, r) {
    var alphaT = abT / Math.max(1e-12, abPrev);
    var betaT = 1 - alphaT;
    var mean = (x - (betaT / Math.sqrt(Math.max(1e-12, 1 - abT))) * epsPred) / Math.sqrt(Math.max(1e-12, alphaT));
    var varT = betaT * (1 - abPrev) / Math.max(1e-12, 1 - abT);
    var out = mean;
    if (r && varT > 0) out = mean + Math.sqrt(varT) * GM().gauss(r);
    return { x: out, mean: mean, var: varT };
  }

  // The generic reverse loop. opts:
  //   predict(x, t) -> ε      (required)
  //   method   'ddim' | 'ddpm' | 'euler'
  //   steps    number of reverse steps
  //   rng      seeded stream (used by ddpm, and the initial draw if no start)
  //   start    scalar start value (default: a fresh standard normal)
  // Returns {x, path} where path is [{t, x}] from the start down to 0.
  function sampler(sch, opts) {
    opts = opts || {};
    var method = opts.method || 'ddim';
    var steps = opts.steps || 50;
    var r = opts.rng || GM().rng(1);
    var x = opts.start == null ? GM().gauss(r) : opts.start;
    var ts = timesteps(sch.T, steps);
    var path = [{ t: sch.T, x: x }];
    for (var i = 0; i + 1 < ts.length; i++) {
      var t = ts[i], tPrev = ts[i + 1];
      var abT = abAt(sch, t);
      var abPrev = tPrev <= 0 ? 1 : abAt(sch, tPrev);
      var eps = opts.predict(x, t);
      if (method === 'ddpm') {
        var st = ddpmStep(x, abT, abPrev, eps, tPrev > 0 ? r : null);
        x = st.x;
      } else if (method === 'euler') {
        // ε-parameterised probability-flow ODE: dx = (x − ε/σ)/ (2 ... ) is fiddly;
        // use the equivalent x_0/ε Euler update that the DDIM step reduces to.
        x = ddimStep(x, abT, abPrev, eps);
      } else {
        x = ddimStep(x, abT, abPrev, eps);
      }
      path.push({ t: tPrev, x: x });
    }
    return { x: x, path: path };
  }

  // DDIM from pure noise with an oracle ε-predictor that knows the answer — the
  // exactness harness the numerics check uses, and the cleanest way to show that
  // DDIM inverts the forward process when the model is perfect.
  function oraclePredict(sch, x0) {
    return function (x, t) { return epsFromX0(x, x0, abAt(sch, t)); };
  }

  function ddimSample(sch, steps, seed, opts) {
    opts = opts || {};
    var x0 = opts.x0 == null ? 1 : opts.x0;
    var r = GM().rng(seed);
    var eps = GM().gauss(r);
    var start = forwardX(sch, x0, sch.T, eps);
    return sampler(sch, { method: 'ddim', steps: steps, start: start, predict: oraclePredict(sch, x0), rng: r }).x;
  }

  function ddimRoundTrip(sch, steps, x0, seed) {
    return ddimSample(sch, steps, seed, { x0: x0 });
  }

  // =========================================================================
  // flow matching / rectified flow
  // =========================================================================
  // The straight path x_t = (1−t)·x_0 + t·x_1, t in [0,1].
  function flowX(t, x0, x1) { return (1 - t) * x0 + t * x1; }
  // Its velocity, which is constant along the path: x_1 − x_0.
  function flowVelocity(x0, x1) { return x1 - x0; }
  // Training loss for the velocity field: (v_θ(x_t, t) − (x_1 − x_0))².
  function flowLoss(vPred, x0, x1) { var d = vPred - flowVelocity(x0, x1); return d * d; }
  // A curved path with the same endpoints, to show what rectified flow straightens:
  // x_t = (1−t)x_0 + t·x_1 + bend·sin(πt).
  function curvedPath(t, x0, x1, bend) {
    bend = bend == null ? 0.6 : bend;
    return flowX(t, x0, x1) + bend * Math.sin(Math.PI * t);
  }
  // The tangent of the curved path, for the velocity-field comparison.
  function curvedVelocity(t, x0, x1, bend) {
    bend = bend == null ? 0.6 : bend;
    return flowVelocity(x0, x1) + bend * Math.PI * Math.cos(Math.PI * t);
  }
  // A reflow straightening step: average the endpoint velocities a curved flow
  // maps to each other, then re-fit the straight path.
  function reflowPair(x0, x1, t) { return [flowX(t, x0, x1), flowVelocity(x0, x1)]; }
  function straightenPairs(n, seed) {
    var r = GM().rng(seed == null ? 1 : seed), pairs = [], i;
    for (i = 0; i < n; i++) {
      var x0 = GM().gauss(r), x1 = GM().gauss(r);
      var t = r();
      pairs.push([x0, x1, t, curvedVelocity(t, x0, x1)]);
    }
    return pairs;
  }

  // =========================================================================
  // score functions and SDEs
  // =========================================================================
  // ∇_x log N(x; μ, σ²) = −(x − μ)/σ².
  function gaussScore(x, mu, sigma) { return -(x - mu) / (sigma * sigma); }
  // The ε-network *is* the score, up to a known factor: ∇ log p = −ε/√(1−ᾱ).
  function scoreFromEps(eps, ab) { return -eps / Math.sqrt(Math.max(1e-12, 1 - ab)); }
  // Langevin dynamics: one step toward higher density, plus the matching noise.
  function langevinStep(x, score, step, r) {
    return x + step * score + (r ? Math.sqrt(2 * step) * GM().gauss(r) : 0);
  }

  // Variance-exploding SDE: g(t) = √(2 σ(t) σ'(t)).
  function veDiffusion(sigma, sigmaDot) { return Math.sqrt(Math.max(0, 2 * sigma * sigmaDot)); }
  // Variance-preserving SDE: drift −½βx, diffusion √β.
  function vpDrift(beta, x) { return -0.5 * beta * x; }
  function vpDiffusion(beta) { return Math.sqrt(Math.max(0, beta)); }

  // =========================================================================
  // classifier-free guidance
  // =========================================================================
  // ε = w·ε_cond + (1−w)·ε_uncond.
  function cfg(w, uncond, cond) { return w * cond + (1 - w) * uncond; }
  // Guidance rescale: multiply the guided prediction by the ratio of the
  // conditional prediction's std to the guided one's, to undo over-saturation.
  function cfgRescale(x, ratio) { return x * ratio; }
  // Guidance interval: full guidance only inside [tLo, tHi] of the trajectory.
  function cfgInterval(wBase, w, t, tLo, tHi) { return (t >= tLo && t <= tHi) ? w : wBase; }

  // =========================================================================
  // latent space: a toy VAE compressor
  // =========================================================================
  // Average-pool a flat image (w×h×c) by `factor` — the 8× downsample a latent
  // diffusion model's encoder performs, in about as simple a form as possible.
  function pool(image, factor) {
    factor = factor || 2;
    var w = image.w, h = image.h, c = image.c, data = image.data;
    var lw = Math.floor(w / factor), lh = Math.floor(h / factor);
    var out = new Array(lw * lh * c);
    for (var y = 0; y < lh; y++) for (var x = 0; x < lw; x++) for (var ch = 0; ch < c; ch++) {
      var s = 0;
      for (var j = 0; j < factor; j++) for (var i = 0; i < factor; i++) {
        s += data[((y * factor + j) * w + (x * factor + i)) * c + ch];
      }
      out[(y * lw + x) * c + ch] = s / (factor * factor);
    }
    return { w: lw, h: lh, c: c, data: out };
  }

  // Nearest-neighbour upsample, the decoder half, for illustration.
  function upsample(latent, factor) {
    factor = factor || 2;
    var w = latent.w, h = latent.h, c = latent.c, data = latent.data;
    var ow = w * factor, oh = h * factor;
    var out = new Array(ow * oh * c);
    for (var y = 0; y < oh; y++) for (var x = 0; x < ow; x++) for (var ch = 0; ch < c; ch++) {
      out[(y * ow + x) * c + ch] = data[((Math.floor(y / factor)) * w + Math.floor(x / factor)) * c + ch];
    }
    return { w: ow, h: oh, c: c, data: out };
  }

  // =========================================================================
  // cost models (delegating the arithmetic to GenMedia.cost)
  // =========================================================================
  function ditCost(opts) {
    var tokens = GM().cost.patchify(opts.imageSize, opts.patch).tokens;
    var params = GM().cost.transformerParams({ layers: opts.layers, d: opts.d, ff: opts.ff });
    var flops = GM().cost.transformerFlops({ layers: opts.layers, d: opts.d, ff: opts.ff, seq: tokens });
    return { tokens: tokens, params: params, flops: flops };
  }

  function unetCost(opts) {
    return { params: GM().cost.unetParams(opts) };
  }

  // A round trip through the toy compressor: pool to the latent, upsample back.
  // Returns {latent, recon, mse} — the demonstrable cost of 8× downsampling.
  function vaeRoundTrip(image, factor) {
    var latent = pool(image, factor);
    var recon = upsample(latent, factor);
    var n = Math.min(recon.data.length, image.data.length), err = 0, i;
    for (i = 0; i < n; i++) { var d = recon.data[i] - image.data[i]; err += d * d; }
    return { latent: latent, recon: recon, mse: n ? err / n : 0 };
  }

  // Parameter/FLOP count per resolution level for a U-Net-ish denoiser. The
  // numbers are the envelope, not a specific checkpoint: two residual blocks
  // (4·c_in·c_out convs) plus a self-attention block at the two lowest levels.
  function unetBreakdown(opts) {
    opts = opts || {};
    var channels = opts.channels || [320, 640, 1280, 1280];
    var blocks = opts.blocks || 2;
    var levels = [], totalParams = 0, i;
    for (i = 0; i < channels.length; i++) {
      var cin = i === 0 ? channels[0] : channels[i - 1];
      var cout = channels[i];
      var res = blocks * 4 * cin * cout;
      var attn = i <= 1 ? 2 * cout * cout : 0;
      var p = res + attn + 2 * cout; // + time embedding projection
      levels.push({ level: i, channels: cout, params: p, res: res, attn: attn });
      totalParams += p;
    }
    return { levels: levels, params: totalParams };
  }

  // Parameter/FLOP count for a DiT block stack, including the adaLN-Zero
  // modulation parameters (6·d per block) that make conditioning cheap.
  function ditBreakdown(opts) {
    var tokens = GM().cost.patchify(opts.imageSize, opts.patch).tokens;
    var perLayer = GM().cost.transformerParams({ layers: 1, d: opts.d, ff: opts.ff });
    var adaLN = opts.layers * 6 * opts.d;
    var params = GM().cost.transformerParams({ layers: opts.layers, d: opts.d, ff: opts.ff }) + adaLN;
    var flops = GM().cost.transformerFlops({ layers: opts.layers, d: opts.d, ff: opts.ff, seq: tokens });
    return { tokens: tokens, params: params, flops: flops, perLayer: perLayer, adaLN: adaLN };
  }

  // adaLN-Zero: x ← x·(1 + γ(c)) + β(c), with γ and β produced by a small MLP
  // from the conditioning vector. At initialisation γ = β = 0, so the block is
  // the identity — the trick that made deep DiTs trainable.
  function adaLNZero(x, gamma, beta) { return x * (1 + gamma) + beta; }

  // =========================================================================
  // solvers on the probability-flow ODE
  // =========================================================================
  // The actual guided prediction plus a simple "how far past the conditional
  // prediction are we extrapolating" measure, for the oversaturation demo.
  function guidanceEffect(w, uncond, cond) {
    var value = cfg(w, uncond, cond);
    return { value: value, extrapolation: (w - 1) * (cond - uncond), excess: Math.abs((w - 1) * (cond - uncond)) };
  }
  // σ_t = √((1−ᾱ_t)/ᾱ_t), the noise-to-signal ratio a Karras-style sampler
  // actually integrates in. σ decreases from a large value to 0 during sampling.
  function sigmaOf(ab) { return Math.sqrt(Math.max(0, 1 - ab) / Math.max(1e-12, ab)); }
  function sigmaAt(sch, t) { return sigmaOf(abAt(sch, t)); }

  // Karras et al.'s non-uniform spacing: dense near σ_min, sparse near σ_max.
  function karrasSigmas(n, sigmaMin, sigmaMax, rho) {
    n = n || 10; sigmaMin = sigmaMin == null ? 0.002 : sigmaMin;
    sigmaMax = sigmaMax == null ? 80 : sigmaMax; rho = rho || 7;
    var out = [], inv = 1 / rho;
    for (var i = 0; i < n; i++) {
      var a = Math.pow(sigmaMax, inv), b = Math.pow(sigmaMin, inv);
      out.push(Math.pow(a + i / (n - 1) * (b - a), rho));
    }
    return out;
  }

  // Integrate dx/dσ = (x − x̂_0(x, t))/σ with Euler or Heun. `predict(x, t)`
  // returns ε (t is a schedule index in 1..T). Because the model is imperfect
  // this converges to the ODE solution as steps grow — the page's whole point.
  function odeSolve(sch, opts) {
    opts = opts || {};
    var method = opts.method || 'euler';
    var steps = opts.steps || 50;
    var x = opts.start == null ? 0 : opts.start;
    var ts = timesteps(sch.T, steps);
    for (var i = 0; i + 1 < ts.length; i++) {
      var t = ts[i], tPrev = ts[i + 1];
      var abT = abAt(sch, t);
      var abPrev = tPrev <= 0 ? 1 : abAt(sch, tPrev);
      var sigT = sigmaOf(abT), sigPrev = sigmaOf(abPrev);
      var dS = sigPrev - sigT;
      if (method === 'heun') {
        var k1 = pfDerivative(x, opts.predict(x, t), abT, sigT);
        var xp = x + dS * k1;
        var k2 = pfDerivative(xp, opts.predict(xp, t), abT, sigT);
        x = x + dS * (k1 + k2) / 2;
      } else {
        x = x + dS * pfDerivative(x, opts.predict(x, t), abT, sigT);
      }
    }
    return x;
  }

  function pfDerivative(x, eps, abT, sigT) {
    var x0 = x0FromEps(x, eps, abT);
    return (x - x0) / Math.max(1e-9, sigT);
  }

  // Distance from x to the target, the error a solver plot traces.
  function solverError(sch, x0, opts) {
    opts = opts || {};
    var start = forwardX(sch, x0, sch.T, opts.eps == null ? 0 : opts.eps);
    var x = odeSolve(sch, { method: opts.method, steps: opts.steps, start: start, predict: oraclePredict(sch, x0) });
    return Math.abs(x - x0);
  }

  // =========================================================================
  // distillation toys
  // =========================================================================
  // A teacher trajectory for a scalar x0 (oracle), and a one-step "student"
  // target: given x_t, predict x_0 directly. This is the consistency objective.
  function teacherTrajectory(sch, x0, steps, eps) {
    var start = forwardX(sch, x0, sch.T, eps == null ? 1 : eps);
    var ts = timesteps(sch.T, steps), path = [{ t: sch.T, x: start }];
    for (var i = 0; i + 1 < ts.length; i++) {
      var t = ts[i], tPrev = ts[i + 1];
      var abT = abAt(sch, t), abPrev = tPrev <= 0 ? 1 : abAt(sch, tPrev);
      var epsP = epsFromX0(path[path.length - 1].x, x0, abT);
      path.push({ t: tPrev, x: ddimStep(path[path.length - 1].x, abT, abPrev, epsP) });
    }
    return path;
  }

  // A training pair for a one-step student: (x_t, x_0).
  function distillPair(sch, x0, t, r) {
    var ab = abAt(sch, t);
    return { xt: qSample(r, x0, ab), x0: x0, t: t, ab: ab };
  }

  // =========================================================================
  // control: LoRA, inpainting, SDEdit
  // =========================================================================
  // LoRA's low-rank weight update: ΔW = (alpha/rank)·B·A, added to a frozen W.
  function loraDelta(W, A, B, alpha) {
    var rank = B[0].length;
    var scale = (alpha == null ? 1 : alpha) / rank;
    var out = W.map(function (row) { return row.slice(); });
    for (var i = 0; i < W.length; i++) {
      for (var j = 0; j < W[0].length; j++) {
        var s = 0;
        for (var k = 0; k < rank; k++) s += B[i][k] * A[k][j];
        out[i][j] += scale * s;
      }
    }
    return out;
  }

  // Inpainting: keep the known pixels, replace the masked ones.
  function inpaintMix(known, generated, mask) {
    var out = new Array(known.length);
    for (var i = 0; i < known.length; i++) out[i] = mask[i] ? generated[i] : known[i];
    return out;
  }

  // SDEdit: add noise to time t0, then denoise with the model. `predict` is the
  // denoiser; the result is an edit that stays near x0 without an inversion.
  function sdeditPath(sch, x0, t0, steps, predict, r) {
    var start = qSample(r, x0, abAt(sch, t0));
    var ts = timesteps(t0, steps), path = [{ t: t0, x: start }];
    for (var i = 0; i + 1 < ts.length; i++) {
      var t = ts[i], tPrev = ts[i + 1];
      var abT = abAt(sch, t), abPrev = abAt(sch, tPrev);
      path.push({ t: tPrev, x: ddimStep(path[path.length - 1].x, abT, abPrev, predict(path[path.length - 1].x, t)) });
    }
    return path;
  }

  // =========================================================================
  // video: attention cost, temporal drift, autoregressive rollout
  // =========================================================================
  // Full 3-D attention against the factorised (spatial then temporal) form that
  // makes video diffusion tractable. Doubles as a token-budget calculator.
  function videoAttentionCost(o) {
    var th = Math.floor(o.h / o.patch), tw = Math.floor(o.w / o.patch);
    var perFrame = th * tw, n = o.frames * perFrame;
    var full = n * n;
    var spatial = o.frames * (perFrame * perFrame);
    var temporal = o.frames * o.frames * perFrame;
    var factorized = spatial + temporal;
    return {
      tokens: n, perFrame: perFrame, full: full, spatial: spatial,
      temporal: temporal, factorized: factorized, ratio: factorized ? full / factorized : 1
    };
  }

  // Per-frame drift magnitude for an autoregressive rollout: each new frame
  // inherits a fraction `decay` of the previous drift plus a fresh error.
  function temporalDrift(frames, decay, seed) {
    var r = GM().rng(seed == null ? 1 : seed), out = [], acc = 0;
    for (var i = 0; i < frames; i++) { acc = acc * decay + Math.abs(GM().gauss(r)); out.push(acc); }
    return out;
  }

  // Roll an autoregressive model out step by step, returning every frame.
  function arRollout(init, steps, stepFn) {
    var out = [init];
    for (var i = 0; i < steps; i++) out.push(stepFn(out[out.length - 1], i));
    return out;
  }

  // =========================================================================
  // 2-D toy distributions for the denoiser demos
  // =========================================================================
  // A small, deterministic set of 2-D points from one of a few shapes. The
  // pages draw them, add noise to them and train a denoiser on them.
  function toy2d(kind, n, seed) {
    var r = GM().rng(seed == null ? 1 : seed), pts = [], i, a, rad;
    if (kind === 'ring') {
      for (i = 0; i < n; i++) {
        a = 2 * Math.PI * i / n + 0.15 * GM().gauss(r);
        rad = 2 + 0.18 * GM().gauss(r);
        pts.push([rad * Math.cos(a), rad * Math.sin(a)]);
      }
    } else if (kind === 'moons') {
      for (i = 0; i < n; i++) {
        var half = i < n / 2;
        var u = Math.PI * ((i % (n / 2)) / (n / 2 - 1 || 1));
        if (half) pts.push([Math.cos(u) - 0.5 + 0.08 * GM().gauss(r), Math.sin(u) * 0.6 + 0.08 * GM().gauss(r)]);
        else pts.push([1 - Math.cos(u) - 0.5 + 0.08 * GM().gauss(r), 0.6 - Math.sin(u) * 0.6 + 0.08 * GM().gauss(r)]);
      }
    } else if (kind === 'mixture') {
      var cs = [[-1.6, -0.6], [1.5, 0.9], [0.1, -1.7]];
      for (i = 0; i < n; i++) {
        var c = cs[i % cs.length];
        pts.push([c[0] + 0.55 * GM().gauss(r), c[1] + 0.55 * GM().gauss(r)]);
      }
    } else { /* 'gauss' */
      for (i = 0; i < n; i++) { var g = GM().gauss2(r); pts.push([g[0], g[1] * 0.6]); }
    }
    return pts;
  }

  // The analytic optimum of the denoising objective at time t for the mixture
  // shape: the posterior mean, which is what a perfect ε-predictor encodes.
  function mixturePosteriorMean(x, ab, cs, sd) {
    ab = Math.max(1e-6, ab);
    var weights = [], total = 0, i;
    for (i = 0; i < cs.length; i++) {
      var dx = x[0] - Math.sqrt(ab) * cs[i][0];
      var dy = x[1] - Math.sqrt(ab) * cs[i][1];
      var d2 = dx * dx + dy * dy;
      var w = Math.exp(-d2 / (2 * (1 - ab + ab * sd * sd)));
      weights.push(w); total += w;
    }
    if (total < 1e-30) return [0, 0];
    var sx = 0, sy = 0;
    for (i = 0; i < cs.length; i++) {
      var post = weights[i] / total;
      sx += post * cs[i][0]; sy += post * cs[i][1];
    }
    return [sx, sy];
  }

  // =========================================================================
  // rendering helpers the pages share
  // =========================================================================
  // Draw a scalar trajectory on a GenMedia.plot (x = timestep, y = value).
  function drawPath(plot, path, o) {
    o = o || {};
    plot.curve(path.map(function (p) { return [p.t, p.x]; }), { color: o.color || colors().accent, width: o.width || 2 });
  }

  // Draw the noise schedule as two curves: ᾱ_t and the SNR on a log axis.
  function drawSchedule(plot, sch, o) {
    o = o || {};
    plot.curve(function (t) { return [t, abAt(sch, Math.round(t))]; }, { color: colors().accent, width: 2 });
  }

  global.Diffusion = {
    schedule: schedule, linearSchedule: linearSchedule, cosineSchedule: cosineSchedule,
    abAt: abAt, snrAt: snrAt, logSnr: logSnr,
    forwardX: forwardX, qSample: qSample, epsFromX0: epsFromX0, x0FromEps: x0FromEps,
    vFromX0: vFromX0, x0FromV: x0FromV, addNoise: addNoise,
    timesteps: timesteps, ddimStep: ddimStep, ddpmStep: ddpmStep, sampler: sampler,
    ddimSample: ddimSample, ddimRoundTrip: ddimRoundTrip, oraclePredict: oraclePredict,
    flowX: flowX, flowVelocity: flowVelocity, flowLoss: flowLoss, reflowPair: reflowPair,
    curvedPath: curvedPath, curvedVelocity: curvedVelocity, straightenPairs: straightenPairs,
    gaussScore: gaussScore, scoreFromEps: scoreFromEps, langevinStep: langevinStep,
    veDiffusion: veDiffusion, vpDrift: vpDrift, vpDiffusion: vpDiffusion,
    cfg: cfg, cfgRescale: cfgRescale, cfgInterval: cfgInterval,
    pool: pool, upsample: upsample,
    ditCost: ditCost, unetCost: unetCost,
    vaeRoundTrip: vaeRoundTrip, unetBreakdown: unetBreakdown, ditBreakdown: ditBreakdown,
    adaLNZero: adaLNZero, guidanceEffect: guidanceEffect,
    sigmaOf: sigmaOf, sigmaAt: sigmaAt, karrasSigmas: karrasSigmas,
    odeSolve: odeSolve, solverError: solverError,
    teacherTrajectory: teacherTrajectory, distillPair: distillPair,
    loraDelta: loraDelta, inpaintMix: inpaintMix, sdeditPath: sdeditPath,
    videoAttentionCost: videoAttentionCost, temporalDrift: temporalDrift, arRollout: arRollout,
    toy2d: toy2d, mixturePosteriorMean: mixturePosteriorMean,
    drawPath: drawPath, drawSchedule: drawSchedule
  };
})(window);
