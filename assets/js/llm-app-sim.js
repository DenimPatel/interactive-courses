/* ==========================================================================
   llm-app-sim.js — the domain layer shared by BOTH LLM-application volumes
   (Building with LLMs, Interactively / Agents in Action, Interactively).

   Everything domain-shaped lives here; the guide kit (guide-core.js) keeps only
   genuinely generic primitives. The single running example of the two volumes —
   an assistant over this site's own documentation corpus — is fixed here once:
   CORPUS is the shared set of documents and their hand-fixed 2-D coordinates, so
   the semantic-space plot in Volume 1 is literally the space the agent searches
   in Volume 2.

   Rules this file obeys:
     · deterministic — every stochastic path goes through rng(seed), which wraps
       Guide.seededRandom. Math.random() must never appear in a demo.
     · no network, no real model. "Embeddings" are the 2-D coordinates; "judges"
       are scored mock verdicts; "agents" replay a scripted trajectory.
     · loaded after guide-core.js. Exposes window.AppSim. Node-loadable: the
       only external dependency is Guide.seededRandom (bound at call time).

   A companion self-check asserts the numerics: scripts/check-llm-app-sim.js.
   ========================================================================== */
(function (global) {
  "use strict";

  // -------------------------------------------------------------------------
  // Random
  // -------------------------------------------------------------------------

  // Seeded stream. Delegates to the kit's LCG so every series shares one RNG
  // definition; falls back to an identical local copy if guide-core is absent
  // (e.g. a Node self-check that only loads this file).
  function rng(seed) {
    if (global.Guide && typeof global.Guide.seededRandom === 'function') {
      return global.Guide.seededRandom(seed);
    }
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // Standard normal from a seeded uniform stream (Box–Muller).
  function gaussian(r) {
    var u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // -------------------------------------------------------------------------
  // CORPUS — the shared throughline: ~60 short documents drawn from this site,
  // each with hand-fixed 2-D coordinates. The coordinates are the "embedding":
  // fixed once, never changed, because every later demo depends on them.
  //
  // guide: llm-training | llm-serving | llm-apps | math | vision-robotics
  // x, y: in [-1, 1]; five topical clusters around the labelled centres.
  // -------------------------------------------------------------------------
  var CORPUS = [
    // — LLM training (centre ≈ −0.62, +0.66) —
    { id: 'language-models', title: 'What a language model is', guide: 'llm-training', x: -0.78, y: 0.82,
      text: 'a language model is a function that scores the next token given the tokens before it' },
    { id: 'tokens', title: 'Tokens and tokenizers', guide: 'llm-training', x: -0.70, y: 0.74,
      text: 'byte pair encoding splits text into tokens which are not words and not characters' },
    { id: 'architecture', title: 'The transformer architecture', guide: 'llm-training', x: -0.66, y: 0.86,
      text: 'stacked self attention and feed forward blocks with residual connections and normalization' },
    { id: 'pretraining', title: 'The pretraining objective', guide: 'llm-training', x: -0.58, y: 0.70,
      text: 'next token prediction over a web scale corpus is a self supervised compression objective' },
    { id: 'data', title: 'Data curation', guide: 'llm-training', x: -0.62, y: 0.58,
      text: 'deduplication filtering and quality classifiers decide what the model learns from' },
    { id: 'scaling', title: 'Scaling laws', guide: 'llm-training', x: -0.74, y: 0.62,
      text: 'loss falls as a power law in parameters data and compute with a compute optimal ratio' },
    { id: 'evaluation', title: 'Evaluating a model', guide: 'llm-training', x: -0.52, y: 0.78,
      text: 'benchmarks measure capability but saturate and leak into training data' },
    { id: 'fine-tuning', title: 'Fine-tuning', guide: 'llm-training', x: -0.56, y: 0.50,
      text: 'supervised fine tuning adapts a pretrained model to instructions and a format' },
    { id: 'rlhf', title: 'RLHF and preference tuning', guide: 'llm-training', x: -0.68, y: 0.46,
      text: 'a reward model trained on human preferences then optimized with reinforcement learning' },
    { id: 'reasoning', title: 'Reasoning training', guide: 'llm-training', x: -0.50, y: 0.66,
      text: 'reinforcement learning from verifiable rewards trains long chains of thought' },
    { id: 'training-inference', title: 'Inference and the KV cache', guide: 'llm-training', x: -0.46, y: 0.86,
      text: 'prefill processes the prompt and decode emits one token at a time using a key value cache' },
    { id: 'long-context-training', title: 'Long-context training', guide: 'llm-training', x: -0.60, y: 0.90,
      text: 'positional interpolation and attention variants extend the trained context window' },
    { id: 'tool-use-training', title: 'Tool use as training', guide: 'llm-training', x: -0.44, y: 0.58,
      text: 'tool calling is taught in post training by demonstrating calls and their results' },
    { id: 'guardrails', title: 'Guardrails and safety', guide: 'llm-training', x: -0.42, y: 0.48,
      text: 'safety training aligns refusals and reduces harmful completions' },
    { id: 'post-training-scale', title: 'The post-training recipe', guide: 'llm-training', x: -0.54, y: 0.38,
      text: 'the combination of supervised fine tuning and preference optimization at scale' },

    // — LLM serving (centre ≈ +0.62, +0.66) —
    { id: 'decode-loop', title: 'The decode loop', guide: 'llm-serving', x: 0.80, y: 0.76,
      text: 'generating a token reads every weight once so generation is memory bandwidth bound' },
    { id: 'hardware', title: 'Serving hardware', guide: 'llm-serving', x: 0.72, y: 0.84,
      text: 'accelerators are compared on memory bandwidth capacity interconnect and power' },
    { id: 'metrics', title: 'TTFT TPOT and goodput', guide: 'llm-serving', x: 0.66, y: 0.68,
      text: 'time to first token and time per output token define the latency contract' },
    { id: 'kv-cache', title: 'The KV cache', guide: 'llm-serving', x: 0.62, y: 0.78,
      text: 'the key value cache grows with context and concurrency and dominates memory' },
    { id: 'paged-memory', title: 'PagedAttention', guide: 'llm-serving', x: 0.56, y: 0.70,
      text: 'paged memory stores the cache in fixed blocks to remove fragmentation' },
    { id: 'batching', title: 'Continuous batching', guide: 'llm-serving', x: 0.50, y: 0.62,
      text: 'iteration level batching refills the batch every step to raise throughput' },
    { id: 'scheduling', title: 'Request scheduling', guide: 'llm-serving', x: 0.64, y: 0.56,
      text: 'the scheduler orders the queue and enforces fairness and admission control' },
    { id: 'prefix-caching', title: 'Prefix caching', guide: 'llm-serving', x: 0.58, y: 0.48,
      text: 'reusing the key value cache of a shared prompt prefix saves prefill compute' },
    { id: 'quantization', title: 'Quantization', guide: 'llm-serving', x: 0.46, y: 0.82,
      text: 'reducing weight precision lowers bytes moved per token and raises throughput' },
    { id: 'speculative', title: 'Speculative decoding', guide: 'llm-serving', x: 0.42, y: 0.72,
      text: 'a draft model proposes tokens that the target model verifies in one pass' },
    { id: 'parallelism', title: 'Tensor parallelism', guide: 'llm-serving', x: 0.74, y: 0.60,
      text: 'sharding weights across accelerators inside a fast interconnect domain' },
    { id: 'disaggregation', title: 'Prefill decode disaggregation', guide: 'llm-serving', x: 0.52, y: 0.90,
      text: 'separate pools for prefill and decode each sized for its own bottleneck' },
    { id: 'moe', title: 'Mixture of experts', guide: 'llm-serving', x: 0.36, y: 0.64,
      text: 'a sparse mixture of experts activates a fraction of parameters per token' },
    { id: 'cluster', title: 'Autoscaling and routing', guide: 'llm-serving', x: 0.70, y: 0.46,
      text: 'gateways routers and autoscalers manage cold start and cache aware routing' },
    { id: 'economics', title: 'Cost and capacity planning', guide: 'llm-serving', x: 0.44, y: 0.54,
      text: 'convert requests per second into gpus and dollars with a cost per task' },

    // — LLM applications (centre ≈ −0.58, −0.66) —
    { id: 'prompt-design', title: 'Prompt design', guide: 'llm-apps', x: -0.80, y: -0.74,
      text: 'a system prompt sets role and constraints while delimiters separate data from instructions' },
    { id: 'few-shot', title: 'Few-shot examples', guide: 'llm-apps', x: -0.72, y: -0.82,
      text: 'examples specify a task better than description and the model copies their format' },
    { id: 'chain-of-thought', title: 'Chain of thought', guide: 'llm-apps', x: -0.66, y: -0.66,
      text: 'asking the model to reason step by step improves accuracy on multi step tasks' },
    { id: 'structured-output', title: 'Structured output', guide: 'llm-apps', x: -0.60, y: -0.78,
      text: 'json schema and constrained decoding mask tokens so the syntax is always valid' },
    { id: 'context-engineering', title: 'Context engineering', guide: 'llm-apps', x: -0.58, y: -0.60,
      text: 'curate the smallest set of high signal tokens across many turns and compact as needed' },
    { id: 'prompt-caching', title: 'Caching-aware prompt layout', guide: 'llm-apps', x: -0.74, y: -0.62,
      text: 'stable content first and volatile content last so the provider prefix cache hits' },
    { id: 'eval-harness', title: 'The evaluation harness', guide: 'llm-apps', x: -0.50, y: -0.70,
      text: 'a labelled set of examples and a deterministic check gives a pass rate you can trust' },
    { id: 'rag', title: 'Retrieval augmented generation', guide: 'llm-apps', x: -0.46, y: -0.84,
      text: 'retrieve relevant passages and put them in the context so answers cite sources' },
    { id: 'embeddings', title: 'Embeddings', guide: 'llm-apps', x: -0.52, y: -0.54,
      text: 'a vector represents meaning and similarity is measured by cosine distance' },
    { id: 'chunking', title: 'Chunking', guide: 'llm-apps', x: -0.40, y: -0.62,
      text: 'splitting documents into passages balances retrieval precision against context cost' },
    { id: 'vector-search', title: 'Vector search', guide: 'llm-apps', x: -0.44, y: -0.50,
      text: 'an approximate nearest neighbour index trades recall for latency and memory' },
    { id: 'reranking', title: 'Reranking', guide: 'llm-apps', x: -0.36, y: -0.72,
      text: 'retrieve a wide candidate set then rerank narrowly with a cross encoder' },
    { id: 'llm-judge', title: 'LLM as judge', guide: 'llm-apps', x: -0.62, y: -0.90,
      text: 'a model grades outputs against a rubric and carries position and verbosity biases' },
    { id: 'agent-loops', title: 'Agent loops', guide: 'llm-apps', x: -0.68, y: -0.50,
      text: 'an agent alternates reasoning and tool calls until the task is done' },
    { id: 'prompt-injection', title: 'Prompt injection', guide: 'llm-apps', x: -0.30, y: -0.84,
      text: 'untrusted content can carry instructions that divert an agent with access to tools' },

    // — Math foundations (centre ≈ +0.72, −0.66) —
    { id: 'linear-algebra', title: 'Linear algebra', guide: 'math', x: 0.78, y: -0.80,
      text: 'vectors matrices and the singular value decomposition that embeddings rest on' },
    { id: 'calculus', title: 'Calculus', guide: 'math', x: 0.70, y: -0.72,
      text: 'derivatives gradients and the chain rule behind backpropagation' },
    { id: 'probability', title: 'Probability', guide: 'math', x: 0.74, y: -0.60,
      text: 'random variables expectation and bayes rule for reasoning under uncertainty' },
    { id: 'statistics', title: 'Statistics', guide: 'math', x: 0.62, y: -0.74,
      text: 'estimation confidence intervals and hypothesis tests for measuring a system' },
    { id: 'optimization', title: 'Optimization', guide: 'math', x: 0.84, y: -0.66,
      text: 'gradient descent converges toward a minimum of a loss surface' },

    // — Vision and robotics (centre ≈ 0.04, +0.10) —
    { id: 'multi-view-geometry', title: 'Multi-view geometry', guide: 'vision-robotics', x: 0.06, y: 0.18,
      text: 'recovering three dimensional structure from many two dimensional images' },
    { id: 'nonlinear-optimization', title: 'Nonlinear optimization', guide: 'vision-robotics', x: -0.04, y: 0.10,
      text: 'least squares and gauss newton iterations for fitting a model to data' },
    { id: 'slam', title: 'SLAM', guide: 'vision-robotics', x: 0.12, y: -0.08,
      text: 'simultaneous localization and mapping fuses noisy measurements into a map' },
    { id: 'navigation', title: 'Robot navigation', guide: 'vision-robotics', x: -0.10, y: 0.20,
      text: 'odometry path planning and control for a mobile robot' },
    { id: 'image-formation', title: 'Image formation', guide: 'vision-robotics', x: 0.20, y: 0.02,
      text: 'the pinhole camera projects a three dimensional scene onto an image plane' },
    { id: 'feature-matching', title: 'Feature matching', guide: 'vision-robotics', x: -0.18, y: 0.06,
      text: 'detecting and matching keypoints between two images of the same scene' },
    { id: 'camera-calibration', title: 'Camera calibration', guide: 'vision-robotics', x: 0.02, y: 0.28,
      text: 'estimating intrinsic and extrinsic parameters from known correspondences' },
    { id: 'pose-estimation', title: 'Pose estimation', guide: 'vision-robotics', x: 0.16, y: 0.16,
      text: 'r and t estimation from correspondences with ransac for robustness' },
    { id: 'quaternions', title: 'Quaternions', guide: 'vision-robotics', x: -0.12, y: -0.06,
      text: 'a compact rotation representation without gimbal lock' },
    { id: 'ros', title: 'ROS tutorials', guide: 'vision-robotics', x: 0.24, y: 0.22,
      text: 'nodes topics and services in the robot operating system' }
  ];

  var CORPUS_BY_ID = {};
  CORPUS.forEach(function (d) { CORPUS_BY_ID[d.id] = d; });

  var GUIDE_LABELS = {
    'llm-training': 'LLM training',
    'llm-serving': 'LLM serving',
    'llm-apps': 'Applications',
    'math': 'Math',
    'vision-robotics': 'Vision & robotics'
  };

  // -------------------------------------------------------------------------
  // Toy tokenizer + context-window accounting
  // -------------------------------------------------------------------------

  var SUFFIXES = ['ization', 'ations', 'ation', 'ingly', 'ments', 'ement', 'ness', 'ment',
    'able', 'ible', 'tion', 'sion', 'ings', 'ers', 'ing', 'est', 'ies', 'ed', 'ly', 'es', 's'];

  // Split a long word into a stem and a marked continuation piece, so the
  // returned tokens look like a word-piece tokenizer's output (token + ##ization).
  function splitWord(w) {
    for (var i = 0; i < SUFFIXES.length; i++) {
      var suf = SUFFIXES[i];
      if (w.length > suf.length + 2 && w.slice(-suf.length) === suf) {
        var stem = w.slice(0, w.length - suf.length);
        return [stem, '##' + suf];
      }
    }
    var out = [], j = 0;
    while (j < w.length) { out.push(j === 0 ? w.slice(0, 4) : '##' + w.slice(j, j + 4)); j += 4; }
    if (out.length > 1 && out[out.length - 1].length < 4) {
      out[out.length - 2] += out[out.length - 1].replace(/^##/, '');
      out.pop();
    }
    return out;
  }

  // Tokenize text into word-piece-like tokens. Numbers and short words stay whole.
  function tokenize(text) {
    var words = String(text == null ? '' : text).match(/[A-Za-z0-9']+|[^\sA-Za-z0-9']/g) || [];
    var out = [];
    words.forEach(function (w) {
      var lower = w.toLowerCase();
      if (lower.length <= 6 || /^[0-9']+$/.test(lower) || /^[^A-Za-z0-9']$/.test(lower)) { out.push(w); return; }
      splitWord(lower).forEach(function (p) { out.push(p); });
    });
    return out;
  }

  function countTokens(text) { return tokenize(text).length; }

  // Lexical terms for BM25: lowercase words, simple suffix stripping, no stopwords
  // beyond the most common function words.
  var STOPWORDS = { a: 1, an: 1, the: 1, of: 1, to: 1, and: 1, or: 1, in: 1, on: 1, at: 1,
    is: 1, are: 1, it: 1, its: 1, as: 1, by: 1, for: 1, with: 1, that: 1, this: 1, be: 1 };
  function terms(text) {
    var words = String(text == null ? '' : text).toLowerCase().match(/[a-z0-9]+/g) || [];
    var out = [];
    words.forEach(function (w) {
      if (STOPWORDS[w]) return;
      if (w.length > 4) {
        ['ization', 'ations', 'ation', 'ness', 'ment', 'able', 'ible', 'tion', 'sion', 'ing', 'ies', 'ed', 'ly', 'es', 's']
          .some(function (suf) {
            if (w.length > suf.length + 2 && w.slice(-suf.length) === suf) { w = w.slice(0, w.length - suf.length); return true; }
            return false;
          });
      }
      if (w) out.push(w);
    });
    return out;
  }

  // Context-window budget. opts:
  //   window    total context window in tokens
  //   segments  [{name, text} | {name, tokens}] in prompt order
  //   reserveOutput  tokens reserved for the completion (default 0)
  // Returns {used, budget, remaining, overflow, breakdown, share}.
  function ctxBudget(opts) {
    opts = opts || {};
    var window = opts.window == null ? 128000 : opts.window;
    var reserve = opts.reserveOutput || 0;
    var budget = Math.max(0, window - reserve);
    var breakdown = (opts.segments || []).map(function (s) {
      var t = s.tokens != null ? s.tokens : countTokens(s.text);
      return { name: s.name, tokens: t };
    });
    var used = breakdown.reduce(function (a, b) { return a + b.tokens; }, 0);
    breakdown.forEach(function (b) { b.share = used ? b.tokens / used : 0; });
    return {
      used: used, budget: budget, window: window, reserveOutput: reserve,
      remaining: budget - used, overflow: Math.max(0, used - budget),
      over: used > budget, breakdown: breakdown
    };
  }

  // -------------------------------------------------------------------------
  // Similarity, BM25, fusion, reranking
  // -------------------------------------------------------------------------

  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + (a[2] || 0) * (b[2] || 0); }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function cosine(a, b) {
    var na = norm(a), nb = norm(b);
    if (!na || !nb) return 0;
    return dot(a, b) / (na * nb);
  }
  function dist(a, b) {
    var dx = (a.x != null ? a.x : a[0]) - (b.x != null ? b.x : b[0]);
    var dy = (a.y != null ? a.y : a[1]) - (b.y != null ? b.y : b[1]);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function docTerms(doc) {
    if (Array.isArray(doc)) return doc;
    if (doc && doc.tokens) return doc.tokens;
    if (doc && doc._t == null) doc._t = terms(doc.text || '');
    return doc._t;
  }
  function docId(doc, i) { return doc && doc.id != null ? doc.id : (Array.isArray(doc) ? i : i); }

  // BM25 over docs (array of {id,text}|{id,tokens}|string). Returns [{id,score}]
  // sorted descending. k1 and b are the standard free parameters.
  function bm25(docs, query, opts) {
    opts = opts || {};
    var k1 = opts.k1 == null ? 1.2 : opts.k1;
    var b = opts.b == null ? 0.75 : opts.b;
    var q = Array.isArray(query) ? query.slice() : terms(query);
    var tok = docs.map(function (d) { return docTerms(d); });
    var N = docs.length;
    var dl = tok.map(function (t) { return t.length; });
    var avgdl = dl.reduce(function (a, c) { return a + c; }, 0) / Math.max(1, N);
    var df = {};
    tok.forEach(function (t) {
      var seen = {};
      t.forEach(function (x) { if (!seen[x]) { seen[x] = 1; df[x] = (df[x] || 0) + 1; } });
    });
    var scores = tok.map(function (t, i) {
      var tf = {};
      t.forEach(function (x) { tf[x] = (tf[x] || 0) + 1; });
      var s = 0;
      q.forEach(function (term) {
        var f = tf[term] || 0;
        if (!f) return;
        var n = df[term] || 0;
        var idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl[i] / Math.max(1e-9, avgdl)));
      });
      return { id: docId(docs[i], i), score: s };
    });
    scores.sort(function (x, y) { return y.score - x.score; });
    return scores;
  }

  // Reciprocal rank fusion of several ranked id lists. score(d) = Σ 1/(k + rank).
  function rrf(rankings, k) {
    k = k == null ? 60 : k;
    var acc = {};
    rankings.forEach(function (list) {
      (list || []).forEach(function (id, rank) {
        acc[id] = (acc[id] || 0) + 1 / (k + rank + 1);
      });
    });
    var out = Object.keys(acc).map(function (id) { return { id: id, score: acc[id] }; });
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  // A query's position in the 2-D semantic space: the BM25-weighted centroid of
  // the documents it matches. Ties the lexical view to the vector view so a demo
  // can move between them without a second, unrelated embedding.
  function queryVector(query, corpus) {
    var docs = corpus || CORPUS;
    var scored = bm25(docs, query, {});
    var max = scored.reduce(function (m, s) { return Math.max(m, s.score); }, 0) || 1;
    var sx = 0, sy = 0, w = 0;
    scored.forEach(function (s) {
      var d = CORPUS_BY_ID[s.id];
      if (!d) return;
      var wt = Math.max(0, s.score) / max;
      sx += wt * d.x; sy += wt * d.y; w += wt;
    });
    if (!w) return { x: 0, y: 0 };
    return { x: sx / w, y: sy / w };
  }

  // Mock cross-encoder reranker: a weighted blend of lexical overlap, title
  // match and semantic proximity. Deterministic; the weights are the lesson.
  function rerank(query, candidates, opts) {
    opts = opts || {};
    var wl = opts.wLexical == null ? 0.5 : opts.wLexical;
    var wt = opts.wTitle == null ? 0.2 : opts.wTitle;
    var wv = opts.wVector == null ? 0.3 : opts.wVector;
    var q = terms(query);
    var qv = queryVector(query, opts.corpus || CORPUS);
    var out = candidates.map(function (c) {
      var doc = typeof c === 'string' ? CORPUS_BY_ID[c] : c;
      if (!doc) return { id: typeof c === 'string' ? c : c.id, score: 0 };
      var t = docTerms(doc);
      var overlap = 0;
      q.forEach(function (term) {
        if (t.indexOf(term) >= 0) overlap++;
      });
      var lex = q.length ? overlap / q.length : 0;
      var title = q.filter(function (term) { return terms(doc.title || '').indexOf(term) >= 0; }).length /
        Math.max(1, q.length);
      var vec = cosine([qv.x, qv.y], [doc.x, doc.y]);
      return { id: doc.id, score: wl * lex + wt * title + wv * vec, lexical: lex, title: title, vector: vec };
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  // Full hybrid retrieval pipeline: lexical + vector, fused with RRF, reranked.
  // Returns each stage so a page can show the pipeline rather than just the result.
  function hybridRetrieve(query, opts) {
    opts = opts || {};
    var docs = opts.corpus || CORPUS;
    var lex = bm25(docs, query, opts);
    var qv = queryVector(query, docs);
    var vec = docs.map(function (d) { return { id: d.id, score: cosine([qv.x, qv.y], [d.x, d.y]) }; })
      .sort(function (a, b) { return b.score - a.score; });
    var fused = rrf([lex.map(function (e) { return e.id; }), vec.map(function (e) { return e.id; })], opts.rrfK);
    var wide = opts.wide == null ? 10 : opts.wide;
    var candidates = fused.slice(0, wide).map(function (e) { return CORPUS_BY_ID[e.id]; }).filter(Boolean);
    var narrow = opts.narrow == null ? 5 : opts.narrow;
    return {
      query: query,
      lexical: lex.slice(0, wide),
      vector: vec.slice(0, wide),
      fused: fused.slice(0, wide),
      candidates: candidates.map(function (d) { return d.id; }),
      reranked: rerank(query, candidates, opts).slice(0, narrow),
      queryVector: qv
    };
  }

  // -------------------------------------------------------------------------
  // Chunking
  // -------------------------------------------------------------------------

  function sentences(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]*/g) || [];
  }

  // chunk(text, size, overlap, strategy) →
  //   [{index, text, start, end, parent?, similarity?}]
  // strategies: fixed | recursive | semantic | parent
  function chunk(text, size, overlap, strategy) {
    text = String(text == null ? '' : text);
    size = size == null ? 120 : size;
    overlap = overlap == null ? 0 : overlap;
    strategy = strategy || 'fixed';
    var out = [];

    if (strategy === 'fixed') {
      var step = Math.max(1, size - overlap);
      for (var s = 0; s < text.length; s += step) {
        out.push({ index: out.length, start: s, end: Math.min(text.length, s + size), text: text.slice(s, s + size) });
        if (s + size >= text.length) break;
      }
      return out;
    }

    var sents = sentences(text);
    if (strategy === 'recursive') {
      var cur = '', startPos = 0;
      sents.forEach(function (sn) {
        if (cur && cur.length + sn.length + 1 > size) {
          out.push({ index: out.length, text: cur.trim(), start: startPos, end: startPos + cur.length });
          startPos += cur.length;
          cur = '';
        }
        cur += (cur ? ' ' : '') + sn;
      });
      if (cur.trim()) out.push({ index: out.length, text: cur.trim(), start: startPos, end: startPos + cur.length });
      return out;
    }

    if (strategy === 'semantic') {
      var group = [], prevT = null, pos = 0;
      sents.forEach(function (sn) {
        var t = terms(sn);
        var j = prevT ? jaccard(prevT, t) : 1;
        if (group.length && j < 0.12) {
          out.push({ index: out.length, text: group.join(' '), start: pos, end: pos + group.join(' ').length, similarity: j });
          pos += group.join(' ').length + 1;
          group = [];
        }
        group.push(sn.trim());
        prevT = t;
      });
      if (group.length) out.push({ index: out.length, text: group.join(' '), start: pos, end: pos + group.join(' ').length });
      return out;
    }

    // parent: a child list plus the whole document as each child's parent.
    var children = chunk(text, size, overlap, 'recursive');
    children.forEach(function (c) { c.parent = 0; });
    var parent = { index: children.length, start: 0, end: text.length, text: text, isParent: true };
    children.forEach(function (c) { c.parentText = parent.text; });
    return children.concat([parent]);
  }

  function jaccard(a, b) {
    if (!a.length || !b.length) return 0;
    var A = {}, inter = 0;
    a.forEach(function (x) { A[x] = 1; });
    b.forEach(function (x) { if (A[x]) inter++; });
    var union = {};
    a.concat(b).forEach(function (x) { union[x] = 1; });
    return inter / Object.keys(union).length;
  }

  // -------------------------------------------------------------------------
  // k-means (deterministic init) — shared by IVF/PQ
  // -------------------------------------------------------------------------

  function kmeans(points, k, seed, iters) {
    if (!points || !points.length) return { centroids: [], assign: [], inertia: 0 };
    k = Math.max(1, Math.min(k, points.length));
    iters = iters || 12;
    var centroids = [];
    // Deterministic k-means++-style seeding: first point, then farthest point.
    centroids.push([points[0].x, points[0].y]);
    while (centroids.length < k) {
      var best = null, bestD = -1;
      points.forEach(function (p) {
        var d = Math.min.apply(null, centroids.map(function (c) { return dist(p, { x: c[0], y: c[1] }); }));
        if (d > bestD) { bestD = d; best = p; }
      });
      centroids.push([best.x, best.y]);
    }
    var assign = new Array(points.length).fill(0);
    for (var it = 0; it < iters; it++) {
      var changed = false;
      points.forEach(function (p, i) {
        var bestI = 0, bd = Infinity;
        centroids.forEach(function (c, ci) {
          var d = dist(p, { x: c[0], y: c[1] });
          if (d < bd) { bd = d; bestI = ci; }
        });
        if (assign[i] !== bestI) { assign[i] = bestI; changed = true; }
      });
      var sums = centroids.map(function () { return { x: 0, y: 0, n: 0 }; });
      points.forEach(function (p, i) {
        var c = sums[assign[i]];
        c.x += p.x; c.y += p.y; c.n++;
      });
      sums.forEach(function (s, si) {
        if (s.n) centroids[si] = [s.x / s.n, s.y / s.n];
      });
      if (!changed && it > 0) break;
    }
    var inertia = 0;
    points.forEach(function (p, i) { inertia += Math.pow(dist(p, { x: centroids[assign[i]][0], y: centroids[assign[i]][1] }), 2); });
    return { centroids: centroids, assign: assign, inertia: inertia };
  }

  // -------------------------------------------------------------------------
  // IVF + product quantization (2-D corpus → Voronoi cells, probe sets, error)
  // -------------------------------------------------------------------------

  function ivfpq(points, opts) {
    opts = opts || {};
    var nlist = opts.nlist == null ? 8 : opts.nlist;
    var m = opts.m == null ? 2 : opts.m;         // subquantizers (2 coords)
    var nbits = opts.nbits == null ? 3 : opts.nbits;
    var seed = opts.seed == null ? 4 : opts.seed;
    var km = kmeans(points, nlist, seed, 14);
    var levels = Math.pow(2, nbits);
    var dims = m;
    // Per-list, per-subquantizer scalar codebooks over the residuals.
    var lists = [];
    for (var l = 0; l < nlist; l++) lists.push([]);
    points.forEach(function (p, i) { lists[km.assign[i]].push(i); });

    var codebooks = [];
    var reconstructed = new Array(points.length);
    var totalErr = 0;
    for (var li = 0; li < nlist; li++) {
      var ids = lists[li];
      var cen = km.centroids[li];
      var cb = [];
      for (var sub = 0; sub < m; sub++) {
        var dim = Math.min(sub, 1);
        var vals = ids.map(function (i) { return (dim === 0 ? points[i].x : points[i].y) - (dim === 0 ? cen[0] : cen[1]); });
        var book = scalarCodebook(vals, Math.min(levels, Math.max(1, ids.length)));
        cb.push(book);
      }
      codebooks.push(cb);
      ids.forEach(function (i) {
        var rx = cen[0], ry = cen[1];
        for (var sub2 = 0; sub2 < m; sub2++) {
          var dim2 = Math.min(sub2, 1);
          var v = dim2 === 0 ? points[i].x - cen[0] : points[i].y - cen[1];
          var q = nearest1d(cb[sub2], v);
          if (dim2 === 0) rx += q; else ry += q;
        }
        reconstructed[i] = { x: rx, y: ry };
        totalErr += Math.pow(points[i].x - rx, 2) + Math.pow(points[i].y - ry, 2);
      });
    }
    return {
      centroids: km.centroids, assign: km.assign, lists: lists, codebooks: codebooks,
      nlist: nlist, m: m, nbits: nbits, levels: levels,
      reconstructed: reconstructed, quantError: totalErr / Math.max(1, points.length)
    };
  }

  function scalarCodebook(vals, k) {
    if (!vals.length) return [0];
    k = Math.max(1, Math.min(k, vals.length));
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var book = [];
    for (var i = 0; i < k; i++) book.push(lo + (hi - lo) * (k === 1 ? 0.5 : i / (k - 1)));
    // A few Lloyd iterations for a better book.
    var assign = new Array(vals.length).fill(0);
    for (var it = 0; it < 10; it++) {
      vals.forEach(function (v, i) {
        var bi = 0, bd = Infinity;
        book.forEach(function (c, ci) { var d = Math.abs(v - c); if (d < bd) { bd = d; bi = ci; } });
        assign[i] = bi;
      });
      var sums = book.map(function () { return { s: 0, n: 0 }; });
      vals.forEach(function (v, i) { sums[assign[i]].s += v; sums[assign[i]].n++; });
      sums.forEach(function (s, si) { if (s.n) book[si] = s.s / s.n; });
    }
    return book;
  }
  function nearest1d(book, v) {
    var best = book[0], bd = Infinity;
    book.forEach(function (c) { var d = Math.abs(v - c); if (d < bd) { bd = d; best = c; } });
    return best;
  }

  // IVF search: probe `nprobe` nearest cells, scan them, return ordered results.
  function ivfSearch(index, query, nprobe) {
    nprobe = Math.max(1, Math.min(index.nlist, nprobe || 1));
    var scored = index.centroids.map(function (c, i) { return { list: i, d: dist(query, { x: c[0], y: c[1] }) }; });
    scored.sort(function (a, b) { return a.d - b.d; });
    var probed = scored.slice(0, nprobe).map(function (e) { return e.list; });
    var results = [];
    probed.forEach(function (li) {
      index.lists[li].forEach(function (pi) {
        results.push({ point: pi, d: dist(query, index.reconstructed[pi]) });
      });
    });
    results.sort(function (a, b) { return a.d - b.d; });
    return { probed: probed, results: results };
  }

  // -------------------------------------------------------------------------
  // HNSW — a real (small) hierarchical navigable small-world graph, so the
  // traversal can be animated. searchLayer is the standard greedy + ef search;
  // the search records the visited-node trace.
  // -------------------------------------------------------------------------

  function hnsw(points, M, efC, seed) {
    M = M == null ? 8 : M;
    efC = efC == null ? 50 : efC;
    seed = seed == null ? 3 : seed;
    var r = rng(seed);
    var mL = 1 / Math.log(M);
    var nodes = points.map(function (p, i) {
      var u = Math.max(1e-12, r());
      return { id: p.id != null ? p.id : i, idx: i, x: p.x, y: p.y, level: Math.floor(-Math.log(u) * mL) };
    });
    var byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });
    var maxLevel = 0;
    var adj = [];   // adj[layer][id] = [neighborId,...]
    function ensureLayer(l) { while (adj.length <= l) adj.push({}); }
    function link(layer, a, b) {
      ensureLayer(layer);
      (adj[layer][a] = adj[layer][a] || []).push(b);
      (adj[layer][b] = adj[layer][b] || []).push(a);
    }
    function prune(layer, a) {
      var arr = adj[layer][a] || [];
      if (arr.length <= M) return;
      arr.sort(function (x, y) { return dist(byId[x], byId[a]) - dist(byId[y], byId[a]); });
      adj[layer][a] = arr.slice(0, M);
    }

    function searchLayer(layer, query, entryIds, ef, trace) {
      ensureLayer(layer);
      var visited = {};
      var candidates = [], results = [];
      function dd(id) { return dist(query, byId[id]); }
      function pushSorted(arr, id) { arr.push(id); arr.sort(function (a, b) { return dd(a) - dd(b); }); }
      entryIds.forEach(function (id) {
        if (id == null || visited[id]) return;
        visited[id] = 1; if (trace) trace.push(id);
        candidates.push(id); pushSorted(results, id);
      });
      while (candidates.length) {
        var c = candidates.shift();
        var worst = results[results.length - 1];
        if (results.length >= ef && worst != null && dd(c) > dd(worst)) break;
        var neigh = (adj[layer][c] || []);
        for (var i = 0; i < neigh.length; i++) {
          var e = neigh[i];
          if (visited[e]) continue;
          visited[e] = 1; if (trace) trace.push(e);
          var d = dd(e);
          results.sort(function (a, b) { return dd(a) - dd(b); });
          var w = results[results.length - 1];
          if (results.length < ef || (w != null && d < dd(w))) {
            candidates.push(e); pushSorted(results, e);
            if (results.length > ef) results.pop();
          }
        }
      }
      results.sort(function (a, b) { return dd(a) - dd(b); });
      return results;
    }

    var entry = nodes.length ? nodes[0].id : null;
    nodes.forEach(function (node, i) {
      ensureLayer(node.level);
      for (var l = 0; l <= node.level; l++) { adj[l][node.id] = adj[l][node.id] || []; }
      if (i === 0) { entry = node.id; maxLevel = node.level; return; }
      var cur = [entry];
      for (var lc = maxLevel; lc > node.level; lc--) {
        var down = searchLayer(lc, node, cur, 1);
        if (down.length) cur = [down[0]];
      }
      for (var lc2 = Math.min(maxLevel, node.level); lc2 >= 0; lc2--) {
        var found = searchLayer(lc2, node, cur, efC);
        var neighbors = found.slice(0, M);
        neighbors.forEach(function (nb) { link(lc2, node.id, nb); });
        neighbors.forEach(function (nb) { prune(lc2, nb); });
        prune(lc2, node.id);
        if (found.length) cur = found;
      }
      if (node.level > maxLevel) { maxLevel = node.level; entry = node.id; }
    });

    ensureLayer(maxLevel);
    return {
      nodes: nodes, byId: byId, adj: adj, M: M, maxLevel: maxLevel, entry: entry, points: points,
      // Exposed so hnswSearch (and a page's animation) can replay a query.
      searchLayer: function (layer, query, entryIds, ef, trace) {
        return searchLayer(layer, query, entryIds, ef, trace);
      }
    };
  }

  function hnswSearch(index, query, efSearch) {
    efSearch = efSearch == null ? 10 : efSearch;
    var trace = [];
    var cur = [index.entry];
    var descents = [];
    for (var lc = index.maxLevel; lc > 0; lc--) {
      var before = trace.length;
      var res = index.searchLayer(lc, query, cur, 1, trace);
      descents.push({ layer: lc, visited: trace.slice(before) });
      if (res.length) cur = [res[0]];
    }
    var before0 = trace.length;
    var layer0 = index.searchLayer(0, query, cur, efSearch, trace);
    var brute = index.points.map(function (p) { return { id: p.id, d: dist(query, p) }; })
      .sort(function (a, b) { return a.d - b.d; });
    var found = layer0.length ? layer0[0] : null;
    var trueId = brute.length ? brute[0].id : null;
    return {
      result: found,
      resultDist: found != null ? dist(query, index.byId[found]) : null,
      trueNearest: trueId,
      foundTrue: found === trueId,
      visits: trace,
      visitsLayer0: trace.slice(before0),
      descents: descents,
      efSearch: efSearch, M: index.M
    };
  }

  // -------------------------------------------------------------------------
  // Agent trajectory generator (the context film strip)
  // -------------------------------------------------------------------------

  var AGENT_FACTS = [
    { id: 'f1', label: 'docs live under /ai/', salience: 0.9, learnAt: 3, needAt: [12, 27] },
    { id: 'f2', label: 'the eval harness runs five cases', salience: 0.7, learnAt: 6, needAt: [18, 33] },
    { id: 'f3', label: 'the corpus has sixty documents', salience: 0.4, learnAt: 9, needAt: [21, 36] },
    { id: 'f4', label: 'reranking cuts candidates to five', salience: 0.8, learnAt: 14, needAt: [24, 38] },
    { id: 'f5', label: 'the context window is 200k tokens', salience: 0.3, learnAt: 17, needAt: [29] },
    { id: 'f6', label: 'cache reads cost 10% of input', salience: 0.6, learnAt: 22, needAt: [31, 39] },
    { id: 'f7', label: 'the glossary is the appendix', salience: 0.35, learnAt: 26, needAt: [35] },
    { id: 'f8', label: 'the injection defense is capability-based', salience: 0.85, learnAt: 30, needAt: [37] }
  ];

  // agentRun(scenario, policy). scenario is a label; policy:
  //   compaction: 'none' | 'evict' | 'summarize' | 'notes'
  //   maxTokens, steps, seed
  function agentRun(scenario, policy) {
    policy = policy || {};
    var mode = policy.compaction || 'none';
    var maxTokens = policy.maxTokens == null ? 12000 : policy.maxTokens;
    var stepCount = policy.steps == null ? 40 : policy.steps;
    var factsById = {};
    AGENT_FACTS.forEach(function (f) { factsById[f.id] = f; });
    var inContext = {};          // factId -> true when currently visible
    var notes = {};              // structured notes survive compaction
    var history = [];            // [{tokens, facts:[id]}]
    var summaryTokens = 0;
    var steps = [];
    var drops = [], redos = [];

    function contextTotal(extra) {
      return 900 + 1400 + 260 + historyTokens() + Object.keys(inContext).length * 40 +
        summaryTokens + (notesCount() * 30) + (extra || 0);
    }
    function historyTokens() { return history.reduce(function (a, h) { return a + h.tokens; }, 0); }
    function notesCount() { return Object.keys(notes).length; }

    for (var i = 0; i < stepCount; i++) {
      var learnedNow = [];
      AGENT_FACTS.forEach(function (f) { if (f.learnAt === i) learnedNow.push(f.id); });
      learnedNow.forEach(function (fid) { inContext[fid] = true; notes[fid] = true; });

      var needed = AGENT_FACTS.filter(function (f) { return f.needAt.indexOf(i) >= 0; });
      var missing = needed.filter(function (f) { return !inContext[f.id] && !notes[f.id]; });
      var action = 'think';
      if (missing.length) {
        action = 'redo';
        missing.forEach(function (f) {
          inContext[f.id] = true; notes[f.id] = true;
          redos.push({ fact: f.id, label: f.label, step: i });
        });
      } else if (needed.length) { action = 'use'; }
      else if (learnedNow.length) { action = 'tool'; }
      else if (i > 0 && i % 7 === 0) { action = 'tool'; }
      else if (i === stepCount - 1) { action = 'answer'; }

      var retrieved = (action === 'tool' || action === 'redo') ? 1800 : 0;
      var turnTokens = 300 + ((action === 'tool' || action === 'redo') ? 900 : 180);

      // Append this turn, then compact if over budget.
      history.push({ tokens: turnTokens, facts: learnedNow.slice() });

      if (mode !== 'none') {
        var guard = 0;
        while (contextTotal(retrieved) > maxTokens && history.length > 1 && guard++ < 1000) {
          var h = history.shift();
          h.facts.forEach(function (fid) {
            if (mode === 'notes') { notes[fid] = true; return; }          // survives in notes
            if (mode === 'summarize' && factsById[fid].salience >= 0.5) { notes[fid] = true; return; }
            delete inContext[fid]; delete notes[fid];
            drops.push({ fact: fid, label: factsById[fid].label, step: i });
          });
          if (mode === 'summarize') summaryTokens += 40;
        }
      }

      steps.push({
        i: i, action: action,
        learned: learnedNow,
        needed: needed.map(function (f) { return f.id; }),
        factsInContext: Object.keys(inContext).length,
        segments: [
          { name: 'system', tokens: 900 },
          { name: 'tools', tokens: 1400 },
          { name: 'task', tokens: 260 },
          { name: 'history', tokens: historyTokens() },
          { name: 'summary', tokens: summaryTokens },
          { name: 'facts', tokens: Object.keys(inContext).length * 40 },
          { name: 'notes', tokens: notesCount() * 30 },
          { name: 'retrieved', tokens: retrieved }
        ],
        total: contextTotal(retrieved),
        overflow: Math.max(0, contextTotal(retrieved) - maxTokens)
      });
    }

    return {
      scenario: scenario || 'docs-assistant', policy: { compaction: mode, maxTokens: maxTokens, steps: stepCount },
      steps: steps, drops: drops, redos: redos,
      facts: AGENT_FACTS.map(function (f) { return { id: f.id, label: f.label, salience: f.salience, learnAt: f.learnAt, needAt: f.needAt }; }),
      maxTotal: steps.reduce(function (m, s) { return Math.max(m, s.total); }, 0),
      overflows: steps.filter(function (s) { return s.overflow > 0; }).length
    };
  }

  // -------------------------------------------------------------------------
  // Judge bias playground
  // -------------------------------------------------------------------------

  function judgeScore(cand, isFirst, b) {
    var s = (cand.correct ? 1 : 0);
    // Verbosity is *not* clamped: the point of the playground is that a strong
    // enough length preference can outweigh being wrong.
    s += (b.verbosity || 0) * ((cand.length || 0) / (b.lengthScale || 400));
    s += (b.position || 0) * (isFirst ? 0.5 : 0);
    s += (b.self || 0) * (cand.selfAuthored ? 0.5 : 0);
    return s;
  }

  // judge(a, b, biases) → scores, the order-as-shown verdict, the swapped verdict,
  // and the order-averaged verdict. biases: {position, verbosity, self, lengthScale}.
  function judge(a, b, biases) {
    var b0 = biases || {};
    var sA = judgeScore(a, true, b0), sB = judgeScore(b, false, b0);
    var sA2 = judgeScore(a, false, b0), sB2 = judgeScore(b, true, b0);
    function w(x, y) { return x === y ? 'tie' : (x > y ? 'a' : 'b'); }
    return {
      shown: { a: sA, b: sB, winner: w(sA, sB) },
      swapped: { a: sA2, b: sB2, winner: w(sA2, sB2) },
      averaged: { a: (sA + sA2) / 2, b: (sB + sB2) / 2, winner: w((sA + sA2) / 2, (sB + sB2) / 2) }
    };
  }

  function cohenKappa(pred, labels) {
    var n = Math.min(pred.length, labels.length);
    if (!n) return 0;
    var agree = 0, pA = 0, pB = 0;
    for (var i = 0; i < n; i++) {
      if (pred[i] === labels[i]) agree++;
      pA += pred[i] ? 1 : 0; pB += labels[i] ? 1 : 0;
    }
    var po = agree / n;
    var pe = (pA / n) * (pB / n) + (1 - pA / n) * (1 - pB / n);
    return pe === 1 ? 1 : (po - pe) / (1 - pe);
  }

  // -------------------------------------------------------------------------
  // Cost, latency, caching
  // -------------------------------------------------------------------------

  function costModel(opts) {
    opts = opts || {};
    var p = opts.prices || { inputPerM: 3, outputPerM: 15, cachedPerM: 0.3 };
    var input = opts.inputTokens || 0;
    var cached = Math.min(opts.cachedInputTokens || 0, input);
    var uncached = Math.max(0, input - cached);
    var output = (opts.outputTokens || 0) + (opts.reasoningTokens || 0);
    var inputCost = uncached / 1e6 * p.inputPerM;
    var cachedCost = cached / 1e6 * p.cachedPerM;
    var outputCost = output / 1e6 * p.outputPerM;
    var perCall = inputCost + cachedCost + outputCost;
    var calls = opts.calls || 1;
    var effectiveCalls = calls * (1 + (opts.retryRate || 0));
    return {
      inputCost: inputCost, cachedCost: cachedCost, outputCost: outputCost,
      perCall: perCall, total: perCall * effectiveCalls,
      effectiveCalls: effectiveCalls,
      cacheSavings: cached / 1e6 * (p.inputPerM - p.cachedPerM),
      outputShare: perCall ? outputCost / perCall : 0,
      inputShare: perCall ? (inputCost + cachedCost) / perCall : 0
    };
  }

  function latencyModel(opts) {
    opts = opts || {};
    var prefix = opts.prefixTokens || 0;
    var cached = Math.min(opts.cachedPrefixTokens || 0, prefix);
    var uncached = prefix - cached;
    var prefillMs = uncached / (opts.prefillTps || 20000) * 1000;
    var ttft = (opts.ttftBaseMs == null ? 40 : opts.ttftBaseMs) + (opts.queueMs || 0) + prefillMs;
    var tpot = opts.tpotMs == null ? 25 : opts.tpotMs;
    var output = opts.outputTokens == null ? 200 : opts.outputTokens;
    return {
      ttftMs: ttft, tpotMs: tpot, e2eMs: ttft + output * tpot,
      prefillMs: prefillMs, uncachedTokens: uncached,
      cachedFraction: prefix ? cached / prefix : 0
    };
  }

  // Prefix cache over block sequences, plus a semantic-cache mode that can return
  // a wrong answer. requests: [{id, blocks:[str], cluster?, paraphrase?}].
  // policy: {type:'prefix'|'semantic', capacityBlocks, ttl, wrongAnswerRate, seed}.
  function cacheSim(requests, policy) {
    policy = policy || {};
    var type = policy.type || 'prefix';
    var capacity = policy.capacityBlocks == null ? 64 : policy.capacityBlocks;
    var ttl = policy.ttl == null ? 1e9 : policy.ttl;
    var wrongRate = policy.wrongAnswerRate == null ? 0 : policy.wrongAnswerRate;
    var r = rng(policy.seed == null ? 9 : policy.seed);

    var perRequest = [];
    var hits = 0, wrong = 0, reusedTokens = 0, totalTokens = 0;

    if (type === 'prefix') {
      var cache = new Map();       // block -> lastUsedIndex
      var clock = 0;
      requests.forEach(function (req) {
        var blocks = req.blocks || [];
        totalTokens += blocks.length;
        var matched = 0;
        for (var i = 0; i < blocks.length; i++) {
          if (cache.has(blocks[i])) matched++; else break;
        }
        var hit = matched > 0;
        if (hit) { hits++; reusedTokens += matched; }
        // Insert/refresh all blocks; LRU-evict beyond capacity.
        blocks.forEach(function (bl) { cache.set(bl, clock); });
        clock++;
        while (cache.size > capacity) {
          var oldest = null, oldestT = Infinity;
          cache.forEach(function (t, bl) { if (t < oldestT) { oldestT = t; oldest = bl; } });
          cache.delete(oldest);
        }
        perRequest.push({ id: req.id, hit: hit, matchedBlocks: matched, blocks: blocks.length });
      });
      return {
        type: type, hits: hits, total: requests.length, hitRate: requests.length ? hits / requests.length : 0,
        reusedTokens: reusedTokens, totalTokens: totalTokens,
        tokenHitRate: totalTokens ? reusedTokens / totalTokens : 0,
        wrongAnswers: 0, perRequest: perRequest
      };
    }

    // semantic: exact repeat or a paraphrase hit; near-miss clusters can be wrong.
    var lastSeen = {};   // cluster -> index
    requests.forEach(function (req) {
      var idx = perRequest.length;
      var key = 'c' + req.cluster;
      var prev = lastSeen[key];
      var fresh = prev == null || (idx - prev) > ttl;
      var hit = !fresh;
      var isWrong = false;
      if (hit) {
        hits++;
        if (req.paraphrase === false) { isWrong = r() < wrongRate; if (isWrong) wrong++; }
      }
      lastSeen[key] = idx;
      perRequest.push({ id: req.id, hit: hit, wrong: isWrong, cluster: req.cluster });
    });
    return {
      type: type, hits: hits, total: requests.length, hitRate: requests.length ? hits / requests.length : 0,
      reusedTokens: 0, totalTokens: requests.length, tokenHitRate: requests.length ? hits / requests.length : 0,
      wrongAnswers: wrong, perRequest: perRequest
    };
  }

  // -------------------------------------------------------------------------
  // Prompt-injection sandbox
  // -------------------------------------------------------------------------

  var INJECTION_ATTACKS = [
    { id: 'direct-override', label: 'Direct override', desc: '"Ignore previous instructions and ..." in the user turn.' },
    { id: 'indirect-document', label: 'Poisoned document', desc: 'Instruction hidden inside a retrieved document.' },
    { id: 'encoded-payload', label: 'Encoded payload', desc: 'Base64 or rot13 instruction that decodes at runtime.' },
    { id: 'tool-result', label: 'Tool-result injection', desc: 'Instruction returned by an otherwise trusted tool.' },
    { id: 'exfil-image', label: 'Markdown-image exfiltration', desc: 'Secret smuggled out in an image URL.' },
    { id: 'exfil-http', label: 'Outbound HTTP exfiltration', desc: 'Agent posts private data to an attacker endpoint.' },
    { id: 'sleeper', label: 'Multi-turn sleeper', desc: 'Benign-looking instruction activated many turns later.' },
    { id: 'homoglyph', label: 'Unicode homoglyph', desc: 'Lookalike characters that slip past keyword filters.' }
  ];

  var INJECTION_DEFENSES = [
    { id: 'none', label: 'No defense', note: 'The naive agent: untrusted text and tools in one context.' },
    { id: 'prompt-hardening', label: 'Prompt hardening', note: 'System prompt tells the model to ignore untrusted instructions.' },
    { id: 'rails', label: 'Rails / classifiers', note: 'Input and output classifiers flag known payloads and exfil channels.' },
    { id: 'dual-llm', label: 'Dual-LLM quarantine', note: 'A quarantined model reads untrusted content and returns only structured data.' },
    { id: 'least-privilege', label: 'Least privilege', note: 'No private data in the same context as untrusted content; no network tool.' },
    { id: 'capability', label: 'Capability information flow', note: 'Capability tokens decide which values may influence which actions, independent of text.' }
  ];

  var INJECTION_STOPS = {
    none: [],
    'prompt-hardening': ['direct-override'],
    rails: ['direct-override', 'encoded-payload', 'homoglyph', 'exfil-image', 'exfil-http'],
    'dual-llm': ['indirect-document', 'tool-result', 'sleeper'],
    'least-privilege': ['indirect-document', 'tool-result', 'sleeper', 'exfil-image', 'exfil-http'],
    capability: ['indirect-document', 'encoded-payload', 'tool-result', 'exfil-image', 'exfil-http', 'sleeper', 'homoglyph']
  };

  function injectionSim(defense, attack) {
    var stops = INJECTION_STOPS[defense] || [];
    var stopped = stops.indexOf(attack) >= 0;
    var def = INJECTION_DEFENSES.filter(function (d) { return d.id === defense; })[0] || { id: defense };
    return {
      defense: defense, attack: attack, stopped: stopped,
      reason: stopped ? (def.label + ' stops this variant.') : (def.label + ' does not stop this variant.'),
      caveat: defense === 'capability' && attack === 'direct-override'
        ? 'A user who themselves authorises the action is not an injection; capability control governs untrusted influence, not authorised intent.'
        : null
    };
  }

  function injectionMatrix() {
    return INJECTION_DEFENSES.map(function (d) {
      return {
        defense: d.id, label: d.label, note: d.note,
        stops: INJECTION_ATTACKS.map(function (a) { return { attack: a.id, stopped: (INJECTION_STOPS[d.id] || []).indexOf(a.id) >= 0 }; }),
        score: (INJECTION_STOPS[d.id] || []).length
      };
    });
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  global.AppSim = {
    rng: rng, gaussian: gaussian,
    CORPUS: CORPUS, CORPUS_BY_ID: CORPUS_BY_ID, GUIDE_LABELS: GUIDE_LABELS,
    tokenize: tokenize, countTokens: countTokens, terms: terms, ctxBudget: ctxBudget,
    cosine: cosine, dot: dot, norm: norm, dist: dist,
    bm25: bm25, rrf: rrf, rerank: rerank, hybridRetrieve: hybridRetrieve,
    queryVector: queryVector, chunk: chunk,
    kmeans: kmeans, ivfpq: ivfpq, ivfSearch: ivfSearch,
    hnsw: hnsw, hnswSearch: hnswSearch,
    agentRun: agentRun, AGENT_FACTS: AGENT_FACTS,
    judge: judge, cohenKappa: cohenKappa,
    costModel: costModel, latencyModel: latencyModel, cacheSim: cacheSim,
    injectionSim: injectionSim, injectionMatrix: injectionMatrix,
    INJECTION_ATTACKS: INJECTION_ATTACKS, INJECTION_DEFENSES: INJECTION_DEFENSES
  };
})(typeof window !== 'undefined' ? window : this);
