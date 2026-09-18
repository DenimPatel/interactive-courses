/* multimodal-viz.js — the domain layer for /ai/multimodal/ (Volume II of the
 * Multimodal & Generative Media arc). Loaded after genmedia-viz.js. Volume I's
 * diffusion-viz.js is not needed here except where a page cross-links it.
 *
 * What lives here: the ViT patchifier and position embeddings, attention maps,
 * the CLIP/SigLIP contrastive objectives (thin wrappers over GenMedia.attn), the
 * retrieval and zero-shot classifiers the shared-space demo runs, the AnyRes /
 * native-resolution tiling arithmetic and its token budget, the three image
 * generation orders (raster, next-scale, masked), and the modality table.
 *
 * House rules: ES5, one global, lazy GenMedia/Guide access, no Math.random().
 * Exposes window.Multimodal. */
(function (global) {
  "use strict";

  function GM() { return global.GenMedia; }
  function colors() { return global.Guide.colors(); }

  // =========================================================================
  // vit — pixels into tokens
  // =========================================================================
  function grid(imageSize, patch) { return Math.floor(imageSize / patch); }
  function tokens(imageSize, patch) { var n = grid(imageSize, patch); return n * n; }

  // Flatten an {w,h,c,data} image into row-major patch vectors of length
  // patch·patch·c. Returns {patches:[[v,…]], grid, patch}.
  function patchify(image, patch) {
    var n = Math.floor(image.w / patch), out = [];
    for (var gy = 0; gy < n; gy++) for (var gx = 0; gx < n; gx++) {
      var vec = [];
      for (var j = 0; j < patch; j++) for (var i = 0; i < patch; i++) {
        var x = gx * patch + i, y = gy * patch + j;
        for (var c = 0; c < image.c; c++) vec.push(image.data[(y * image.w + x) * image.c + c]);
      }
      out.push(vec);
    }
    return { patches: out, grid: n, patch: patch, dim: patch * patch * image.c };
  }

  // Sinusoidal 2-D position embeddings, the original ViT/NeRF construction.
  function positional(n, d) {
    var out = [];
    for (var p = 0; p < n; p++) {
      var row = [];
      for (var i = 0; i < d; i++) {
        var k = Math.floor(i / 2);
        var angle = p / Math.pow(10000, 2 * k / d);
        row.push(i % 2 === 0 ? Math.sin(angle) : Math.cos(angle));
      }
      out.push(row);
    }
    return out;
  }

  // A seeded CLS token.
  function clsToken(d, seed) {
    var r = GM().rng(seed == null ? 1 : seed), out = [];
    for (var i = 0; i < d; i++) out.push(GM().gauss(r));
    return out;
  }

  // Softmax attention of every query against every key, returned as a matrix of
  // weights plus the attended outputs. q/k are arrays of equal-length vectors.
  function attention(q, k, v, temperature) {
    var scores = GM().attn.simMatrix(q, k, { dot: true });
    var weights = scores.map(function (row) { return GM().attn.softmax(row, temperature || 1); });
    var d = (v && v[0] ? v[0].length : 0), outputs = [];
    for (var i = 0; i < weights.length; i++) {
      var o = new Array(d);
      for (var t = 0; t < d; t++) {
        var s = 0;
        for (var j = 0; j < weights[i].length; j++) s += weights[i][j] * ((v && v[j]) ? v[j][t] : 0);
        o[t] = s;
      }
      outputs.push(o);
    }
    return { weights: weights, scores: scores, outputs: outputs };
  }

  var vit = {
    grid: grid, tokens: tokens, patchify: patchify,
    positional: positional, clsToken: clsToken, attention: attention
  };

  // =========================================================================
  // contrastive — CLIP and SigLIP objectives
  // =========================================================================
  function logits(sim, tau) { return sim.map(function (row) { return row.map(function (v) { return v / (tau || 1); }); }); }

  // Zero-shot classification: logits of one embedding against class-text
  // embeddings, turned into a probability distribution.
  function zeroShot(imageEmb, classEmbs, tau) {
    var logit = classEmbs.map(function (c) { return GM().attn.cosine(imageEmb, c) / (tau || 0.07); });
    return { logits: logit, probs: GM().attn.softmax(logit, 1) };
  }

  // Symmetric InfoNCE on a similarity matrix (the CLIP loss).
  function infoNCE(sim, tau) { return GM().attn.infoNCE(sim, tau); }
  // SigLIP's pairwise sigmoid loss.
  function sigmoidLoss(sim, opts) { return GM().attn.sigmoidLoss(sim, opts); }

  // =========================================================================
  // retrieval — cosine ranking over a gallery
  // =========================================================================
  function rank(query, gallery, opts) {
    opts = opts || {};
    var scored = gallery.map(function (g, i) {
      return { index: i, score: opts.dot ? GM().attn.dot(query, g.vec || g) : GM().attn.cosine(query, g.vec || g), item: g };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored;
  }
  function topK(query, gallery, k, opts) { return rank(query, gallery, opts).slice(0, k || 5); }

  // =========================================================================
  // tiles — AnyRes and native-resolution arithmetic
  // =========================================================================
  // Number of tiles of side `tile` needed to cover a w×h image (LLaVA-NeXT's
  // AnyRes grid). 672×336 with 336 tiles is exactly 2.
  function tiles(w, h, tile) { return Math.ceil(w / tile) * Math.ceil(h / tile); }

  // AnyRes token count: one vision-token block per tile plus a thumbnail.
  function anyResTokens(w, h, tile, visionTokens) {
    return tiles(w, h, tile) * (visionTokens || 256) + (visionTokens || 256);
  }

  // Native dynamic resolution: tokens scale with area / patch².
  function nativeTokens(w, h, patch, merge) {
    merge = merge || 1;
    return Math.floor((w / patch) * (h / patch) / (merge * merge));
  }

  var tilesApi = { tiles: tiles, anyResTokens: anyResTokens, nativeTokens: nativeTokens };

  // =========================================================================
  // cost — image tokens and their prefill price
  // =========================================================================
  // Image tokens for a square image at a given patch and optional 2×2 merge.
  function imageTokens(imageSize, patch, merge) {
    return nativeTokens(imageSize, imageSize, patch, merge);
  }
  function prefillFlops(tokens, layers, d, ff) {
    return GM().cost.transformerFlops({ layers: layers, d: d, ff: ff || 4 * d, seq: tokens });
  }
  // KV bytes an image's tokens add to the cache, for the serving cross-link.
  function kvBytes(tokens, layers, kvHeads, headDim, bytes) {
    return GM().cost.kvCacheBytes({ layers: layers, kvHeads: kvHeads, headDim: headDim, tokens: tokens, bytes: bytes });
  }

  var cost = { imageTokens: imageTokens, prefillFlops: prefillFlops, kvBytes: kvBytes };

  // =========================================================================
  // gen — image generation orders
  // =========================================================================
  // Raster order: left to right, top to bottom. `grid` cells per side.
  function rasterCells(grid) {
    var out = [], step = 0;
    for (var y = 0; y < grid; y++) for (var x = 0; x < grid; x++) out.push({ x: x, y: y, step: step++, level: 0 });
    return out;
  }

  // Next-scale (VAR): coarse scales first, then finer ones, each as a full pass.
  function nextScaleCells(grid, levels) {
    var out = [], step = 0;
    for (var l = 0; l < levels; l++) {
      var n = Math.max(1, Math.round(grid / Math.pow(2, levels - 1 - l)));
      var off = (grid - n) / 2;
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
        out.push({ x: Math.round(off + x), y: Math.round(off + y), scale: n, step: step++, level: l });
      }
    }
    return out;
  }

  // Masked generation (MAR): a seeded permutation of cells, revealed in order.
  function maskedCells(grid, seed) {
    var r = GM().rng(seed == null ? 1 : seed), cells = rasterCells(grid);
    for (var i = cells.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = cells[i]; cells[i] = cells[j]; cells[j] = t;
    }
    cells.forEach(function (c, i) { c.step = i; });
    return cells;
  }

  var gen = { rasterCells: rasterCells, nextScaleCells: nextScaleCells, maskedCells: maskedCells };

  // =========================================================================
  // rl — group-relative advantages (GRPO)
  // =========================================================================
  // Score a group of responses sampled for one prompt and use the group itself
  // as the baseline: advantage = (reward − group mean) / group std. No critic
  // network is trained, unlike PPO. `rewards` is one group's scores; a
  // degenerate group (every reward equal) has zero spread and therefore zero
  // advantage everywhere — there is no signal to reinforce. Population std is
  // used because the group is the whole population being compared.
  function groupAdvantage(rewards) {
    var n = rewards.length, i;
    var m = 0;
    for (i = 0; i < n; i++) m += rewards[i];
    m = n ? m / n : 0;
    var v = 0;
    for (i = 0; i < n; i++) { var d = rewards[i] - m; v += d * d; }
    var std = n ? Math.sqrt(v / n) : 0;
    var advantages = rewards.map(function (r) { return std > 1e-12 ? (r - m) / std : 0; });
    return { mean: m, std: std, advantages: advantages };
  }

  var rl = { groupAdvantage: groupAdvantage };

  // =========================================================================
  // modalities — the zoo the shared space has to cover
  // =========================================================================
  var modalities = [
    { id: 'image', encoder: 'ViT / SigLIP', contrastive: 'CLIP, SigLIP', resolution: '224²–any' },
    { id: 'video', encoder: 'spatiotemporal ViT', contrastive: 'VideoCLIP, InternVideo', resolution: 'frames×tokens' },
    { id: 'audio', encoder: 'AST / CLAP audio tower', contrastive: 'CLAP, AudioCLIP', resolution: 'mel frames' },
    { id: 'text', encoder: 'transformer', contrastive: 'CLIP text tower', resolution: 'subwords' },
    { id: '3d', encoder: 'point/voxel encoder', contrastive: 'ULIP, OpenShape', resolution: 'points' }
  ];

  // =========================================================================
  // export
  // =========================================================================
  global.Multimodal = {
    vit: vit,
    contrastive: { logits: logits, zeroShot: zeroShot, infoNCE: infoNCE, sigmoidLoss: sigmoidLoss },
    retrieval: { rank: rank, topK: topK },
    tiles: tilesApi,
    cost: cost,
    gen: gen,
    rl: rl,
    modalities: modalities
  };
})(window);
