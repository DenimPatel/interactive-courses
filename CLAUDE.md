# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Jekyll site published by GitHub Pages at https://denimpatel.github.io/interactive-courses/.
It holds every hand-written interactive guide: 16 series, 267 parts, across three subjects
(`ai`, `vision`, `math`).

It is a self-contained site: it holds every hand-written interactive guide and
nothing else, and it links to nothing outside itself. The AI record pages, the
field notes and the blog live in `DenimPatel/AI` and are not reachable from
here. The two repos shared chrome (`_includes/site-nav.html`,
`_includes/guide-footer.html`, `assets/css/styles.css`, `assets/favicon.svg`)
rather than sharing a submodule; that duplication is historical and is being
retired, so do not add to it.

There is no JavaScript framework, no npm, and no build step beyond Jekyll. CI
(`.github/workflows/ci.yml`) runs a build, an internal link check and a content linter;
`.github/workflows/pages.yml` builds and deploys.

Content is the great majority of the repo and is made of hand-written `<canvas>` and
vanilla JS. Treat the guide pages as the crown jewels: they are fragile, they are not
covered by a unit-test suite, and a change you cannot see rendered is a change you cannot
verify. Two scripts make that checkable — `scripts/check-stats-viz.js` and
`scripts/check-genmedia-viz.js` assert numerics, and `scripts/smoke-guides.js` loads every
built page in a real browser.

## Commands

```bash
export LANG=C.UTF-8 LC_ALL=C.UTF-8    # see "UTF-8" below — the build fails without this

bundle install                         # first time only; installs the github-pages gem set
bundle exec jekyll build --safe --trace
bundle exec jekyll serve               # local preview at http://localhost:4000/interactive-courses/

# link check — run before and after any move; the failure count must not increase
bundle exec htmlproofer _site --disable-external --swap-urls '^/interactive-courses:' \
  --ignore-empty-alt --no-enforce-https

# content linter — warn-only on files that existed before your change, fails only on
# new/changed files (diffed against the default branch); see scripts/lint-content.rb
ruby scripts/lint-content.rb

# rendered-page smoke test: loads built pages from _site in a real browser, fails on
# console/page errors and blank canvases. Local dev aid, NOT in CI. Pass a path prefix
# to scope it.
node scripts/smoke-guides.js
node scripts/smoke-guides.js math/statistics

# numerics self-checks for the domain layers (no test framework in the repo)
node scripts/check-stats-viz.js        # statistics domain layer
node scripts/check-genmedia-viz.js     # generative-media / multimodal domain layer
node scripts/check-llm-app-sim.js      # LLM application simulator
node scripts/check-lie-viz.js          # Lie groups domain layer (Exp/Log, Jacobians, adjoints)
```

`--safe` matches the GitHub Pages sandbox and rejects non-whitelisted plugins, so always
build with it. `--swap-urls '^/interactive-courses:'` strips the `baseurl` so html-proofer
can resolve links against `_site`.

**UTF-8:** Ruby defaults to a US-ASCII external encoding in this environment, and the build
dies with `Invalid US-ASCII character "\xE2"` on the site's em-dashes. Export `LANG` and
`LC_ALL` as above. GitHub Pages builds with UTF-8, so this is a local-only concern.

## Architecture

### `_data/` is the source of truth, not the pages

Almost nothing structural is written by hand in a page. Before editing markup, check
whether the thing you want to change is generated:

| File | Owns |
|---|---|
| `_data/sections.yml` | The three guide subjects (`ai`, `vision`, `math`) and, per subject, the ordered list of series ids. Drives the nav, the homepage doors and the section hubs. |
| `_data/series/*.yml` | Each guide's ordered part list: `num`, `title`, `short`, `permalink`, the `legacy` URL each part redirects from, `blurb`, and an optional `acts:` grouping. Also `appendix:` (glossary-style reference pages) and `hub:`. |

**Part numbers live only in `_data/series/*.yml`.** Do not restate them in a page's
`description` or `title`; five descriptions previously carried numbers that contradicted
the nav. `scripts/lint-content.rb` checks both for new/changed pages.

To add a part to a guide: add the entry to the series YAML *and* create the page. The nav,
the prev/next block, the hub card grid, the section hub and the homepage all follow
automatically. Then tell the companion repo to re-sync (see below).

### After changing a guide, sync the companion repo

`DenimPatel/AI` cannot read this repo's `_data/series` at build time, so its homepage
counters and its old-URL redirect stubs are generated from a checkout of this repo. After
adding, removing, renaming or re-permaling any part, run this **in the AI checkout** and
commit the result:

```bash
ruby scripts/sync-guides.rb /path/to/interactive-courses
```

That is the only cross-repo obligation. The AI repo's `CLAUDE.md` documents the same step
from its side.

### Page shapes

1. **Standalone interactive guides** (`ai/llm-training/*/index.html`,
   `vision/{multi-view-geometry,nonlinear-optimization}/*/index.html`,
   `vision/lie-theory/*/index.html`,
   `math/{linear-algebra,calculus,calculus-in-motion,probability,probability-in-action,statistics}/*/index.html`).
   These have **no `layout:`** — each is a complete `<!DOCTYPE html>` document with its own
   `<head>` and its own page-specific `<style>` block. They pull in shared chrome explicitly:
   ```liquid
   {% include site-nav.html %}
   {% include series-nav.html series=site.data.series.<series_id> %}
   ...
   {% include series-prevnext.html series=site.data.series.<series_id> %}
   ```
   Because they bypass `_layouts/default.html`, anything added to that layout will **not**
   appear on them. Changes to global chrome usually need to touch `_includes/site-nav.html`
   (shared) rather than the layout.
2. **Series hubs** (`<series>/index.md`, `layout: series-hub`) and **section hubs**
   (`ai/index.md`, `vision/index.md`, `math/index.md`, `layout: section-hub`). Normal
   Jekyll; both read `_data/series/*.yml` and `_data/sections.yml`.

### `{% raw %}` blocks in the guides

The guides wrap their JS in `{% raw %}` so Liquid ignores `${...}` template literals. Prose
containing `{{ '/path/' | relative_url }}` sometimes falls **inside** those blocks, where it
renders as literal `{{ }}` text — a class of bug that shipped to production. If a link must
sit inside a raw region, step out for that line:

```liquid
{% endraw %}<p>... <a href="{{ '/vision/…/' | relative_url }}">link</a> ...</p>{% raw %}
```

### URLs, `baseurl` and cross-repo links

The site is served under `baseurl: /interactive-courses`, so every internal link must go
through `relative_url`; a bare `href="/foo/"` will 404 in production. Runtime JS must get
its URLs from Liquid too — the guides do this by emitting
`var VOCAB_URL = "{{ '/assets/data/…' | relative_url }}";`.

**Never link off this site.** A guide is either read or left; there is no fourth
destination. The site is closed over this repo — the nav, the footer, the
homepage and every guide body link only to `{{ relative_url }}` paths or to a
part of this project. `scripts/check-no-external-links.js` fails the build if a
`https://denimpatel.github.io/AI/` URL or a `github.com/DenimPatel/AI` URL
reappears anywhere. If a guide needs a piece of writing that used to live in the
other repo, either link to the equivalent part here or write the sentence to
stand on its own — do not reach across.

**Never break a URL.** Guide parts keep their pre-Jekyll `legacy` URL in `redirect_from:`,
and `jekyll-redirect-from` emits a stub there. If you move a part, add its old permalink to
`redirect_from`. The old `/AI/...` guide URLs are covered by generated stubs in the AI repo
(see the sync step above) — don't try to redirect across repos from here.

### Front matter must be quoted

Quote every string value. Unquoted `description:` values containing `": "` are invalid YAML
and silently break the meta description.

## The guide kit

`_includes/guide-head.html`, `_includes/guide-footer.html`, `assets/css/guide.css`,
`assets/js/guide-core.js`, `assets/js/guide-math.js`, `assets/js/guide-plot3d.js` and
`assets/js/guide-quiz.js` are a subject-neutral layer shared by the newer series. The rule
is: **generic primitives go in the kit, domain-shaped code goes in the series file.**

- `guide-core.js` (`window.Guide`) — canvas setup, bar/line/stacked-bar/heatmap/column
  charts, an animation loop, slider binding, formatting, hit-testing, `Guide.niceTicks`,
  `Guide.fmtPct`, `Guide.gaussianFrom`, `Guide.lerpColor`, `Guide.seededRandom`.
- `guide-math.js` (`window.GuideMath`) — the vector/matrix math the vision guides re-derive
  per page.
- `guide-plot3d.js` — the Plotly cube scene.
- `guide-quiz.js` (`window.GuideQuiz`) — the "check your understanding" section every
  `/math/` part ends with. Two question kinds (`choice`, `numeric`); each page authors its
  own `QUIZ_QUESTIONS` inline next to the demo it tests. Progress is one versioned
  localStorage key (`guide:quiz:v1`), read/written defensively, driving a per-page
  "X/Y answered" badge — there is no cross-page rollup.

**This is additive only.** The 26 multi-view-geometry and nonlinear-optimization pages keep
their own inline `<style>` blocks and per-page scripts exactly as they are — don't migrate
them to the guide kit opportunistically. Likewise `llm-guide.css`/`llm-guide.js` stay as
they are; the 16 LLM-training pages keep using `window.LLMG`, not
`window.Guide`/`window.GuideMath`. The one exception is the quiz: every LLM-training part also
links `guide.css` and loads `guide-quiz.js` so it can end with the shared "check your
understanding" section (its section carries both `llmt-step` and `g-step`, because
`GuideQuiz` finds its badge via `.g-step`). The kit exists so a genuinely new guide page is cheap to
start, not to unify what already ships. `vision/guide-kit-demo/` is a small demo series
proving the kit renders — not real content, kept as a working example.

Per-series domain layers sit on top, following the same split:

- `assets/js/linalg-viz.js` (`window.LinAlg`) — an N-dimensional matrix library (LU, QR,
  SVD, pseudoinverse, eigen) and a reusable 2D cartesian `plane` widget. It is loaded by the
  statistics pages too (for `LinAlg.mat.*` and `LinAlg.plane`), so treat its public surface
  as stable. `LinAlg.mat.svd` is one-sided Jacobi, not `eig(AᵀA)`, because that squares the
  condition number and Part 19 of the linear-algebra guide deliberately constructs
  near-singular matrices.
- `assets/js/prob-viz.js` (`window.Prob`) — seeded RNG and the standard
  discrete/continuous families, special functions (`erf`, `erfinv`, `lgamma`,
  `regIncGamma`, `regIncBeta`, `logChoose`), `Prob.hist`, multivariate normal, Markov
  chains, entropy/KL/mutual information, the histogram/Kalman/EKF/particle filters,
  Metropolis/Gibbs/HMC. `Prob.plot` is deliberately **not** `LinAlg.plane`: the plane widget
  captures its ranges at construction, and probability demos rescale constantly, so
  `Prob.plot` adds `setRange`, `area` and `steps`. Every stochastic demo draws through
  `Prob.rng`, never `Math.random()`.
- `assets/js/stats-viz.js` (`window.Stats`) — the special functions the repo otherwise
  lacks, seeded samplers and `{pdf,cdf,quantile,mean,var}` for every distribution the
  statistics series draws from, estimators, resampling, classical tests, Bayesian helpers,
  recursive filters, ML/causal metrics, and `Stats.plot(canvas, opts)` with the same
  `px/py/wx/wy` and `handles(specsOrFn, onChange)` contract as `LinAlg.plane`.
- `assets/js/genmedia-viz.js` (`window.GenMedia`, shared by both media volumes),
  `assets/js/diffusion-viz.js` (`window.Diffusion`, volume I) and
  `assets/js/multimodal-viz.js` (`window.Multimodal`, volume II) — seeded MLP with
  hand-written backprop, `GenMedia.dsp` (FFT/STFT/mel/RVQ), `GenMedia.attn`, the diffusion
  schedules/solvers/flow matching/guidance, and the ViT/CLIP/retrieval helpers.
- `assets/js/serving-sim.js`, `assets/js/llm-app-sim.js`, `assets/js/calc-viz.js` — the LLM
  Serving, LLM application and calculus domain layers.
- `assets/js/lie-viz.js` (`window.Lie`) and `assets/css/lie-guide.css` — the Lie Groups &
  Lie Algebras series (`vision/lie-theory/`): SO(2)/SO(3)/SE(2)/SE(3) hat, vee, Exp, Log
  (with the near-0 and near-π branches), adjoints, right/left Jacobians (SE(3) via Barfoot's
  Q block), quaternions, Euler angles, `Lie.numJac` for tangent-space central differences,
  Kabsch/Horn alignment, and `Lie.view3d`, a small orthographic canvas with drag-to-orbit.
  Conventions are translation-first twists and right perturbations. Its numerics are
  asserted by `scripts/check-lie-viz.js`; extend that script whenever you add a formula.
  `lie-guide.css` also makes `.g-math.g-katex` and `.g-table-wrap` positioned, because
  KaTeX's absolutely positioned MathML otherwise escapes their `overflow-x` and widens the
  page on phones.

## Assets

`assets/css/theme.css` is the design system: every colour, type step, space step, radius and
duration is a token there, declared once, with light and dark as two sets of the same slots.
No other file in this repo should contain a raw hex, a bare `rem` used as a space, or a bare
`ms` — if one seems necessary, that is a finding, not a decision to make locally.

`theme.css` also republishes this repo's older token names (`--color-*`, `--font-*`,
`--radius-*`, `--space-*`, `--shadow-*`, `--glass-*`) as indirections onto the new palette.
Those names are a contract, not a style choice: ~260 part pages that carry their own inline
`<style>` blocks reference them, so changing a name breaks pages that were never touched.
Add a token in `theme.css`; do not rename one.

The rest of the layer, in the order it must be linked:

| File | Role |
| --- | --- |
| `assets/css/theme.css` | tokens. First, so any later sheet can override a value. |
| `assets/css/styles.css` | site chrome, cards, prose, footer, home page. |
| `assets/css/guide.css` | the `.g-` guide kit: steps, demos, controls, quizzes. |
| `assets/css/llm-guide.css` | the same kit under `llmt-`, for the LLM pages. |
| `assets/css/lie-guide.css` | the LIE series. |
| `assets/css/chrome.css` | nav, settings dialog, mobile drawer. Last, so it beats `styles.css`. |

`node scripts/check-stylesheet-order.js` enforces that order (`--fix` repairs it), because
the two ends are load-bearing: tokens first or nothing can override them, chrome last or the
nav has to fight `styles.css` with `!important`.

### Light and dark

`data-theme` on `<html>` is the source of truth and always holds a resolved value, never
`system`. `_includes/theme-boot.html` writes it, plus the `--pref-*` properties, from an
inline script before first paint, so a reader who chose Dark never sees a light frame. It is
ES5 on purpose — it is inlined into every page. `assets/js/preferences.js` then takes over,
exposes `window.ICTheme`, and dispatches `ic:prefs` / `ic:theme` on `document`.

`theme.css` also carries a `@media (prefers-color-scheme: dark)` block scoped to
`:root:not([data-theme])`, so a reader whose JavaScript never runs still gets the mode their
OS asks for. An explicit choice always wins.

Canvas code cannot resolve CSS custom properties, so `assets/js/theme-tokens.js` provides a
global `THEME` (`ink`, `token`, `alpha`, `series`, `palette`) that reads the tokens at draw
time. It is loaded as a **synchronous** `<script src>` in every head, before anything can
paint, because a page's inline script may paint during parse. In a page's own inline script,
write `ctx.fillStyle = THEME.ink('#2b5fff')`; in its inline `<style>`, write
`color: var(--c-fg-muted)`. Never `var()` a canvas paint, and never leave a hex where
`THEME.ink` already has a mapping — an unmapped literal is a colour that will not follow the
theme.

### Checks

`scripts/` holds the numerics tests (`check-*-viz.js`, `check-llm-app-sim.js`), which assert
on the *text* of the drawing code and so are sensitive to how it is edited. The theme layer
added three more, all of which run against the built site:

- `check-inline-scripts.js` — compiles every inline `<script>` the way a browser does. A
  top-level `return` is legal in CJS and fatal in a browser, so a boot script missing its
  IIFE opener is discarded in full, silently, on every page.
- `check-stylesheet-order.js` — the link order above.
- `inject-skip-target.js` — every content page's `<main>` needs `id="main"`, which is the
  skip link's target. A page without it gets a skip link that moves focus nowhere.

The JSON files under `assets/data/` are fetched at runtime by the LLM and multimodal guides.
There are no local images — all raster images are hotlinked to
`roboticswithdenim.wordpress.com` and will disappear if that blog goes down.

The multi-view-geometry and nonlinear-optimization pages each carry a large inline
`<style>` block. These look duplicated but are not: pages deliberately override shared
selectors with per-page values (`.mvg-plot3d` height varies across pages), and only a
subset of rules are byte-identical. Extracting them to a shared stylesheet reorders the
cascade for a small payoff — this was considered and rejected.

## Adding new content

Use the scaffolding scripts rather than copy-pasting an existing page — each writes from a
template in `_templates/`, leaves `REPLACE_*` placeholders, and never edits an existing file
(`scripts/new-series.sh` is the one exception: it rewrites `_data/sections.yml` through a
YAML round-trip to register the new series, which can reformat comments/quoting elsewhere
in the file — diff it before committing).

- `scripts/new-part.sh <series_id> <slug>` — appends a part to `_data/series/<series_id>.yml`
  and writes the page from `_templates/guide-part.html`.
- `scripts/new-series.sh <section> <series_id>` — creates a new `_data/series/<id>.yml`, a
  hub page (`layout: series-hub`), and registers it under `_data/sections.yml`.

`_templates/guide-part.html` scaffolds an empty quiz section by default (`GuideQuiz` renders
"coming soon" for an empty array), so every new part gets the slot; fill in real questions
before shipping the page.

Field notes, the blog and the AI record pages live in the companion `DenimPatel/AI` repo —
use `scripts/new-note.sh` there.

## Conventions

- The `theme:` key is explicitly `null`. The `github-pages` gem injects
  `jekyll-theme-primer` by default; every layout here is local, so it is disabled.
- `Gemfile.lock` is gitignored — GitHub Pages resolves its own gem set.
