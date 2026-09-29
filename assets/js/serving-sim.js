/* serving-sim.js — the domain-specific discrete-event request simulator shared by
 * the LLM Serving guide. Loaded only by pages in /ai/llm-serving/ (after
 * guide-core.js). Everything here steps in *engine iterations*, not wall-clock
 * frames, so a run is reproducible, cheap enough to execute synchronously on every
 * slider input, and still animatable by replaying the returned timeline through
 * Guide.loop({interval}).
 *
 * Exposes window.ServingSim. No dependency on Guide except by convention (pages
 * pass Guide.colors() output into the draw helpers). */
(function (global) {
  "use strict";

  // ---- random -------------------------------------------------------------
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // Box-Muller standard normal from a uniform source.
  function gaussian(r) {
    var u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Log-normal with a given arithmetic mean and coefficient of variation.
  function lognormal(r, mean, cv) {
    cv = cv == null ? 0.6 : cv;
    mean = Math.max(1e-6, mean);
    var varN = (cv * mean) * (cv * mean);
    var mu = Math.log(mean * mean / Math.sqrt(mean * mean + varN));
    var sigma = Math.sqrt(Math.log(1 + varN / (mean * mean)));
    return Math.max(1, Math.round(Math.exp(mu + sigma * gaussian(r))));
  }

  // ---- workload -----------------------------------------------------------
  // Returns {requests:[{id, arrival, promptLen, outputLen}], horizon}. Arrivals are
  // a Poisson process at `rate` requests/second; lengths are log-normal.
  function workload(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 7 : opts.seed;
    var rate = opts.rate == null ? 2 : opts.rate;
    var promptMean = opts.promptMean == null ? 512 : opts.promptMean;
    var promptCV = opts.promptCV == null ? 0.7 : opts.promptCV;
    var decodeMean = opts.decodeMean == null ? 200 : opts.decodeMean;
    var decodeCV = opts.decodeCV == null ? 0.8 : opts.decodeCV;
    var horizon = opts.horizon == null ? 30000 : opts.horizon;

    var r = rng(seed);
    var requests = [];
    var t = 0;
    var id = 0;
    while (t < horizon) {
      t += -Math.log(1 - r()) / Math.max(1e-6, rate) * 1000; // seconds -> ms
      if (t >= horizon) break;
      requests.push({
        id: id++,
        arrival: t,
        promptLen: lognormal(r, promptMean, promptCV),
        outputLen: lognormal(r, decodeMean, decodeCV)
      });
    }
    return { requests: requests, horizon: horizon };
  }

  // ---- scheduling policies ------------------------------------------------
  function orderWaiting(waiting, policy, nowMs) {
    var arr = waiting.slice();
    if (policy === 'sjf' || policy === 'srpt') {
      // Shortest remaining processing time: prefer short prompts, and among those
      // the ones closest to finishing.
      arr.sort(function (a, b) {
        var ra = a.promptLen - a.prefilled + a.outputLen * 0.15;
        var rb = b.promptLen - b.prefilled + b.outputLen * 0.15;
        return ra - rb;
      });
    } else if (policy === 'priority') {
      arr.sort(function (a, b) {
        if (a.priority !== b.priority) return a.priority - b.priority; // 0 = high
        return a.arrival - b.arrival;
      });
    } else if (policy === 'aging') {
      // FCFS with aging: a request's effective age grows the longer it waits.
      arr.sort(function (a, b) {
        var ageA = (nowMs - a.arrival) / 1000 - a.priority * 1000;
        var ageB = (nowMs - b.arrival) / 1000 - b.priority * 1000;
        return ageB - ageA;
      });
    } else {
      arr.sort(function (a, b) { return a.arrival - b.arrival; }); // fcfs
    }
    return arr;
  }

  // ---- the engine ---------------------------------------------------------
  // run({requests, policy, capacity, kvBlocks, blockSize, chunkedPrefill,
  //      prefillTokBudget, stepMs, preempt, horizon, seed})
  //   capacity        max sequences resident (max_num_seqs)
  //   kvBlocks*blockSize  total KV token slots
  //   chunkedPrefill  bool — split a long prefill across iterations
  //   prefillTokBudget  max prefill tokens processed per iteration (chunk)
  //   preempt         'none' | 'recompute' | 'swap'
  function run(opts) {
    opts = opts || {};
    var reqs = opts.requests || [];
    var policy = opts.policy || 'fcfs';
    var capacity = opts.capacity == null ? 32 : opts.capacity;
    var kvTokens = (opts.kvBlocks == null ? 4096 : opts.kvBlocks) * (opts.blockSize == null ? 16 : opts.blockSize);
    var chunked = opts.chunkedPrefill !== false;
    var prefillTokBudget = opts.prefillTokBudget == null ? 2048 : opts.prefillTokBudget;
    var stepMs = opts.stepMs == null ? 20 : opts.stepMs;
    var preempt = opts.preempt || 'recompute';
    var horizon = opts.horizon == null ? 30000 : opts.horizon;
    var overheadMs = opts.overheadMs || 0;

    var waiting = [];
    var running = [];
    var finished = [];
    var events = [];
    var perReq = {};
    var now = 0;
    var maxIter = 200000;
    var iter = 0;

    reqs.forEach(function (q, i) {
      var pr = {
        id: q.id != null ? q.id : i,
        arrival: q.arrival,
        promptLen: Math.max(1, q.promptLen || 1),
        outputLen: Math.max(1, q.outputLen || 1),
        priority: q.priority == null ? 1 : q.priority,
        prefilled: 0, decoded: 0, state: 'waiting',
        admittedAt: null, firstTokenAt: null, completion: null,
        preemptions: 0, segments: []
      };
      perReq[pr.id] = pr;
      waiting.push(pr);
    });

    function usedTokens() {
      var s = 0;
      running.forEach(function (pr) {
        s += (pr.prefilled >= pr.promptLen ? pr.promptLen + pr.decoded : pr.prefilled);
      });
      return s;
    }

    function startSegment(pr, type, t) {
      pr._seg = { type: type, start: t, end: t };
      pr.segments.push(pr._seg);
    }
    function endSegment(pr, t) {
      if (pr._seg) { pr._seg.end = t; pr._seg = null; }
    }

    while ((waiting.length || running.length) && now < horizon * 4 && iter < maxIter) {
      iter++;
      // If nothing is resident, jump to the next arrival rather than spinning.
      if (!running.length && waiting.length) {
        var nextArrival = waiting.reduce(function (a, b) { return Math.min(a, b.arrival); }, Infinity);
        if (nextArrival > now) now = nextArrival;
      }
      var iterStart = now;

      // 1. Release finished decoders.
      for (var i = running.length - 1; i >= 0; i--) {
        var pr = running[i];
        if (pr.decoded >= pr.outputLen) {
          pr.state = 'done'; pr.completion = iterStart;
          endSegment(pr, iterStart);
          events.push({ reqId: pr.id, type: 'done', t: iterStart });
          finished.push(pr); running.splice(i, 1);
        }
      }

      // 2. Admit from the waiting queue while capacity and KV allow.
      var ordered = orderWaiting(waiting, policy, iterStart);
      for (var w = 0; w < ordered.length; w++) {
        if (running.length >= capacity) break;
        var cand = ordered[w];
        if (cand.arrival > iterStart) continue; // not here yet
        if (usedTokens() + cand.promptLen > kvTokens && running.length > 0) {
          if (preempt === 'none') continue;
          // Preempt the largest resident request to make room (recompute/swap).
          var victim = running.reduce(function (a, b) { return (a.promptLen + a.decoded > b.promptLen + b.decoded) ? a : b; });
          endSegment(victim, iterStart);
          victim.state = 'preempted';
          victim.preemptions++;
          events.push({ reqId: victim.id, type: 'preempted', t: iterStart });
          if (preempt === 'swap') {
            startSegment(victim, 'swap', iterStart);
            endSegment(victim, iterStart + 1);
          } else {
            victim.prefilled = 0; victim.decoded = 0;
          }
          running.splice(running.indexOf(victim), 1);
          waiting.push(victim);
          continue;
        }
        // Admit.
        var idx = waiting.indexOf(cand);
        waiting.splice(idx, 1);
        cand.state = 'running';
        cand.admittedAt = iterStart;
        events.push({ reqId: cand.id, type: 'admit', t: iterStart });
        running.push(cand);
      }

      // 3. Prefill: newest admitted first (or by arrival for FCFS-ish fairness).
      var prefilling = running.filter(function (p) { return p.prefilled < p.promptLen; });
      var budget = chunked ? prefillTokBudget : Infinity;
      for (var p = 0; p < prefilling.length && budget > 0; p++) {
        var sq = prefilling[p];
        var remaining = sq.promptLen - sq.prefilled;
        var take = chunked ? Math.min(remaining, budget) : remaining;
        if (sq._seg && sq._seg.type !== 'prefill') endSegment(sq, iterStart);
        if (!sq._seg) startSegment(sq, 'prefill', iterStart);
        sq.prefilled += take;
        budget -= take;
        if (sq.prefilled >= sq.promptLen) {
          endSegment(sq, iterStart + 1);
          firstToken(sq, iterStart + 1);
        }
      }

      // 4. Decode: one token per running, fully-prefilled sequence.
      running.forEach(function (sq) {
        if (sq.prefilled < sq.promptLen) return;
        if (sq.decoded >= sq.outputLen) return;
        if (sq._seg && sq._seg.type !== 'decode') endSegment(sq, iterStart);
        if (!sq._seg) startSegment(sq, 'decode', iterStart);
        sq.decoded++;
      });

      now = iterStart + stepMs + overheadMs;
      running.forEach(function (sq) {
        if (sq.prefilled >= sq.promptLen && sq.decoded > 0 && sq._seg) sq._seg.end = now;
      });
    }

    function firstToken(pr, t) {
      if (pr.firstTokenAt == null) {
        pr.firstTokenAt = t;
        pr.ttft = t - pr.arrival;
      }
    }

    // Finalise per-request metrics.
    Object.keys(perReq).forEach(function (k) {
      var pr = perReq[k];
      if (pr.completion == null) pr.completion = now;
      pr.e2e = pr.completion - pr.arrival;
      pr.ttft = pr.ttft == null ? pr.e2e : pr.ttft;
      var decodeTime = pr.completion - (pr.firstTokenAt == null ? pr.completion : pr.firstTokenAt);
      pr.tpot = pr.outputLen > 1 ? decodeTime / (pr.outputLen - 1) : pr.ttft;
    });

    return { events: events, perReq: perReq, finished: finished, horizon: horizon, iterations: iter, stats: stats(perReq, finished, horizon) };
  }

  function stats(perReq, finished, horizon) {
    var ttfts = [], tpots = [], e2es = [];
    Object.keys(perReq).forEach(function (k) {
      var pr = perReq[k];
      ttfts.push(pr.ttft); tpots.push(pr.tpot); e2es.push(pr.e2e);
    });
    var decodeTokens = finished.reduce(function (a, pr) { return a + pr.outputLen; }, 0);
    return {
      count: ttfts.length,
      ttft: { p50: percentile(ttfts, 50), p90: percentile(ttfts, 90), p99: percentile(ttfts, 99) },
      tpot: { p50: percentile(tpots, 50), p90: percentile(tpots, 90), p99: percentile(tpots, 99) },
      e2e: { p50: percentile(e2es, 50), p99: percentile(e2es, 99) },
      throughput: decodeTokens / (horizon / 1000),
      completed: finished.length
    };
  }

  // ---- measures -----------------------------------------------------------
  function percentile(arr, p) {
    if (!arr || !arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var idx = (p / 100) * (a.length - 1);
    var lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return a[lo];
    return a[lo] + (a[hi] - a[lo]) * (idx - lo);
  }

  // Fraction (and rate) of requests meeting both latency SLOs.
  function goodput(perReq, slo) {
    slo = slo || {};
    var ttftSLO = slo.ttftSLO == null ? 500 : slo.ttftSLO;
    var tpotSLO = slo.tpotSLO == null ? 50 : slo.tpotSLO;
    var horizon = slo.horizon == null ? 30000 : slo.horizon;
    var keys = Object.keys(perReq);
    var ok = 0, tokens = 0, maxEnd = 0;
    keys.forEach(function (k) {
      var pr = perReq[k];
      if (pr.completion > maxEnd) maxEnd = pr.completion;
      if (pr.ttft <= ttftSLO && pr.tpot <= tpotSLO) { ok++; tokens += pr.outputLen; }
    });
    var seconds = Math.max(1e-6, (slr(horizon, maxEnd)) / 1000);
    return {
      requests: ok, total: keys.length, fraction: keys.length ? ok / keys.length : 0,
      rps: ok / seconds, tps: tokens / seconds
    };
  }
  function slr(horizon, maxEnd) { return Math.min(horizon, Math.max(1, maxEnd)); }

  // ---- roofline -----------------------------------------------------------
  function roofline(opts) {
    opts = opts || {};
    var peak = opts.peakTFLOPs == null ? 990 : opts.peakTFLOPs;
    var bw = opts.bwTBs == null ? 3.35 : opts.bwTBs;
    var ridge = peak / bw; // FLOP per byte at the knee
    return {
      ridge: ridge,
      attainable: function (ai) { return Math.min(peak, ai * bw); },
      bound: function (ai) { return ai < ridge ? 'memory' : 'compute'; },
      peakTFLOPs: peak,
      bwTBs: bw
    };
  }

  // ---- KV accounting ------------------------------------------------------
  // kvBytes({layers, kvHeads, headDim, tokens, bytesPerElem, batch, latentDim})
  function kvBytes(opts) {
    opts = opts || {};
    var layers = opts.layers == null ? 32 : opts.layers;
    var heads = opts.mla ? 1 : (opts.kvHeads == null ? 8 : opts.kvHeads);
    var dim = opts.mla ? (opts.latentDim == null ? 576 : opts.latentDim) : (opts.headDim == null ? 128 : opts.headDim);
    var tokens = opts.tokens == null ? 4096 : opts.tokens;
    var bytesPerElem = opts.bytesPerElem == null ? 2 : opts.bytesPerElem;
    var batch = opts.batch == null ? 1 : opts.batch;
    return 2 * layers * heads * dim * tokens * bytesPerElem * batch;
  }

  // ---- step-time model ----------------------------------------------------
  // stepTime({paramsB, bytesPerParam, kvBytes, bwTBs, flops, peakTFLOPs, overheadMs, batch})
  function stepTime(opts) {
    opts = opts || {};
    var paramsB = opts.paramsB == null ? 8 : opts.paramsB;
    var bytesPerParam = opts.bytesPerParam == null ? 2 : opts.bytesPerParam;
    var batch = opts.batch == null ? 1 : opts.batch;
    var kvB = opts.kvBytes == null ? 0 : opts.kvBytes;
    var bwTBs = opts.bwTBs == null ? 3.35 : opts.bwTBs;
    var peak = opts.peakTFLOPs == null ? 990 : opts.peakTFLOPs;
    var flops = opts.flops == null ? 2 * paramsB * 1e9 * batch : opts.flops;
    var overhead = opts.overheadMs == null ? 0 : opts.overheadMs;
    var weightBytes = paramsB * 1e9 * bytesPerParam;
    var memMs = (weightBytes + kvB) / (bwTBs * 1e12) * 1000;
    var computeMs = flops / (peak * 1e12) * 1000;
    return {
      memMs: memMs, computeMs: computeMs, overheadMs: overhead,
      totalMs: Math.max(memMs, computeMs) + overhead,
      bound: memMs >= computeMs ? 'memory' : 'compute',
      arithmeticIntensity: flops / Math.max(1, weightBytes + kvB)
    };
  }

  // ---- drawing ------------------------------------------------------------
  // drawGantt(ctx, W, H, perReq|finished, opts). A horizontal lane per request
  // (sorted by arrival), segments coloured by type: queued / prefill / decode /
  // swap / preempted. opts: {t0, t1, colors, maxLanes, labelEvery}.
  function drawGantt(ctx, W, H, perReq, opts) {
    opts = opts || {};
    var items = Array.isArray(perReq) ? perReq : Object.keys(perReq || {}).map(function (k) { return perReq[k]; });
    items = items.slice().sort(function (a, b) { return a.arrival - b.arrival; });
    if (opts.maxLanes) items = items.slice(0, opts.maxLanes);
    ctx.clearRect(0, 0, W, H);
    if (!items.length) return;
    var padL = opts.padL != null ? opts.padL : 40, padR = 8, padT = 8, padB = 22;
    var t0 = opts.t0 != null ? opts.t0 : 0;
    var t1 = opts.t1 != null ? opts.t1 : Math.max.apply(null, items.map(function (p) { return p.completion || p.arrival; })) || 1;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var laneH = Math.max(2, plotH / items.length);
    // opts.colors is still honoured (pages pass Guide.colors() in by
    // convention), but a page that does not is no longer stuck with the
    // light-mode palette: guide-core resolves the tokens when it is on the page,
    // and this file resolves them itself when it is not.
    var c = opts.colors || ganttColors();
    // Every segment type is a token rather than a literal. `queued` is a recessive
    // neutral so the eye skips it; `prefill` and `decode` are two steps of one
    // series ramp, because a prefill and the decode that follows it are one
    // request doing one thing; `swap` is the second categorical hue; and
    // `preempted` is `warn`, which is what it means.
    var palette = {
      queued: opts.queuedColor || c.surface2 || '#edf0f4',
      prefill: opts.prefillColor || c.accent400 || '#2a89e0',
      decode: opts.decodeColor || c.accent || '#0069d6',
      swap: opts.swapColor || c.accent2 || '#0d9488',
      preempted: opts.preemptedColor || c.warn || '#b45309'
    };
    function px(t) { return padL + plotW * (t - t0) / Math.max(1e-9, t1 - t0); }
    items.forEach(function (pr, i) {
      var y = padT + i * laneH + Math.max(0, laneH * 0.12);
      var h = Math.max(1.5, laneH * 0.76);
      // queued band from arrival until first activity
      var firstAct = (pr.segments && pr.segments.length) ? pr.segments[0].start : pr.arrival;
      ctx.fillStyle = palette.queued;
      ctx.fillRect(px(pr.arrival), y, Math.max(0.5, px(firstAct) - px(pr.arrival)), h);
      (pr.segments || []).forEach(function (s) {
        ctx.fillStyle = palette[s.type] || palette.decode;
        ctx.fillRect(px(s.start), y, Math.max(0.6, px(s.end) - px(s.start)), h);
      });
    });
    // time axis
    ctx.strokeStyle = c.divider || '#d9dee6'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + plotH); ctx.stroke();
    ctx.fillStyle = c.text || '#0c1118';
    ctx.font = ganttFont(c, opts.fontSize);
    ctx.textAlign = 'center';
    var ticks = 5;
    for (var k = 0; k <= ticks; k++) {
      var tv = t0 + (t1 - t0) * k / ticks;
      ctx.fillText((tv / 1000).toFixed(1) + 's', px(tv), H - 5);
    }
    return { px: px, t0: t0, t1: t1 };
  }

  // The theme, resolved at draw time. guide-core owns the token layer when the
  // page loaded it; these fallbacks keep this file usable on its own, which is
  // how the LLM-serving pages load it.
  function ganttColors() {
    var G = global.Guide;
    if (G && G.themeColors) return G.themeColors();
    function v(name, fb) {
      if (typeof document === 'undefined' || !document.documentElement) return fb;
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
    }
    return {
      accent: v('--color-accent', '#0069d6'),
      accent400: v('--color-accent-400', '#2a89e0'),
      accent2: v('--color-accent-2', '#0d9488'),
      warn: v('--color-warn', '#b45309'),
      surface2: v('--color-surface-2', '#edf0f4'),
      divider: v('--color-divider', '#d9dee6'),
      text: v('--color-text', '#0c1118'),
      font: v('--font-body', 'sans-serif'),
      tick: tickPx()
    };
  }

  // --chart-tick-size, resolved to a number. A canvas font string cannot carry
  // the `max(11px, 0.6875rem)` the token is written with, so the arithmetic
  // happens here; 11px is the legibility floor the token itself declares.
  function tickPx() {
    if (typeof document === 'undefined' || !document.documentElement) return 11;
    var cs = getComputedStyle(document.documentElement);
    var m = /max\s*\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)rem\s*\)/.exec(cs.getPropertyValue('--chart-tick-size'));
    if (!m) return 11;
    return Math.max(parseFloat(m[1]), parseFloat(m[2]) * (parseFloat(cs.fontSize) || 16));
  }

  function ganttFont(c, fontSize) {
    var n = fontSize != null ? fontSize : (c && c.tick != null ? c.tick : 11);
    return n + 'px ' + ((c && c.font) || 'sans-serif');
  }

  global.ServingSim = {
    rng: rng, gaussian: gaussian, lognormal: lognormal,
    workload: workload, run: run, stats: stats,
    percentile: percentile, goodput: goodput,
    roofline: roofline, kvBytes: kvBytes, stepTime: stepTime,
    drawGantt: drawGantt
  };
})(window);
