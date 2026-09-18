source "https://rubygems.org"

# Mirrors the gem set GitHub Pages builds with, so a local build matches production.
gem "github-pages", group: :jekyll_plugins

# `csv` left the Ruby standard library in 3.4; Jekyll 3.9 requires it. GitHub Pages
# builds on Ruby 3.1 where it is still stdlib, so this is a local-build-only shim.
gem "csv"

# Link checking for the verification steps.
group :development do
  gem "html-proofer", "~> 5.0"
end
