#!/usr/bin/env ruby
# frozen_string_literal: true

# Content lint for the Jekyll site.
#
# Checks (see CLAUDE.md for the rules these enforce):
#   1. Front matter has title/description/permalink/section, and string values are quoted.
#   2. No part number is restated in a page's description.
#   3. A title's "Part N" matches the series YAML `num` for that page's permalink.
#   4. Every "<N>-part" string in the repo equals the real part count of the series it names.
#   5. Every series-YAML permalink resolves to an existing page, and vice versa.
#   6. No bare href="/..." outside a `relative_url` filter.
#   7. No literal `{{` / `{%` surviving inside a `{% raw %}...{% endraw %}` region.
#   8. Every series YAML `legacy` permalink appears in some page's `redirect_from`.
#
# This is warn-only for files that already existed on origin/main — the goal is to stop
# NEW problems, not to force a mass cleanup of the existing 250k-word site in one pass.
# It fails (non-zero exit) only when a violation is found in a file that is new or has
# changed relative to origin/main (git diff --name-only origin/main...HEAD).

require 'yaml'
require 'date'
require 'set'
require 'find'

def safe_load_yaml(text)
  YAML.safe_load(text, permitted_classes: [Date, Time], aliases: true)
rescue StandardError
  nil
end

ROOT = File.expand_path('..', __dir__)
Dir.chdir(ROOT)

def changed_files
  # The base branch differs per repo: `main` in denimpatel/AI, and whatever
  # GitHub sets as this repo's default. Prefer the remote default branch, then
  # origin/main, then the previous commit, so the linter still has a meaningful
  # diff on the very first push (when no default branch exists yet).
  base = ''
  candidates = []
  head_ref = `git symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null`.strip
  candidates << head_ref.sub(%r{\Arefs/remotes/}, '') unless head_ref.empty?
  candidates += %w[origin/main origin/master HEAD^]
  candidates.each do |c|
    next if c.empty?
    if system("git rev-parse --verify -q #{c} >/dev/null 2>&1")
      base = c
      break
    end
  end
  files = Set.new
  unless base.empty?
    sha = `git merge-base HEAD #{base} 2>/dev/null`.strip
    sha = base if sha.empty?
    committed = `git diff --name-only #{sha}...HEAD 2>/dev/null`
    files.merge(committed.lines.map(&:strip).reject(&:empty?)) if $?.exitstatus.zero?
  end
  # Also treat anything currently staged/unstaged/untracked in the working tree as
  # "changed", so this catches problems before they're even committed.
  worktree = `git status --porcelain 2>/dev/null`
  worktree.each_line do |line|
    path = line[3..].to_s.strip
    next if path.empty?
    files << path
  end
  files
rescue StandardError
  Set.new
end

CHANGED = changed_files

violations = [] # [path, message, changed?]

def add(violations, path, msg)
  violations << [path, msg, CHANGED.include?(path)]
end

# ---------------------------------------------------------------------------
# Gather content pages (markdown / html with front matter) and guide pages.
# ---------------------------------------------------------------------------

def front_matter_pages
  pages = []
  Find.find('.') do |path|
    Find.prune if path.start_with?('./.git', './_site', './vendor', './.claude', './.jekyll-cache')
    next unless File.file?(path)
    next unless path =~ /\.(md|markdown|html)$/
    rel = path.sub(%r{\A\./}, '')
    text = File.read(rel, encoding: 'UTF-8')
    next unless text.start_with?("---\n") || text.start_with?("---\r\n")
    parts = text.split(/^---\s*$/, 3)
    next if parts.length < 3
    raw_fm = parts[1]
    body = parts[2]
    pages << { path: rel, raw_fm: raw_fm, body: body }
  end
  pages
end

PAGES = front_matter_pages

# ---------------------------------------------------------------------------
# 1. Front matter presence + quoting
# ---------------------------------------------------------------------------

REQUIRED_GUIDE_KEYS = %w[title description permalink section].freeze

PAGES.each do |pg|
  path = pg[:path]
  fm = begin
    safe_load_yaml(pg[:raw_fm]) || {}
  rescue Psych::SyntaxError => e
    add(violations, path, "front matter is not valid YAML: #{e.message}")
    next
  end
  next unless fm.is_a?(Hash)

  # Only enforce the full required-key set on pages that look like guide/content
  # pages (i.e. carry at least one of these keys already) - not every markdown
  # file in the repo is expected to have all four (e.g. redirect stub pages).
  looks_like_content_page = (fm.keys & REQUIRED_GUIDE_KEYS).any?
  if looks_like_content_page
    REQUIRED_GUIDE_KEYS.each do |key|
      unless fm.key?(key)
        add(violations, path, "front matter missing required key `#{key}`")
      end
    end
  end

  # Quoting: re-scan the raw front matter text line by line for unquoted string
  # values that contain ": " (the historical bug) or other YAML-unsafe chars.
  pg[:raw_fm].each_line do |line|
    next if line.strip.empty? || line.strip.start_with?('#')
    next if line.strip.start_with?('-') # list items checked loosely
    m = line.match(/\A(\s*)([A-Za-z0-9_]+):\s*(.+?)\s*\z/)
    next unless m
    key = m[2]
    value = m[3]
    next if value.start_with?('"') || value.start_with?("'")
    next if value =~ /\A(true|false|null|~|\d+(\.\d+)?)\z/
    next if value.start_with?('[') || value.start_with?('{')
    if value.include?(': ') || value.include?('#')
      add(violations, path, "front matter key `#{key}` has an unquoted value containing \": \" or \"#\" (must be quoted): #{value.inspect}")
    end
  end
end

# ---------------------------------------------------------------------------
# Load series data
# ---------------------------------------------------------------------------

SERIES = {}
Dir.glob('_data/series/*.yml').each do |f|
  id = File.basename(f, '.yml')
  doc = safe_load_yaml(File.read(f, encoding: 'UTF-8'))
  # Each series file is a Hash with a `parts:` list (num/title/permalink/legacy/blurb).
  SERIES[id] = doc.is_a?(Hash) ? (doc['parts'] || []) : (doc || [])
end

# path -> permalink for every page (front-matter or otherwise)
PERMALINK_TO_PATH = {}
PAGES.each do |pg|
  fm = safe_load_yaml(pg[:raw_fm])
  next unless fm.is_a?(Hash) && fm['permalink']
  PERMALINK_TO_PATH[fm['permalink']] = pg[:path]
end

# ---------------------------------------------------------------------------
# 2 & 3. Part numbers: not restated in description, "Part N" matches series num
# ---------------------------------------------------------------------------

SERIES.each do |series_id, parts|
  next unless parts.is_a?(Array)
  parts.each do |part|
    next unless part.is_a?(Hash)
    permalink = part['permalink'] || part['url']
    num = part['num']
    next unless permalink && num

    path = PERMALINK_TO_PATH[permalink]
    next unless path

    pg = PAGES.find { |p| p[:path] == path }
    next unless pg

    fm = safe_load_yaml(pg[:raw_fm])
    next unless fm.is_a?(Hash)

    desc = fm['description'].to_s
    title = fm['title'].to_s

    if desc =~ /\bpart\s*#{num}\b/i || desc =~ /\b#{num}(st|nd|rd|th)?\s*of\s*\d+\b/i
      add(violations, path, "description restates the part number (#{num}); part numbers live only in _data/series/#{series_id}.yml")
    end

    if title =~ /\bpart\s*(\d+)\b/i
      title_num = $1.to_i
      if title_num != num.to_i
        add(violations, path, "title says \"Part #{title_num}\" but _data/series/#{series_id}.yml has num: #{num} for this permalink")
      end
    end
  end
end

# ---------------------------------------------------------------------------
# 4. "<N>-part" strings must equal the real part count of the series they name
# ---------------------------------------------------------------------------

SERIES_PART_COUNT = SERIES.transform_values { |v| v.is_a?(Array) ? v.length : 0 }

# Map a loose series name fragment -> series id, for matching prose like "16-part
# LLM training guide" or "13-part multi-view geometry guide".
SERIES_NAME_HINTS = {
  'llm_training' => /llm[\s-]*training/i,
  'llm_serving' => /llm[\s-]*serving/i,
  'multi_view_geometry' => /multi[\s-]*view[\s-]*geometry/i,
  'nonlinear_optimization' => /nonlinear[\s-]*optimization/i,
  'linear_algebra' => /linear[\s-]*algebra/i,
  # The two probability volumes share the word "probability", so their hints
  # are deliberately disjoint: only the full volume titles match.
  'probability' => /probability,\s*interactively/i,
  'probability_in_action' => /probability\s+in\s+action/i,
  # The two calculus series share the word "calculus", so their hints are
  # deliberately disjoint: only the full volume titles match. "N-part calculus"
  # on its own is intentionally left unpoliced rather than mis-attributed.
  'calculus' => /calculus,\s*interactively/i,
  'calculus_in_motion' => /calculus\s+in\s+motion/i,
  'statistics' => /statistics,\s*interactively/i,
  # The two LLM-application volumes are named by their full titles so an
  # "N-part" counter is attributed to the right one.
  'building_with_llms' => /building\s+with\s+llms/i,
  'agents_in_action' => /agents\s+in\s+action/i,
  # The generative-media and multimodal volumes share the phrase "interactively"
  # with every other volume title, so their hints are deliberately disjoint and
  # match only the full volume titles.
  'generative_media' => /generative\s+media,\s*interactively/i,
  'multimodal' => /multimodal\s+models,\s*interactively/i
}.freeze

Find.find('.') do |path|
  Find.prune if path.start_with?('./.git', './_site', './vendor', './.claude', './.jekyll-cache', './assets')
  next unless File.file?(path)
  next unless path =~ /\.(md|markdown|html|yml|yaml)$/
  rel = path.sub(%r{\A\./}, '')
  text = File.read(rel, encoding: 'UTF-8')
  text.scan(/(\d+)-part\b([^\n]{0,80})/i).each do |num_str, context|
    n = num_str.to_i
    matched_series = SERIES_NAME_HINTS.find { |_id, re| context =~ re }
    next unless matched_series
    series_id, = matched_series
    expected = SERIES_PART_COUNT[series_id]
    next unless expected
    if n != expected
      add(violations, rel, "says \"#{n}-part\" for #{series_id}, but _data/series/#{series_id}.yml has #{expected} parts")
    end
  end
end

# ---------------------------------------------------------------------------
# 5. Series permalinks <-> pages
# ---------------------------------------------------------------------------

SERIES.each do |series_id, parts|
  next unless parts.is_a?(Array)
  parts.each do |part|
    next unless part.is_a?(Hash)
    permalink = part['permalink'] || part['url']
    next unless permalink
    unless PERMALINK_TO_PATH.key?(permalink)
      add(violations, "_data/series/#{series_id}.yml", "permalink #{permalink} has no page with matching front-matter permalink")
    end
  end
end

# ---------------------------------------------------------------------------
# 6. No bare href="/..." outside relative_url
# ---------------------------------------------------------------------------

PAGES.each do |pg|
  path = pg[:path]
  pg[:body].each_line.with_index(1) do |line, lineno|
    # Flag href="/something" where the value is a literal path, not built via
    # a Liquid filter on the same line (relative_url / absolute_url) and not an
    # external/protocol-relative/anchor link.
    line.scan(/href="(\/[^"]*)"/).each do |(val)|
      next if val.start_with?('//')
      next if line.include?('relative_url') || line.include?('absolute_url')
      add(violations, path, "line #{lineno}: bare href=\"#{val}\" — must go through relative_url")
    end
  end
end

# ---------------------------------------------------------------------------
# 7. No literal {{ / {% surviving inside a {% raw %}...{% endraw %} region
# ---------------------------------------------------------------------------

PAGES.each do |pg|
  path = pg[:path]
  content = pg[:body]
  scan_from = 0
  while (raw_start = content.index('{% raw %}', scan_from))
    raw_end = content.index('{% endraw %}', raw_start)
    break unless raw_end
    region = content[(raw_start + '{% raw %}'.length)...raw_end]
    line_offset = content[0...raw_start].count("\n") + 1
    region.each_line.with_index do |line, i|
      if line.include?('{{') && line.include?("relative_url")
        add(violations, path, "line ~#{line_offset + i}: a relative_url expression appears to be inside a {% raw %} block, where it will render literally — step out with {% endraw %}...{% raw %}")
      end
    end
    scan_from = raw_end + '{% endraw %}'.length
  end
end

# ---------------------------------------------------------------------------
# 8. Every series YAML `legacy` permalink appears in some page's redirect_from
# ---------------------------------------------------------------------------

ALL_REDIRECTS = Set.new
PAGES.each do |pg|
  fm = safe_load_yaml(pg[:raw_fm])
  next unless fm.is_a?(Hash)
  rf = fm['redirect_from']
  next unless rf
  Array(rf).each { |r| ALL_REDIRECTS << r }
end

SERIES.each do |series_id, parts|
  next unless parts.is_a?(Array)
  parts.each do |part|
    next unless part.is_a?(Hash)
    legacy = part['legacy']
    next unless legacy
    Array(legacy).each do |l|
      unless ALL_REDIRECTS.include?(l)
        add(violations, "_data/series/#{series_id}.yml", "legacy URL #{l} does not appear in any page's redirect_from")
      end
    end
  end
end

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

warnings = violations.reject { |(_p, _m, changed)| changed }
failures = violations.select { |(_p, _m, changed)| changed }

unless warnings.empty?
  puts "Warnings (pre-existing files, not blocking):"
  warnings.each { |(p, m, _)| puts "  [warn] #{p}: #{m}" }
  puts
end

unless failures.empty?
  puts "Failures (new/changed files):"
  failures.each { |(p, m, _)| puts "  [FAIL] #{p}: #{m}" }
  puts
end

puts "lint-content: #{warnings.length} warning(s), #{failures.length} failure(s)."

exit(failures.empty? ? 0 : 1)
