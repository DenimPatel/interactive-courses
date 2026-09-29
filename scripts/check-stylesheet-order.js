#!/usr/bin/env node
/*
 * One canonical stylesheet order, enforced.
 *
 *   theme.css  ->  styles.css / guide.css / llm-guide.css / lie-guide.css  ->  chrome.css
 *
 * WHY THIS ORDER, since all three positions are defensible on their own:
 *
 *   theme.css FIRST. It is the token layer: it declares `@font-face`, the
 *   `:root` custom properties, and a handful of utilities. It declares no
 *   component rules, so nothing in it competes with a component rule in
 *   styles.css — the cascade order between them is therefore irrelevant to
 *   whether the page looks right, and putting it first is the only position
 *   that lets a LATER sheet override a token. A page's own inline <style> and
 *   any future stylesheet can retune a value only if the value was declared
 *   before them. Declaring it last would make every token a floor.
 *
 *   chrome.css LAST. It is the only sheet that draws the navigation, the
 *   settings dialog and the mobile drawer, and it has to beat the general
 *   `.nav-*` rules in styles.css, which are written to stand alone on a page
 *   that loads no chrome at all. Equal-specificity last-wins is exactly the
 *   mechanism those two files need, and it is the only one that does not
 *   require either to be littered with !important.
 *
 * Idempotent. Also normalises the 28 hand-written-head pages that
 * inject-theme-head.js wrote, which it originally emitted in the wrong order.
 *
 * Usage: node scripts/check-stylesheet-order.js [--fix]
 */
"use strict";

const fs = require("fs");
const path = require("path");

const FIX = process.argv.includes("--fix");

// Paths as they appear in the href, i.e. WITH the leading /assets/. Matching
// these against a bare "css/theme.css" silently skips every file, which is a
// false PASS rather than a failure — the worst kind of bug for a guard.
const THEME = "/assets/css/theme.css";
const CHROME = "/assets/css/chrome.css";
// Everything between the two ends. Order among these does not matter: they are
// peer component sheets with disjoint selector sets.
const MIDDLE = [
  "/assets/css/styles.css",
  "/assets/css/guide.css",
  "/assets/css/llm-guide.css",
  "/assets/css/lie-guide.css"
];

const LINK_RE = /^[ \t]*<link rel="stylesheet" href="\{\{ '(\/assets\/css\/[^"']+)' \| relative_url \}\}"[^>]*>[ \t]*\r?\n/gm;

function findFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) findFiles(p, out);
    else if (entry.name.endsWith(".html") || entry.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function hrefOf(match) {
  return "'" + match[1] + "' | relative_url }}";
}

const files = [];
for (const dir of ["ai", "vision", "math", "_includes", "_layouts"]) {
  if (fs.existsSync(dir)) findFiles(dir, files);
}
files.push("404.html");

const problems = [];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, "utf8");

  const matches = [...src.matchAll(LINK_RE)];
  if (matches.length === 0) continue;

  const names = matches.map((m) => m[1]);
  const hasTheme = names.includes(THEME);
  const hasChrome = names.includes(CHROME);
  if (!hasTheme && !hasChrome) continue;

  // Build the desired sequence, keeping any other local sheet in place.
  const ordered = [];
  if (hasTheme) ordered.push(THEME);
  for (const n of names) {
    if (n === THEME || n === CHROME) continue;
    if (MIDDLE.includes(n) || !ordered.includes(n)) ordered.push(n);
  }
  if (hasChrome) ordered.push(CHROME);

  // Rebuild as: everything before the first managed link, then the whole
  // ordered block, then everything after the last one. That is only sound if
  // the managed links are contiguous, so contiguity is checked rather than
  // assumed — a page with a non-managed local sheet wedged between two managed
  // ones is reported, not silently collapsed.
  //
  // Contiguity is the whitespace BETWEEN consecutive matches. Measuring the
  // span from the end of the first match to the start of the last instead would
  // include the middle matches themselves, and then flag every already-correct
  // file — a check that fails when nothing is wrong trains you to ignore it.
  const first = matches[0];
  const last = matches[matches.length - 1];
  let contiguous = true;
  for (let i = 1; i < matches.length; i += 1) {
    const sep = src.slice(matches[i - 1].index + matches[i - 1][0].length, matches[i].index);
    if (sep.trim() !== "") { contiguous = false; break; }
  }

  const block = ordered
    .map((n) => '<link rel="stylesheet" href="{{ \'' + n + '\' | relative_url }}">\n')
    .join("");
  const out = src.slice(0, first.index) + block + src.slice(last.index + last[0].length);

  const norm = (s) => s.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");
  if (!contiguous || norm(out) !== norm(src)) {
    problems.push({ file, order: ordered.join(" > "), contiguous });
    if (FIX && contiguous) fs.writeFileSync(file, norm(out));
  }
}

if (FIX) {
  console.log("Reordered " + problems.length + " file(s).");
  for (const p of problems) console.log("  " + p.file + "\n    " + p.order);
} else if (problems.length) {
  console.log("OUT OF ORDER in " + problems.length + " file(s):");
  for (const p of problems) console.log("  " + p.file + "  " + p.order);
  process.exit(1);
} else {
  console.log("PASS: every page loads theme.css first and chrome.css last");
}
