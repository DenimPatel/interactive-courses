#!/usr/bin/env node
/*
 * Convert raw-RGB colour arguments to theme tokens.
 *
 * WHY THIS NEEDS ITS OWN PASS. Every other colour migration in this repo went
 * after hex literals and `rgba()` strings, which a `grep` can find. This is the
 * class a hex scan cannot see: integers handed straight to a drawing helper.
 *
 *     Guide.drawHeatmap(ctx, w, h, m, { colorLow: [247, 249, 250],
 *                                         colorHigh: [43, 95, 255] })
 *
 * `Guide.drawHeatmap` runs those through a `toRgb()` that is perfectly capable
 * of parsing a resolved token, but the call sites pass a hard-coded light-mode
 * triple, so a reader in dark mode gets a near-white cell painted on a
 * near-black canvas. It is invisible to the migration until you go looking for
 * exactly this, which is what happened.
 *
 * THE MAPPING IS NOT DECIDED HERE. It is read out of `assets/js/theme-tokens.js`
 * — the single reviewed old-palette-to-token table — by parsing that file's own
 * map and converting `[r, g, b]` back to the hex it came from. So this script
 * cannot invent a colour: a triple that is not in the bridge is reported and
 * left alone.
 *
 * `colorLow` is the near-white end of a sequential ramp, and the token that
 * means "the plot well" is `--c-bg` — which is what the light-mode triple was
 * approximating. The bridge has the exact hexes for the ones that are literal
 * accent tints, so those go to `--c-accent-100` instead, which is the honest
 * target.
 *
 * Idempotent. Usage: node scripts/tokenize-rgb-args.js [--check]
 */
"use strict";

const fs = require("fs");
const path = require("path");

const CHECK_ONLY = process.argv.includes("--check");

/* Parse the bridge's own map rather than restating it. A second copy of the
   old-palette table is a second thing to keep in step, and this file has no
   business knowing that #2b5fff means the accent. */
function readBridgeMap() {
  const src = fs.readFileSync("assets/js/theme-tokens.js", "utf8");
  const start = src.indexOf("var CORE = {");
  // The map is assembled from CORE, then STATUS, then SERIES, and SERIES is the
  // tier for categorical hues. Stopping at `var SERIES` drops the whole tier —
  // which is how a gold that IS in the bridge was reported as unmapped.
  const merge = src.indexOf("var MAP = {};");
  if (start === -1 || merge === -1) throw new Error("cannot locate the map tiers in theme-tokens.js");
  const block = src.slice(start, merge);
  const map = new Map();
  const re = /"(#[0-9a-fA-F]{3,8})"\s*:\s*"(--[a-z0-9-]+)"/g;
  let m;
  while ((m = re.exec(block)) !== null) map.set(m[1].toLowerCase(), m[2]);
  return map;
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
}

const bridge = readBridgeMap();

/* `[247, 249, 250]` -> "--c-bg" when the bridge knows the hex. The second
   argument lets a caller override for a role the hex alone does not imply. */
function resolveTriple(nums, role) {
  if (!Array.isArray(nums) || nums.length !== 3 || nums.some((n) => !Number.isFinite(n))) return null;
  const hex = rgbToHex(nums[0], nums[1], nums[2]);
  const mapped = bridge.get(hex);
  if (mapped) return { token: mapped, hex };
  // An unmapped near-white is the low end of a ramp and the canvas is what it
  // was approximating.
  if (role === "low" && nums.every((n) => n >= 230)) return { token: "--c-bg", hex };
  return null;
}

const KEY_RE = /\b(colorLow|colorHigh)\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/g;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "index.html") out.push(p);
  }
  return out;
}

const files = [];
for (const d of ["ai", "vision", "math"]) if (fs.existsSync(d)) walk(d, files);

let changed = 0;
let converted = 0;
const unresolved = [];

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  if (!KEY_RE.test(src)) continue;
  KEY_RE.lastIndex = 0;

  const out = src.replace(KEY_RE, (full, key, r, g, b) => {
    const role = key === "colorLow" ? "low" : "high";
    const res = resolveTriple([Number(r), Number(g), Number(b)], role);
    if (!res) {
      unresolved.push({ file, key, hex: rgbToHex(r, g, b) });
      return full;
    }
    converted += 1;
    return `${key}: THEME.token('${res.token}')`;
  });

  if (out !== src) {
    changed += 1;
    if (!CHECK_ONLY) fs.writeFileSync(file, out);
  }
}

const verb = CHECK_ONLY ? "WOULD CHANGE" : "Changed";
console.log(`${verb} ${changed} page(s); ${converted} colour argument(s) tokenised.`);
if (unresolved.length) {
  console.log(`\n${unresolved.length} left as literals — the bridge has no entry, so no token was invented:`);
  const byHex = new Map();
  for (const u of unresolved) {
    if (!byHex.has(u.hex)) byHex.set(u.hex, []);
    byHex.get(u.hex).push(`${u.file}:${u.key}`);
  }
  for (const [hex, sites] of byHex) {
    console.log(`  ${hex}  x${sites.length}   ${sites.slice(0, 3).join(", ")}${sites.length > 3 ? " …" : ""}`);
  }
  process.exitCode = CHECK_ONLY ? 1 : 0;
}
