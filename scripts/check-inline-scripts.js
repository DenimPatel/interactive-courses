#!/usr/bin/env node
/*
 * Compiles every inline <script> in the built site the way a browser does.
 *
 * Why this exists: a top-level `return` is legal inside a CJS module and fatal
 * in a browser, so a boot script that is an IIFE by intent but missing its
 * opening line throws "Illegal return statement" at parse time — which means it
 * is discarded in full, silently, on every page. Nothing in the rendered page
 * says so: the page just comes up unthemed. This check is the only thing that
 * notices.
 *
 * `vm.Script` with no filename uses script (browser) semantics, not CJS, so a
 * top-level return throws here exactly as it does in the browser.
 *
 * Usage: node scripts/check-inline-scripts.js [dir]   (default: _site)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(process.argv[2] || "_site");

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith(".html")) out.push(p);
  }
  return out;
}

if (!fs.existsSync(root)) {
  console.error("FAIL: " + root + " does not exist — build the site first");
  process.exit(1);
}

const pages = walk(root, []);
let checked = 0;
const failures = [];

for (const page of pages) {
  const html = fs.readFileSync(page, "utf8");
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  let index = 0;
  while ((m = re.exec(html)) !== null) {
    index += 1;
    const attrs = m[1] || "";
    const body = m[2] || "";
    // Skip src-only tags (no inline body) and data blocks.
    if (/\bsrc\s*=/.test(attrs)) continue;
    if (/\btype\s*=\s*["']?(?!module\b)[a-z]/i.test(attrs) && !/javascript|module/i.test(attrs)) continue;
    if (body.trim() === "") continue;
    checked += 1;
    try {
      new vm.Script(body, { filename: page + "#inline-" + index });
    } catch (err) {
      const line = err.lineNumber != null ? err.lineNumber : "?";
      failures.push({
        page: path.relative(root, page),
        index,
        line,
        message: err.message,
        excerpt: body.split("\n")[line - 1] != null ? body.split("\n")[line - 1].trim().slice(0, 120) : ""
      });
    }
  }
}

if (failures.length) {
  console.log("FAIL: " + failures.length + " of " + checked + " inline scripts in " + pages.length + " pages do not compile\n");
  for (const f of failures) {
    console.log("  " + f.page + "  script #" + f.index + " line " + f.line);
    console.log("    " + f.message);
    if (f.excerpt) console.log("    > " + f.excerpt);
  }
  process.exit(1);
}

console.log("PASS: " + checked + " inline scripts across " + pages.length + " pages compile");
