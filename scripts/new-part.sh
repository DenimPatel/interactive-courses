#!/usr/bin/env bash
# Add a new part to an existing guide series.
#
# Usage: scripts/new-part.sh <series_id> <slug>
#   series_id  - the _data/series/<series_id>.yml file to extend (e.g. llm_training)
#   slug       - the last path segment for the new page's permalink
#
# What it does:
#   1. Appends a new entry to _data/series/<series_id>.yml with num = (current max num) + 1.
#   2. Writes the page from _templates/guide-part.html at the series' directory + /<slug>/index.html.
#   3. Reports any "<N>-part" strings elsewhere in the repo that mention this series by
#      name, so you can update them by hand (scripts/lint-content.rb also catches these).
#
# This only touches new files plus one appended YAML entry - it never edits an existing
# page. Fill in the REPLACE_* placeholders in the new page and YAML entry before publishing.

set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: $0 <series_id> <slug>" >&2
  exit 1
fi

SERIES_ID="$1"
SLUG="$2"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERIES_FILE="$ROOT/_data/series/${SERIES_ID}.yml"
TEMPLATE="$ROOT/_templates/guide-part.html"

if [ ! -f "$SERIES_FILE" ]; then
  echo "error: $SERIES_FILE does not exist. Use scripts/new-series.sh to create a new series." >&2
  exit 1
fi

# Derive the series' base URL directory from the `hub:` key (e.g. /ai/llm-training/).
HUB=$(ruby -ryaml -rdate -e "
doc = YAML.safe_load(File.read('$SERIES_FILE'), permitted_classes: [Date, Time])
puts doc['hub']
")
NEXT_NUM=$(ruby -ryaml -rdate -e "
doc = YAML.safe_load(File.read('$SERIES_FILE'), permitted_classes: [Date, Time])
parts = doc['parts'] || []
puts (parts.map { |p| p['num'].to_i }.max || -1) + 1
")

PERMALINK="${HUB}${SLUG}/"
PAGE_DIR="$ROOT$(echo "$PERMALINK" | sed 's:/*$::')"
PAGE_FILE="$PAGE_DIR/index.html"

if [ -f "$PAGE_FILE" ]; then
  echo "error: $PAGE_FILE already exists" >&2
  exit 1
fi

# 1. Append the new part to the series YAML.
cat >> "$SERIES_FILE" <<EOF
  - num: ${NEXT_NUM}
    title: "REPLACE_WITH_TITLE"
    short: "Part ${NEXT_NUM}"
    permalink: ${PERMALINK}
    blurb: "REPLACE_WITH_ONE_LINE_BLURB"
    # A brand-new part has no legacy URL to redirect from — add a `legacy:` key
    # (and a matching redirect_from: on the page) only if this replaces an old page.
EOF
echo "Appended part ${NEXT_NUM} to $SERIES_FILE (fill in the REPLACE_* placeholders)."

# 2. Write the page from the template, substituting what we know.
mkdir -p "$PAGE_DIR"
sed \
  -e "s#REPLACE_SERIES_ID#${SERIES_ID}#g" \
  -e "s#REPLACE/WITH/PERMALINK#$(echo "$PERMALINK" | sed 's:^/::;s:/$::')#g" \
  "$TEMPLATE" > "$PAGE_FILE"
echo "Wrote $PAGE_FILE from $TEMPLATE (fill in the REPLACE_* placeholders, including section:)."

# 3. Point out "<N>-part" counters that likely need bumping.
echo
echo "Counter strings possibly referring to this series (check by hand, or rely on"
echo "scripts/lint-content.rb to catch stale ones once you commit):"
grep -rn "[0-9]\+-part" "$ROOT" \
  --include="*.md" --include="*.html" --include="*.yml" \
  --exclude-dir=_site --exclude-dir=.git --exclude-dir=vendor \
  | grep -i "${SERIES_ID//_/[ -]}" || echo "  (none found by name match - search manually if the series has another common name)"
