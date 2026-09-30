#!/usr/bin/env node
/*
 * This site is closed over itself: it links to nothing outside the project.
 *
 * WHY THIS NEEDS A GUARD RATHER THAN A REVIEW CONVENTION. The site used to be
 * one half of a pair with `DenimPatel/AI`, and roughly 110 of its pages carried
 * a cross-repo link into it — in the nav, the footer, the homepage, the 404, a
 * reading list in every optimization part, and a "contribute" link that pointed
 * at the WRONG repository. That last one is the reason this is a build-time
 * check and not a style note: nothing about it looks wrong in a diff. It is a
 * plausible link to a real page of a real sibling project, and a reviewer
 * skimming 110 files will wave it through every time.
 *
 * The removal was the bulk edit; this is what keeps it removed. A link to
 * denimpatel.github.io/AI or github.com/DenimPatel/AI can only come back by
 * being typed on purpose, and the point is that it never should be.
 *
 * WHAT IS DELIBERATELY NOT FLAGGED. Links to other people's work. A guide
 * citing an arXiv paper, a GitHub repository that is not this author's, or a
 * vendor doc is doing its job. Only this author's other site is excluded, and
 * only by exact host+path prefix.
 *
 * Usage: node scripts/check-no-external-links.js [--fix-list]
 */
"use strict";

const fs = require("fs");
const path = require("path");

const FORBIDDEN = [
  // The other half of the old split, on Pages.
  "denimpatel.github.io/AI",
  // …and its repository, which is a different mistake: the guides footer used
  // to send "Contribute on GitHub" to the sibling repo, so a reader fixing a
  // guide landed on a repository with no guides in it.
  "github.com/DenimPatel/AI"
];

const DIRS = ["ai", "vision", "math", "_includes", "_layouts", "_data", "assets", "scripts"];
const ROOT_FILES = ["index.md", "README.md", "CLAUDE.md", "404.html"];

// CLAUDE.md documents the rule and therefore has to name the forbidden URLs to
// describe them. This file does the same, in order to explain what it is
// looking for. Both are excluded from the scan but reported separately, so a
// rule can be stated without the rule being unstatable.
const MAY_MENTION = new Set(["README.md", "CLAUDE.md", path.join("scripts", "check-no-external-links.js")]);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "_site", ".kilo", "vendor", "node_modules", ".worktrees"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(html|md|css|js|rb|yml|yaml|json|svg)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = [];
for (const d of DIRS) if (fs.existsSync(d)) walk(d, files);
for (const f of ROOT_FILES) if (fs.existsSync(f)) files.push(f);

const hits = [];
const docHits = [];

for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const bad of FORBIDDEN) {
      if (!line.includes(bad)) continue;
      const rec = { file, line: i + 1, url: bad, text: line.trim().slice(0, 120) };
      // Skip the ones inside `https://denimpatel.github.io/AI-site` style
      // near-misses and anything that is a bare mention without a link scheme
      // being plausible; the substring test is exact enough here.
      (MAY_MENTION.has(file) ? docHits : hits).push(rec);
    }
  });
}

if (process.argv.includes("--fix-list")) {
  const byFile = new Map();
  for (const h of hits) {
    if (!byFile.has(h.file)) byFile.set(h.file, []);
    byFile.get(h.file).push(h.line);
  }
  for (const [file, lines] of byFile) {
    console.log(file + ":" + [...new Set(lines)].sort((a, b) => a - b).join(","));
  }
  process.exit(hits.length ? 1 : 0);
}

if (hits.length) {
  console.log("FAIL: " + hits.length + " link(s) out of this site\n");
  for (const h of hits.slice(0, 40)) {
    console.log("  " + h.file + ":" + h.line + "  " + h.text);
  }
  if (hits.length > 40) console.log("  … and " + (hits.length - 40) + " more");
  console.log("\nRun with --fix-list for a per-file line list.");
  process.exit(1);
}

console.log(
  "PASS: no links out of this site" +
  (docHits.length ? " (" + docHits.length + " mention(s) in docs, which state the rule)" : "")
);
