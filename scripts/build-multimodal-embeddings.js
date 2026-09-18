#!/usr/bin/env node
/* Build assets/data/multimodal-embeddings.json for the Multimodal guide's
 * "what a shared space buys" retrieval demo.
 *
 * IMPORTANT: these are NOT CLIP embeddings. They are a hand-authored
 * concept-attribute matrix turned into small vectors by a fixed formula, so the
 * demo is fully deterministic and inspectable. The page labels them as
 * illustrative for exactly this reason (the same honesty convention
 * vision/multi-view-geometry/beyond/ uses for its hand-built NeRF analogies).
 *
 * The image and text vectors for one concept share its attribute block and
 * differ only in their seeded noise, so retrieval works; two concepts with the
 * same attributes but different word order ("a red square" vs "a square that is
 * red") get identical vectors, which is the compositionality failure the page
 * demonstrates.
 *
 * Usage: node scripts/build-multimodal-embeddings.js
 * Regenerate and commit the JSON whenever the concept list changes. */
'use strict';

const fs = require('fs');
const path = require('path');

// --- seeded LCG, mirroring Guide.seededRandom ---------------------------------
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const COLORS = ['red', 'blue', 'green', 'yellow'];
const SHAPES = ['square', 'circle', 'triangle'];
const SIZES = ['small', 'large'];
const COUNTS = ['one', 'two'];
const SCENES = ['plain', 'table'];

const DIMS = COLORS.length + SHAPES.length + SIZES.length + COUNTS.length + SCENES.length + 3; // padded

// --- the hand-authored concept matrix ----------------------------------------
// `attrs` names one option from each block. `caption` is the natural-language
// side of the pair. `pair` groups the two word-order variants that share attrs.
const CONCEPTS = [
  { id: 'red-square', caption: 'a red square', attrs: { color: 'red', shape: 'square', size: 'large', count: 'one', scene: 'plain' } },
  { id: 'square-red-reordered', caption: 'a square that is red', attrs: { color: 'red', shape: 'square', size: 'large', count: 'one', scene: 'plain' }, same: true },
  { id: 'blue-circle', caption: 'a blue circle', attrs: { color: 'blue', shape: 'circle', size: 'small', count: 'one', scene: 'plain' } },
  { id: 'green-triangle', caption: 'a green triangle', attrs: { color: 'green', shape: 'triangle', size: 'small', count: 'one', scene: 'plain' } },
  { id: 'yellow-square', caption: 'a yellow square', attrs: { color: 'yellow', shape: 'square', size: 'small', count: 'one', scene: 'plain' } },
  { id: 'red-circle', caption: 'a red circle', attrs: { color: 'red', shape: 'circle', size: 'large', count: 'one', scene: 'plain' } },
  { id: 'blue-square', caption: 'a blue square', attrs: { color: 'blue', shape: 'square', size: 'large', count: 'one', scene: 'plain' } },
  { id: 'green-circle', caption: 'a green circle', attrs: { color: 'green', shape: 'circle', size: 'small', count: 'one', scene: 'plain' } },
  { id: 'yellow-triangle', caption: 'a yellow triangle', attrs: { color: 'yellow', shape: 'triangle', size: 'large', count: 'one', scene: 'plain' } },
  { id: 'large-blue-circle', caption: 'a large blue circle', attrs: { color: 'blue', shape: 'circle', size: 'large', count: 'one', scene: 'plain' } },
  { id: 'small-red-square', caption: 'a small red square', attrs: { color: 'red', shape: 'square', size: 'small', count: 'one', scene: 'plain' } },
  { id: 'green-square-table', caption: 'a green square on a table', attrs: { color: 'green', shape: 'square', size: 'large', count: 'one', scene: 'table' } },
  { id: 'blue-triangle-table', caption: 'a blue triangle on a table', attrs: { color: 'blue', shape: 'triangle', size: 'small', count: 'one', scene: 'table' } },
  { id: 'two-red-circles', caption: 'two red circles', attrs: { color: 'red', shape: 'circle', size: 'small', count: 'two', scene: 'plain' } },
  { id: 'yellow-circle', caption: 'a yellow circle', attrs: { color: 'yellow', shape: 'circle', size: 'small', count: 'one', scene: 'plain' } },
  { id: 'yellow-circle-two', caption: 'two yellow circles', attrs: { color: 'yellow', shape: 'circle', size: 'small', count: 'two', scene: 'plain' } }
];

function oneHot(value, values, scale) {
  return values.map((v) => (v === value ? scale : 0));
}

function attrBlock(attrs) {
  return [].concat(
    oneHot(attrs.color, COLORS, 1),
    oneHot(attrs.shape, SHAPES, 1),
    oneHot(attrs.size, SIZES, 0.8),
    oneHot(attrs.count, COUNTS, 0.7),
    oneHot(attrs.scene, SCENES, 0.6),
    [0.15, 0.15, 0.15]
  );
}

function normalize(v) {
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => +(x / n).toFixed(6));
}

const out = {
  note: 'Illustrative concept-attribute embeddings, NOT real CLIP output. Image and text vectors share a concept attribute block and differ in seeded noise; regenerate with node scripts/build-multimodal-embeddings.js.',
  dims: DIMS,
  blocks: { color: COLORS, shape: SHAPES, size: SIZES, count: COUNTS, scene: SCENES },
  concepts: CONCEPTS.map((c, i) => {
    const base = attrBlock(c.attrs);
    const ri = rng(1000 + i * 17), rt = rng(2000 + i * 29);
    const image = base.map((v) => +(v * 0.9 + 0.14 * (ri() - 0.5)).toFixed(6));
    const text = base.map((v) => +(v * 0.9 + 0.20 * (rt() - 0.5)).toFixed(6));
    return {
      id: c.id,
      caption: c.caption,
      attrs: c.attrs,
      sameAttributesAs: c.same ? 'red-square' : undefined,
      image: normalize(image),
      text: normalize(text)
    };
  })
};

const dest = path.join(__dirname, '..', 'assets', 'data', 'multimodal-embeddings.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
console.log('wrote ' + path.relative(path.join(__dirname, '..'), dest) + ' (' + out.concepts.length + ' concepts, ' + DIMS + ' dims)');
