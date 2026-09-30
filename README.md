# Interactive Courses

A Jekyll site published by GitHub Pages at
https://denimpatel.github.io/interactive-courses/. It holds every hand-written
interactive guide:

- **AI** — LLM Training (15 parts), LLM Serving (20), Building with LLMs (17),
  Agents in Action (19), Generative Media (20), Multimodal Models (16).
- **Vision & Geometry** — Multi-View Geometry (20), Nonlinear Optimization (5),
  Lie Groups & Lie Algebras (12), plus the Guide Kit Demo.
- **Math** — Linear Algebra (22), Calculus (14), Calculus in Motion (14),
  Probability (20), Probability in Action (20), Statistics (32).

267 parts across 16 guides. Every guide is a standalone `<!DOCTYPE html>` page of
hand-written `<canvas>` and vanilla JS — no framework, no npm, no build step beyond
Jekyll.

## Building it

```bash
export LANG=C.UTF-8 LC_ALL=C.UTF-8    # Ruby defaults to US-ASCII here; the build dies on
                                        # the site's em-dashes without this

bundle install                         # first time only
bundle exec jekyll build --safe --trace
bundle exec jekyll serve               # local preview at http://localhost:4000/interactive-courses/
```

Run the link check before and after any page move — the failure count must not increase:

```bash
bundle exec htmlproofer _site --disable-external --swap-urls '^/interactive-courses:' \
  --ignore-empty-alt --no-enforce-https
```

And the content linter, which enforces the conventions below (warn-only on files that
already existed before your change, fails only on new/changed files):

```bash
ruby scripts/lint-content.rb
```

The rendered-page smoke test loads every built guide in a real browser and fails on
console errors and blank canvases. It is a local dev aid, not part of CI:

```bash
node scripts/smoke-guides.js                 # every guide page
node scripts/smoke-guides.js math/statistics  # only pages under this prefix
```

CI (`.github/workflows/ci.yml`) runs the build, the internal link check and the linter on
every push and PR. `.github/workflows/pages.yml` builds and deploys the site.

## Adding content

Almost nothing structural is written by hand in a page — `_data/` is the source of truth
(see `CLAUDE.md` for the full map). Use the scaffolding scripts rather than copy-pasting
an existing page:

| To add... | Run |
|---|---|
| A part to an existing guide series | `scripts/new-part.sh <series_id> <slug>` |
| A brand-new guide series | `scripts/new-series.sh <section> <series_id>` |

Each writes from a template in `_templates/` and leaves `REPLACE_*` placeholders for you
to fill in; none of them touch an existing file (`new-series.sh` does rewrite
`_data/sections.yml` through a YAML round-trip to register the series — diff it before
committing).

New guide pages should build on the guide kit — `_includes/guide-head.html`,
`_includes/guide-footer.html`, `assets/css/guide.css`, `assets/js/guide-core.js`,
`assets/js/guide-math.js`, `assets/js/guide-plot3d.js` — rather than pasting a new
`<style>`/`<script>` block. See `CLAUDE.md` for the full architecture.

## Cross-repo sync

The companion repo's homepage reads `_data/guide_index.yml`, which is generated from this
repo. After adding, removing or renaming a part here, run this in a `denimpatel/AI`
checkout and commit the result:

```bash
ruby scripts/sync-guides.rb /path/to/interactive-courses
```

See `CLAUDE.md` for everything else: the page shapes, the `{% raw %}` gotchas,
`baseurl`/`relative_url` rules, the cross-repo link rules and front-matter conventions.
