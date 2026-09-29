#!/usr/bin/env node
/*
 * One-time integration for the pages that carry a hand-written <head>.
 *
 * The other ~255 part pages reach the theme through
 * _includes/guide-head.html or _includes/llm-head.html, so a change to those
 * includes reaches all of them at once. These 28 do not: they hand-write
 * <head>, link assets/css/styles.css directly, and therefore never see the
 * token layer at all. Without this they would render the new component styles
 * against no variables — which does not look broken, it looks like a page that
 * lost its theme.
 *
 * This adds exactly three things to each, and nothing else:
 *   1. the no-flash boot script and the two theme-color metas, BEFORE the first
 *      stylesheet link (after the link is too late — the browser has already
 *      decided what the first frame is);
 *   2. the token layer and the chrome stylesheet, AFTER the page's own
 *      stylesheets, so a page can still override a token and the chrome still
 *      wins over the general nav rules in styles.css;
 *   3. id="main" on <main>, which is the skip link's target.
 *
 * Idempotent: running it twice changes nothing the second time.
 *
 * Usage: node scripts/inject-theme-head.js [--check]
 *        --check  report only, exit 1 if anything would change
 */
"use strict";

const fs = require("fs");
const path = require("path");

const CHECK_ONLY = process.argv.includes("--check");

const BOOT = [
  "{% include theme-boot.html %}",
  '<meta name="color-scheme" content="light dark">',
  '<meta name="theme-color" content="#f2f5fa" media="(prefers-color-scheme: light)">',
  '<meta name="theme-color" content="#090c11" media="(prefers-color-scheme: dark)">',
  // The old-palette bridge. SYNCHRONOUS and un-deferred on purpose: a part
  // page can paint from its own inline <script> during parse, and a deferred
  // global does not exist until after parse, so `THEME.ink(...)` would be a
  // TypeError on the first frame of every such page. ~2 kB, same-origin.
  '<script src="{{ \'/assets/js/theme-tokens.js\' | relative_url }}"></script>'
].join("\n");

const THEME_LINKS = [
  '<link rel="stylesheet" href="{{ \'/assets/css/theme.css\' | relative_url }}">',
  '<link rel="stylesheet" href="{{ \'/assets/css/chrome.css\' | relative_url }}">'
].join("\n");

const SKIP_TARGET_NOTE =
  "id=\"main\"";

function findPages(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) findPages(p, out);
    else if (entry.name === "index.html") out.push(p);
  }
  return out;
}

function needsIntegration(src) {
  if (src.includes("include guide-head")) return false;
  if (src.includes("include llm-head")) return false;
  if (/^layout:/m.test(src)) return false;
  return true;
}

function transform(src) {
  const changes = [];
  let out = src;

  // 1. Boot script + metas, before the first stylesheet link.
  if (!out.includes("include theme-boot.html")) {
    const first = out.search(/^[ \t]*<link rel="stylesheet"/m);
    if (first === -1) return { error: "no stylesheet link to anchor the boot script to" };
    out = out.slice(0, first) + BOOT + "\n" + out.slice(first);
    changes.push("boot+metas");
  }

  // 2. Token layer + chrome, after the LAST local stylesheet link. Local only:
  //    a CDN stylesheet (katex) must stay where the page put it.
  if (!out.includes("css/theme.css")) {
    const linkRe = /^[ \t]*<link rel="stylesheet" href="\{\{ '\/assets\/css\/[^"']+' \| relative_url \}\}"[^>]*>[ \t]*$/gm;
    let last = null;
    let m;
    while ((m = linkRe.exec(out)) !== null) last = m;
    if (last === null) return { error: "no local stylesheet link to anchor theme.css to" };
    const at = last.index + last[0].length;
    out = out.slice(0, at) + "\n" + THEME_LINKS + out.slice(at);
    changes.push("theme+chrome");
  }

  // 3. Skip-link target. First <main> only — a page may legitimately have more.
  if (/<main(\s[^>]*)?>/.test(out) && !/<main[^>]*\bid="main"/.test(out)) {
    out = out.replace(/<main(\s[^>]*)?>/, (full, attrs) =>
      '<main' + (attrs || "") + ' id="main">'
    );
    changes.push("main-id");
  }

  // 4. The old-palette bridge. Separate guard from step 1 on purpose: a page
  //    can already carry the boot script and still be missing the bridge, and
  //    folding the two checks together would report that page as done.
  if (!out.includes("js/theme-tokens.js")) {
    const anchor = out.indexOf("{% include theme-boot.html %}");
    const at = anchor === -1 ? -1 : anchor + "{% include theme-boot.html %}".length;
    if (at === -1) return { error: "no boot-script anchor to add theme-tokens.js after" };
    out =
      out.slice(0, at) +
      "\n<script src=\"{{ '/assets/js/theme-tokens.js' | relative_url }}\"></script>" +
      out.slice(at);
    changes.push("theme-tokens");
  }

  return { out, changes };
}

const pages = [];
for (const dir of ["ai", "vision", "math"]) {
  if (fs.existsSync(dir)) findPages(dir, pages);
}

const todo = [];
for (const file of pages) {
  const src = fs.readFileSync(file, "utf8");
  if (!needsIntegration(src)) continue;
  const res = transform(src);
  if (res.error) {
    console.log("ERROR  " + file + ": " + res.error);
    process.exitCode = 1;
    continue;
  }
  if (res.changes.length) todo.push({ file, changes: res.changes, out: res.out });
}

if (CHECK_ONLY) {
  if (todo.length) {
    console.log("WOULD CHANGE " + todo.length + " page(s):");
    for (const t of todo) console.log("  " + t.file + "  [" + t.changes.join(", ") + "]");
    process.exit(1);
  }
  console.log("PASS: every hand-written-head page already has the theme layer");
} else {
  for (const t of todo) {
    fs.writeFileSync(t.file, t.out);
    console.log("  " + t.file + "  [" + t.changes.join(", ") + "]");
  }
  console.log("\nUpdated " + todo.length + " page(s).");
}
