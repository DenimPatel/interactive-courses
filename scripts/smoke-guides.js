#!/usr/bin/env node
/* Rendered-page smoke test for the interactive guides.
 *
 * CLAUDE.md's own rule is that a change you cannot see rendered is a change you
 * cannot verify — and the statistics guide alone adds 30+ pages of hand-written
 * canvas JS with no test coverage. This script loads each built page in a real
 * browser and asserts two things the build and the linter cannot:
 *
 *   1. zero console errors and zero uncaught page errors; and
 *   2. every <canvas> has non-uniform pixel data (i.e. the page actually drew
 *      something, rather than throwing before its first frame).
 *
 * It is a local dev script, committed and documented. It is NOT wired into CI
 * (which is Ruby-only, on a machine with no browser); wiring it in is a
 * reasonable follow-up.
 *
 * Usage:
 *   node scripts/smoke-guides.js                 # every guide page under _site
 *   node scripts/smoke-guides.js math/statistics  # only pages under this prefix
 *   node scripts/smoke-guides.js math/statistics/inference-loop
 *
 * Environment:
 *   PLAYWRIGHT_BROWSERS_PATH  browser install root (default: the Playwright cache)
 *   SMOKE_CHANNEL             force a launch channel, e.g. "chrome" or "chromium"
 *   SMOKE_HEADLESS=0          run headed (defaults to headless)
 *   SMOKE_TIMEOUT_MS          per-page timeout (default 20000)
 *
 * Requires the `playwright` (or `playwright-core`) npm package, which is not a
 * repo dependency — this is a Jekyll site with no npm build. If it cannot be
 * found the script prints instructions and exits 0 (a skip, not a failure). */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, '_site');
const PREFIX = (process.argv[2] || '').replace(/^\/+|\/+$/g, '');
const TIMEOUT = parseInt(process.env.SMOKE_TIMEOUT_MS || '20000', 10);

// ---------------------------------------------------------------------------
// Resolve Playwright, including from the npx cache, without installing anything.
// ---------------------------------------------------------------------------
function resolvePlaywright() {
  const candidates = ['playwright', 'playwright-core'];
  for (const name of candidates) {
    try { return { name, mod: require(name) }; } catch (e) { /* keep looking */ }
  }
  // npx keeps installs under ~/.npm/_npx/<hash>/node_modules
  try {
    const npxRoot = path.join(require('os').homedir(), '.npm', '_npx');
    if (fs.existsSync(npxRoot)) {
      for (const dir of fs.readdirSync(npxRoot)) {
        const nm = path.join(npxRoot, dir, 'node_modules');
        for (const name of candidates) {
          const p = path.join(nm, name);
          if (fs.existsSync(p)) return { name, mod: require(p) };
        }
      }
    }
  } catch (e) { /* fall through */ }
  return null;
}

const pw = resolvePlaywright();
if (!pw) {
  console.log('smoke-guides: playwright not found — skipping.');
  console.log('  Install it with:  npm i -g playwright   (or run via npx playwright)');
  console.log('  This script is a local dev aid; CI does not run it.');
  process.exit(0);
}
const { chromium } = pw.mod;

// ---------------------------------------------------------------------------
// Discover built pages.
// ---------------------------------------------------------------------------
function findPages(dir, out) {
  out = out || [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findPages(full, out);
    else if (entry.name === 'index.html') out.push(full);
  }
  return out;
}

if (!fs.existsSync(SITE)) {
  console.error('smoke-guides: _site does not exist — run `bundle exec jekyll build` first.');
  process.exit(1);
}
const pages = findPages(SITE)
  .map((f) => path.relative(SITE, f).split(path.sep).join('/'))
  .filter((rel) => rel.startsWith('math/') || rel.startsWith('ai/') || rel.startsWith('vision/') || rel === 'index.html')
  .filter((rel) => !PREFIX || rel.startsWith(PREFIX));
// Only the standalone guide documents carry canvases; skip the markdown hub pages.
if (!pages.length) {
  console.log('smoke-guides: no built pages matched "' + (PREFIX || '*') + '" under _site.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// A tiny static server for _site, stripping the /interactive-courses baseurl.
// ---------------------------------------------------------------------------
function contentType(p) {
  if (p.endsWith('.css')) return 'text/css';
  if (p.endsWith('.js')) return 'application/javascript';
  if (p.endsWith('.json')) return 'application/json';
  if (p.endsWith('.svg')) return 'image/svg+xml';
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.woff2')) return 'font/woff2';
  return 'text/html; charset=utf-8';
}
function serve(port) {
  const server = http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/' || url === '/interactive-courses' || url === '/interactive-courses/') url = '/index.html';
    if (url.startsWith('/interactive-courses/')) url = url.slice('/interactive-courses'.length);
    const file = path.join(SITE, path.normalize(url));
    if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': contentType(file) });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// ---------------------------------------------------------------------------
// Assertions run inside the page.
// ---------------------------------------------------------------------------
function canvasReport() {
  const out = [];
  for (const canvas of document.querySelectorAll('canvas')) {
    const rec = { id: canvas.id || '(unnamed)', ok: true, reason: '' };
    const w = canvas.width, h = canvas.height;
    if (!w || !h) { rec.ok = false; rec.reason = 'zero-sized backing store'; out.push(rec); continue; }
    // Plotly's 3D scenes (guide-plot3d.js) draw into a WebGL canvas, which has no
    // 2D context, so pixels cannot be sampled the way they are below. Those pages
    // are already covered by the console/page-error check; skip the blank test.
    let ctx2d = null;
    try { ctx2d = canvas.getContext('2d'); } catch (e) { ctx2d = null; }
    if (!ctx2d) {
      let gl = null;
      try { gl = canvas.getContext('webgl2') || canvas.getContext('webgl'); } catch (e) { gl = null; }
      if (gl) { rec.reason = 'webgl (pixel read skipped)'; out.push(rec); continue; }
      rec.ok = false; rec.reason = 'no 2D context'; out.push(rec); continue;
    }
    let data;
    try { data = ctx2d.getImageData(0, 0, w, h).data; }
    catch (e) { rec.ok = false; rec.reason = 'cannot read pixels: ' + e.message; out.push(rec); continue; }
    // Sample a grid of pixels; count distinct colours. A blank canvas is uniform.
    const seen = new Set();
    const stepX = Math.max(1, Math.floor(w / 40)), stepY = Math.max(1, Math.floor(h / 40));
    for (let y = 0; y < h; y += stepY) {
      for (let x = 0; x < w; x += stepX) {
        const i = (y * w + x) * 4;
        seen.add(data[i] + ',' + data[i + 1] + ',' + data[i + 2] + ',' + data[i + 3]);
      }
    }
    rec.colors = seen.size;
    if (seen.size < 2) { rec.ok = false; rec.reason = 'uniform (blank) canvas'; }
    out.push(rec);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
(async () => {
  const PORT = 8713;
  const server = await serve(PORT);
  const launchOpts = { headless: process.env.SMOKE_HEADLESS !== '0' };
  if (process.env.SMOKE_CHANNEL) launchOpts.channel = process.env.SMOKE_CHANNEL;
  else if (fs.existsSync('/Applications/Google Chrome.app')) launchOpts.channel = 'chrome';

  let browser;
  try {
    browser = await chromium.launch(launchOpts);
  } catch (e) {
    // Retry once without the channel, in case a bundled browser is installed.
    if (launchOpts.channel) {
      delete launchOpts.channel;
      browser = await chromium.launch(launchOpts);
    } else { throw e; }
  }

  let failures = 0, checked = 0;
  for (const rel of pages) {
    const url = 'http://127.0.0.1:' + PORT + '/interactive-courses/' + rel;
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
    page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
    let canvases = [];
    try {
      await page.goto(url, { waitUntil: 'load', timeout: TIMEOUT });
      await page.waitForTimeout(600); // let the first frame + deferred KaTeX settle
      canvases = await page.evaluate(canvasReport);
    } catch (e) {
      errors.push('navigation: ' + e.message);
    }
    // Surface canvas problems as errors, but only after the page itself loaded.
    for (const c of canvases) if (!c.ok) errors.push('canvas #' + c.id + ': ' + c.reason);
    checked++;
    const hasCanvas = canvases.length > 0;
    if (errors.length) {
      failures++;
      console.error('  FAIL ' + rel + (hasCanvas ? '' : ' (no canvas found)'));
      for (const e of errors) console.error('        ' + e);
    } else {
      console.log('  ok   ' + rel + '  (' + canvases.length + ' canvas' + (canvases.length === 1 ? '' : 'es') + ')');
    }
    await context.close();
  }

  await browser.close();
  server.close();
  console.log('');
  if (failures) { console.error('smoke-guides: ' + failures + ' of ' + checked + ' page(s) FAILED'); process.exit(1); }
  console.log('smoke-guides: all ' + checked + ' page(s) passed');
})().catch((e) => { console.error('smoke-guides: fatal: ' + (e && e.stack || e)); process.exit(1); });

// keep execSync referenced for future use without lint noise
void execSync;