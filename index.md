---
layout: home
title: Home
permalink: /
section: ""
description: Hand-written interactive guides to AI, vision and math — LLM training and serving, building with LLMs, agents, generative media, multi-view geometry, nonlinear optimization, linear algebra, calculus, probability and statistics.
---

{%- assign total_parts = 0 -%}
{%- assign total_series = 0 -%}
{%- for s in site.data.sections -%}
  {%- for sid in s.series -%}
    {%- assign ser = site.data.series[sid] -%}
    {%- assign n = ser.parts | size -%}
    {%- assign total_parts = total_parts | plus: n -%}
    {%- assign total_series = total_series | plus: 1 -%}
  {%- endfor -%}
{%- endfor -%}

<section class="hero">
  <h1>Interactive guides,<br>built from scratch.</h1>
  <p>{{ total_parts }} parts across {{ total_series }} long-form guides to AI, vision and math. Every part is interactive — you drag the point along the curve, run the training loop, and watch the solver converge. Nothing here is a static diagram.</p>
  <div class="hero-actions">
    <a href="{{ '/ai/' | relative_url }}" class="btn btn-primary">Browse the guides</a>
    <a href="https://denimpatel.github.io/AI/" class="btn btn-ghost">Read the record &amp; notes</a>
  </div>
</section>

<section style="padding: 32px 0 40px;">
  <div class="stats"></div>
  <p class="stats-row">
    <span>Est. 1950</span>
    <span>Compiled by Denim Patel</span>
    <span>Guides &amp; interactive notes</span>
    <span>Last updated {{ site.time | date: "%b %Y" }}</span>
  </p>
  <div class="stats-rule"></div>
  <div class="stats-grid">
    <p class="stat"><span>Interactive guide parts</span><span class="stat-fill"></span><span class="stat-value stat-value--accent js-count" data-count="{{ total_parts }}">0</span></p>
    <p class="stat"><span>Guides</span><span class="stat-fill"></span><span class="stat-value js-count" data-count="{{ total_series }}">0</span></p>
    <p class="stat"><span>Subjects</span><span class="stat-fill"></span><span class="stat-value js-count" data-count="{{ site.data.sections | size }}">0</span></p>
    <p class="stat"><span>Hand-written figures</span><span class="stat-fill"></span><span class="stat-value js-count" data-count="{{ total_parts }}">0</span></p>
  </div>
  <div class="stats-rule"></div>
</section>

<section class="section">
  <span class="section-kicker">Ways in</span>
  <h2 class="section-title">Start here</h2>
  <div class="card-grid" style="margin-bottom: 8px;">
    {%- for s in site.data.sections %}
    <a class="card elev-sm reveal" style="text-decoration:none; color:inherit; transition-delay: {{ forloop.index0 | times: 0.06 }}s;" href="{{ s.url | relative_url }}">
      <div class="card-kicker">{{ s.kicker }}</div>
      <div class="card-title">{{ s.title }}</div>
      <p class="card-body">{{ s.blurb }}</p>
    </a>
    {%- endfor %}
  </div>
</section>

<section class="section">
  <span class="section-kicker">Every guide</span>
  <h2 class="section-title">Built from scratch, step by step</h2>
  <p class="section-lede">{{ total_series }} guides, {{ total_parts }} parts. Each is built around one running example carried from the first part to the last.</p>
  {%- for s in site.data.sections %}
  <h3 class="era-heading" style="margin-top:28px;">{{ s.title }}</h3>
  <div class="card-grid card-grid--tight" style="margin-bottom:24px;">
    {%- for sid in s.series %}
    {%- assign ser = site.data.series[sid] %}
    {%- assign n = ser.parts | size %}
    <a class="card reveal" style="text-decoration:none; color:inherit; transition-delay: {{ forloop.index0 | times: 0.05 }}s;" href="{{ ser.hub | relative_url }}">
      <div class="card-kicker">Interactive &middot; {{ n }} parts</div>
      <div class="card-title">{{ ser.title }}</div>
      <p class="card-body">{{ ser.parts[0].blurb }}</p>
    </a>
    {%- endfor %}
  </div>
  {%- endfor %}
</section>

<section class="section" style="padding-bottom: 40px;">
  <span class="section-kicker">The other half</span>
  <h2 class="section-title">The record &amp; the field notes</h2>
  <p class="section-lede">The AI record — milestones, products, benchmarks, labs and voices — and the field notes and blog live in the companion site.</p>
  <p><a href="https://denimpatel.github.io/AI/" class="btn btn-secondary">Visit denimpatel.github.io/AI &rarr;</a></p>
</section>
