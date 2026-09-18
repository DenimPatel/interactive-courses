#!/usr/bin/env node
/* Numerics self-check for assets/js/llm-app-sim.js.
 *
 * The repository has no JavaScript test framework, and a wrong BM25, RRF, HNSW
 * traversal or cost formula silently poisons every page in two volumes (36 parts
 * of hand-written canvas demos that all trust this file). This script loads the
 * browser file into a minimal Node sandbox and asserts values that are
 * independently known — hand-computed BM25 and RRF, the exact cost/cache
 * arithmetic, recall bounds for the graph index, and the structural invariants
 * (chunk counts, no-redo under external notes) the demos rely on.
 *
 * Run: node scripts/check-llm-app-sim.js
 * Exits non-zero on the first failed assertion, printing the component, the
 * expected value and the value actually produced.
 *
 * Node-only, not wired into the Ruby CI, mirroring scripts/check-stats-viz.js. */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'assets', 'js', 'llm-app-sim.js');

// --- minimal browser sandbox -------------------------------------------------
const windowObj = {};
windowObj.Guide = {
  seededRandom: function (seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
};

new Function('window', fs.readFileSync(SRC, 'utf8'))(windowObj);
const App = windowObj.AppSim;
if (!App) { console.error('check-llm-app-sim: llm-app-sim.js did not export window.AppSim'); process.exit(1); }

// --- assertion helpers -------------------------------------------------------
let failures = 0, checks = 0;
function close(actual, expected, tol, label) {
  checks++;
  const ok = typeof actual === 'number' && isFinite(actual) && Math.abs(actual - expected) <= tol;
  if (!ok) { failures++; console.error('  FAIL ' + label + ': expected ' + expected + ' (±' + tol + '), got ' + actual); }
}
function eq(actual, expected, label) {
  checks++;
  if (actual !== expected) { failures++; console.error('  FAIL ' + label + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)); }
}
function truthy(cond, label) {
  checks++;
  if (!cond) { failures++; console.error('  FAIL ' + label); }
}
function section(name) { console.log('· ' + name); }

// --- tokenizer ---------------------------------------------------------------
section('toy tokenizer and context budget');
eq(App.tokenize('tokenization').join('|'), 'token|##ization', 'tokenization → token + ##ization');
eq(App.tokenize('cat').join('|'), 'cat', 'short words stay whole');
eq(App.countTokens('the cat sat on the mat'), 6, 'six words → six tokens');
truthy(App.countTokens('tokenization') >= 2, 'a long word splits into multiple tokens');

const budget = App.ctxBudget({
  window: 1000, reserveOutput: 200,
  segments: [{ name: 'system', text: 'the cat sat on the mat' }, { name: 'user', tokens: 100 }]
});
eq(budget.budget, 800, 'context budget subtracts the output reserve');
eq(budget.used, 106, 'context used = 6 + 100');
eq(budget.remaining, 694, 'context remaining');
eq(budget.over, false, 'no overflow when under budget');
eq(budget.breakdown.length, 2, 'breakdown has one row per segment');

// --- cosine ------------------------------------------------------------------
section('cosine similarity');
close(App.cosine([1, 0], [0, 1]), 0, 1e-12, 'orthogonal vectors → 0');
close(App.cosine([1, 0], [1, 0]), 1, 1e-12, 'identical vectors → 1');
close(App.cosine([1, 1], [1, 1]), 1, 1e-12, 'identical non-unit vectors → 1');

// --- BM25 against a hand-computed example ------------------------------------
section('BM25 (worked example)');
const bmDocs = [
  { id: 'd1', tokens: ['a', 'b', 'a'] },
  { id: 'd2', tokens: ['a', 'c'] },
  { id: 'd3', tokens: ['b', 'c', 'c'] }
];
const bm = App.bm25(bmDocs, ['a', 'b'], { k1: 1.2, b: 0.75 });
eq(bm.map((e) => e.id).join(','), 'd1,d2,d3', 'BM25 ranks d1 > d2 > d3');
close(bm[0].score, 1.071447, 2e-3, 'BM25 score of d1');
close(bm[1].score, 0.523554, 2e-3, 'BM25 score of d2');
close(bm[2].score, 0.447147, 2e-3, 'BM25 score of d3');

// --- RRF ---------------------------------------------------------------------
section('reciprocal rank fusion');
const fused = App.rrf([['A', 'B', 'C'], ['B', 'C', 'A']], 60);
eq(fused.map((e) => e.id).join(','), 'B,A,C', 'RRF orders B > A > C');

// --- retrieval pipeline ------------------------------------------------------
section('hybrid retrieval and reranking');
const q = 'embeddings cosine similarity';
const rr = App.rerank(q, App.CORPUS, {});
eq(rr[0].id, 'embeddings', 'reranking puts the embedding doc first for an embeddings query');
const hr = App.hybridRetrieve(q, { wide: 10, narrow: 5 });
truthy(hr.fused.some((e) => e.id === 'embeddings'), 'fused candidates contain the embedding doc');
truthy(hr.reranked.length === 5, 'reranked list honours the narrow width');
truthy(hr.queryVector && isFinite(hr.queryVector.x), 'query vector is finite');

// --- chunking ----------------------------------------------------------------
section('chunking');
const doc = 'Alpha one. Beta two. Gamma three. Delta four. Epsilon five. Zeta six. Eta seven. Theta eight.';
const fixed = App.chunk(doc, 40, 0, 'fixed');
eq(fixed.length, Math.ceil(doc.length / 40), 'fixed chunking count for a known length');
truthy(fixed[0].text.length === 40, 'fixed chunk 0 is exactly size long');
const rec = App.chunk(doc, 40, 0, 'recursive');
truthy(rec.every((c) => c.text.length <= 60), 'recursive chunks respect the size target');
const par = App.chunk(doc, 40, 0, 'parent');
truthy(par[par.length - 1].isParent === true, 'parent chunking appends the whole document');

// --- IVF + PQ ----------------------------------------------------------------
section('IVF and product quantization');
const pts = App.CORPUS.map((d) => ({ id: d.id, x: d.x, y: d.y }));
const ivf1 = App.ivfpq(pts, { nlist: 8, nbits: 1, seed: 4 });
const ivf4 = App.ivfpq(pts, { nlist: 8, nbits: 4, seed: 4 });
eq(ivf4.reconstructed.length, pts.length, 'IVF reconstructs every point');
truthy(ivf4.quantError < ivf1.quantError, 'more PQ bits reduce quantization error');
truthy(ivf4.quantError >= 0, 'quantization error is non-negative');
const probe = App.ivfSearch(ivf4, { x: 0.6, y: -0.6 }, 2);
eq(probe.probed.length, 2, 'nprobe selects two cells');
truthy(probe.results.length > 0, 'probing returns candidates');

// --- HNSW --------------------------------------------------------------------
section('HNSW traversal');
const r = App.rng(2026);
const hnPoints = [];
for (let i = 0; i < 150; i++) {
  hnPoints.push({ id: 'p' + i, x: (r() - 0.5) * 2, y: (r() - 0.5) * 2 });
}
const index = App.hnsw(hnPoints, 16, 200, 3);
let hits = 0, visitsSmall = 0, visitsLarge = 0;
for (let i = 0; i < 40; i++) {
  const base = hnPoints[(i * 7) % hnPoints.length];
  const query = { x: base.x + 0.004, y: base.y - 0.004 };
  const s50 = App.hnswSearch(index, query, 50);
  if (s50.foundTrue) hits++;
  visitsLarge += s50.visits.length;
  const s5 = App.hnswSearch(index, query, 5);
  visitsSmall += s5.visits.length;
  truthy(Array.isArray(s50.visits) && s50.visits.length > 0, 'HNSW records a visited trace');
}
truthy(hits / 40 >= 0.9, 'HNSW recall at efSearch=50 is at least 0.9 (got ' + (hits / 40) + ')');
truthy(visitsSmall < visitsLarge, 'smaller efSearch visits fewer nodes');

// --- agent trajectories ------------------------------------------------------
section('agent trajectories and compaction');
const none = App.agentRun('docs', { compaction: 'none', maxTokens: 12000, steps: 40 });
eq(none.steps.length, 40, 'agent run has the requested number of steps');
eq(none.redos.length, 0, 'no compaction never forces a redo');
truthy(none.overflows > 0, 'no compaction overflows the budget');
const evict = App.agentRun('docs', { compaction: 'evict', maxTokens: 12000, steps: 40 });
truthy(evict.drops.length > 0, 'eviction drops facts');
truthy(evict.redos.length > 0, 'eviction forces a redo when a needed fact is gone');
const notes = App.agentRun('docs', { compaction: 'notes', maxTokens: 12000, steps: 40 });
eq(notes.redos.length, 0, 'external notes keep every fact, so no redo');
const summarize = App.agentRun('docs', { compaction: 'summarize', maxTokens: 12000, steps: 40 });
truthy(summarize.drops.length > 0, 'summarisation drops low-salience facts');
truthy(summarize.redos.length > 0, 'summarisation forces a redo for a dropped fact');
truthy(none.maxTotal > notes.maxTotal, 'notes keep the context smaller than an unbounded history');

// --- judge biases ------------------------------------------------------------
section('judge biases');
const shortCorrect = { correct: true, length: 80 };
const longWrong = { correct: false, length: 600 };
const verb = App.judge(shortCorrect, longWrong, { verbosity: 2, lengthScale: 100 });
eq(verb.shown.winner, 'b', 'a strong verbosity bias prefers the long wrong answer');
const unbiassed = App.judge(shortCorrect, longWrong, {});
eq(unbiassed.shown.winner, 'a', 'with no biases the correct answer wins');
const posBias = App.judge({ correct: true, length: 100 }, { correct: false, length: 100 }, { position: 4 });
truthy(posBias.shown.winner !== posBias.swapped.winner, 'position bias flips when the order is swapped');
eq(posBias.averaged.winner, 'a', 'order averaging removes position bias');
const selfBias = App.judge({ correct: false, length: 100, selfAuthored: true }, { correct: true, length: 100 }, { self: 4 });
eq(selfBias.shown.winner, 'a', 'self-preference bias prefers the judge’s own answer');
close(App.cohenKappa([1, 1, 0, 0], [1, 0, 0, 0]), 0.5, 1e-12, 'Cohen’s kappa = 0.5 for this confusion');

// --- cost --------------------------------------------------------------------
section('cost model');
const cost = App.costModel({
  inputTokens: 10000, cachedInputTokens: 4000, outputTokens: 2000,
  prices: { inputPerM: 3, outputPerM: 15, cachedPerM: 0.3 }
});
close(cost.inputCost, 0.018, 1e-9, 'uncached input cost = 6000/1M * $3');
close(cost.cachedCost, 0.0012, 1e-9, 'cached input cost = 4000/1M * $0.30');
close(cost.outputCost, 0.03, 1e-9, 'output cost = 2000/1M * $15');
close(cost.perCall, 0.0492, 1e-9, 'per-call cost');
close(cost.cacheSavings, 0.0108, 1e-9, 'cache saving = 4000/1M * $2.70');
truthy(cost.outputShare > cost.inputShare, 'output dominates the bill at these prices');

// --- latency -----------------------------------------------------------------
section('latency model');
const lat = App.latencyModel({
  prefixTokens: 10000, cachedPrefixTokens: 8000, prefillTps: 20000,
  ttftBaseMs: 40, queueMs: 0, outputTokens: 100, tpotMs: 25
});
close(lat.prefillMs, 100, 1e-9, 'prefill of the uncached 2,000 tokens = 100 ms');
close(lat.ttftMs, 140, 1e-9, 'TTFT = base + prefill');
close(lat.e2eMs, 2640, 1e-9, 'end-to-end = TTFT + output * TPOT');

// --- cache simulator ---------------------------------------------------------
section('cache simulator');
const prefixCache = App.cacheSim([
  { id: 'r1', blocks: ['a', 'b', 'c'] },
  { id: 'r2', blocks: ['a', 'b', 'd'] },
  { id: 'r3', blocks: ['x'] }
], { type: 'prefix', capacityBlocks: 64 });
eq(prefixCache.hits, 1, 'prefix cache hits on the shared prefix only');
close(prefixCache.hitRate, 1 / 3, 1e-12, 'prefix hit rate = 1/3');
eq(prefixCache.reusedTokens, 2, 'prefix cache reuses two blocks');
eq(prefixCache.wrongAnswers, 0, 'prefix cache cannot return a wrong answer');
const sem = App.cacheSim([
  { id: 's1', cluster: 1, paraphrase: true },
  { id: 's2', cluster: 1, paraphrase: true },
  { id: 's3', cluster: 1, paraphrase: true },
  { id: 's4', cluster: 2, paraphrase: true }
], { type: 'semantic', ttl: 100, wrongAnswerRate: 0 });
eq(sem.hits, 2, 'semantic cache hits two repeats');
close(sem.hitRate, 0.5, 1e-12, 'semantic hit rate = 0.5');
const semWrong = App.cacheSim([
  { id: 'w1', cluster: 1, paraphrase: true },
  { id: 'w2', cluster: 1, paraphrase: false }
], { type: 'semantic', ttl: 100, wrongAnswerRate: 1, seed: 9 });
eq(semWrong.wrongAnswers, 1, 'a loose semantic cache returns a wrong answer on a near miss');

// --- injection matrix --------------------------------------------------------
section('prompt-injection matrix');
const matrix = App.injectionMatrix();
const cap = matrix.filter((d) => d.defense === 'capability')[0];
truthy(cap.stops.filter((s) => s.stopped).length === 7, 'capability control stops seven of eight variants');
truthy(cap.stops.filter((s) => s.attack === 'direct-override' && !s.stopped).length === 1,
  'capability control does not stop an authorised direct instruction');
const rails = matrix.filter((d) => d.defense === 'rails')[0];
truthy(rails.stops.filter((s) => s.attack === 'exfil-image' && s.stopped).length === 1, 'rails stop the exfil image');
truthy(rails.stops.filter((s) => s.attack === 'indirect-document' && !s.stopped).length === 1, 'rails miss the poisoned document');
eq(matrix.filter((d) => d.defense === 'none')[0].score, 0, 'no defense stops nothing');
App.INJECTION_ATTACKS.forEach((a) => {
  const stopped = matrix.some((d) => d.stops.some((s) => s.attack === a.id && s.stopped));
  truthy(stopped, 'some defense stops ' + a.id);
});

// --- corpus invariants -------------------------------------------------------
section('shared corpus');
eq(App.CORPUS.length, 60, 'the shared corpus has 60 documents');
const ids = new Set(App.CORPUS.map((d) => d.id));
eq(ids.size, 60, 'corpus ids are unique');
truthy(App.CORPUS.every((d) => d.x >= -1 && d.x <= 1 && d.y >= -1 && d.y <= 1), 'every coordinate is inside [-1, 1]');

// --- report ------------------------------------------------------------------
console.log('');
if (failures) {
  console.error('check-llm-app-sim: ' + failures + ' of ' + checks + ' checks FAILED');
  process.exit(1);
}
console.log('check-llm-app-sim: all ' + checks + ' checks passed');
