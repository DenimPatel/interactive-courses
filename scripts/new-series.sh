#!/usr/bin/env bash
# Scaffold a brand-new guide series: its _data/series/<id>.yml, a hub page, and a
# registration under _data/sections.yml.
#
# Usage: scripts/new-series.sh <section> <series_id>
#   section   - an existing section id in _data/sections.yml (ai, vision, robotics, ...)
#   series_id - the new series' id, e.g. guide_kit_demo (becomes _data/series/guide_kit_demo.yml)
#
# After this runs:
#   - Add parts with scripts/new-part.sh <series_id> <slug> (the series starts with zero
#     parts, so the hub will render an empty grid until you add at least one).
#   - Fill in the hub page's REPLACE_* placeholders.

set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: $0 <section> <series_id>" >&2
  exit 1
fi

SECTION="$1"
SERIES_ID="$2"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERIES_FILE="$ROOT/_data/series/${SERIES_ID}.yml"
SECTIONS_FILE="$ROOT/_data/sections.yml"

if [ -f "$SERIES_FILE" ]; then
  echo "error: $SERIES_FILE already exists" >&2
  exit 1
fi

SLUG="${SERIES_ID//_/-}"
HUB="/${SECTION}/${SLUG}/"
HUB_FILE="$ROOT${HUB}index.md"

if [ -f "$HUB_FILE" ]; then
  echo "error: $HUB_FILE already exists" >&2
  exit 1
fi

# 1. The series YAML — starts with no parts; scripts/new-part.sh appends them.
cat > "$SERIES_FILE" <<EOF
# One source of truth for the REPLACE_WITH_TITLE guide's part list.
# Part numbers live here only - page descriptions/titles must not restate them.
hub: ${HUB}
title: REPLACE_WITH_TITLE
parts:
EOF
echo "Wrote $SERIES_FILE (title placeholder, zero parts — add parts with scripts/new-part.sh ${SERIES_ID} <slug>)."

# 2. The hub page.
mkdir -p "$(dirname "$HUB_FILE")"
cat > "$HUB_FILE" <<EOF
---
layout: series-hub
title: "REPLACE_WITH_TITLE"
description: "REPLACE_WITH_DESCRIPTION"
permalink: "${HUB}"
section: "${SECTION}"
series: "${SERIES_ID}"
---

REPLACE_WITH_INTRO_COPY
EOF
echo "Wrote $HUB_FILE."

# 3. Register the series under its section.
ruby -ryaml -rdate <<RUBY
doc = YAML.safe_load(File.read("$SECTIONS_FILE"), permitted_classes: [Date, Time])
sec = doc.find { |s| s['id'] == "$SECTION" }
abort "error: section '$SECTION' not found in $SECTIONS_FILE" unless sec
sec['series'] ||= []
sec['series'] << "$SERIES_ID" unless sec['series'].include?("$SERIES_ID")
File.write("$SECTIONS_FILE", doc.to_yaml.sub(/\A---\n/, ''))
RUBY
echo "Registered '${SERIES_ID}' under section '${SECTION}' in $SECTIONS_FILE."
echo
echo "NOTE: rewriting sections.yml through YAML round-trips it and may reformat comments"
echo "or quoting style - diff $SECTIONS_FILE before committing and fix up by hand if needed."
