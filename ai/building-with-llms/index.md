---
layout: series-hub
title: Building with LLMs, Interactively
section: ai
series: building_with_llms
permalink: /ai/building-with-llms/
subtitle: The layer between the model and the product - what a token and a context window really are, how to prompt and engineer context, how retrieval actually works, and how to measure any of it before you ship.
description: An interactive, step-by-step guide to building applications with large language models - the stateless text function, tokens and context budgets, sampling, cost and latency, evaluation, prompting and context engineering, caching-aware layout, embeddings, chunking, approximate nearest neighbour, hybrid search and reranking.
---

<style>
  .route-table { width: 100%; border-collapse: collapse; font-size: 13.5px; margin-top: 10px; }
  .route-table th, .route-table td { padding: 10px 12px; border-bottom: 1px solid var(--color-divider); text-align: left; vertical-align: top; }
  .route-table th { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.6; }
</style>

<p class="section-lede" style="max-width:70ch;">The <a href="{{ '/ai/llm-training/' | relative_url }}">LLM Training</a> volume covers how a model is made; <a href="{{ '/ai/llm-serving/' | relative_url }}">LLM Serving</a> covers how it is run. This volume owns the layer in between, the one most practitioners actually work in: how to turn a raw text function into an application. It starts from zero &mdash; what a token is, what an embedding is, why a context window is a budget rather than a bucket &mdash; and ends at retrieval architectures and the arguments still being had about them.</p>

<p class="section-lede" style="max-width:70ch;">The companion volume, <a href="{{ '/ai/agents-in-action/' | relative_url }}">Agents in Action</a>, picks up where this one stops: workflows and agents, tool design, memory and compaction, evaluation, fine-tuning for products, and production hardening. The two share one running example &mdash; an assistant over a documentation corpus &mdash; grown across both volumes, so the embedding space you build here is the one the agent searches in there. Keep the <a href="{{ '/ai/building-with-llms/glossary/' | relative_url }}">glossary</a> open for notation, and treat <a href="{{ '/ai/llm-training/tokens/' | relative_url }}">Part 2 of the training guide</a> as the deeper treatment of the tokenizer.</p>

<h3 class="era-heading">Already know some of this? Start here</h3>
<table class="route-table">
  <thead><tr><th>If you...</th><th>Start at</th></tr></thead>
  <tbody>
    <tr><td>Have never called an API and want the mental model first</td><td><a href="{{ '/ai/building-with-llms/stateless-function/' | relative_url }}">Part 1 &mdash; What you're actually building on</a></td></tr>
    <tr><td>Are fighting a context limit or a surprise bill</td><td><a href="{{ '/ai/building-with-llms/tokens-and-budgets/' | relative_url }}">Part 2 &mdash; Tokens, windows and budgets</a>, then <a href="{{ '/ai/building-with-llms/caching-layout/' | relative_url }}">Part 11 &mdash; Caching-aware prompt layout</a></td></tr>
    <tr><td>Cannot get the model to return parseable JSON</td><td><a href="{{ '/ai/building-with-llms/structured-output/' | relative_url }}">Part 9 &mdash; Structured output and constrained decoding</a></td></tr>
    <tr><td>Have a prompt that works but nothing to prove it stays working</td><td><a href="{{ '/ai/building-with-llms/first-eval/' | relative_url }}">Part 5 &mdash; Your first eval, in twenty lines</a></td></tr>
    <tr><td>Are about to add a vector database to a working keyword search</td><td><a href="{{ '/ai/building-with-llms/why-retrieve/' | relative_url }}">Part 12 &mdash; Why retrieve, and lexical search first</a></td></tr>
    <tr><td>Need to choose an index for a hundred million vectors</td><td><a href="{{ '/ai/building-with-llms/ann-index/' | relative_url }}">Part 15 &mdash; Approximate nearest neighbour</a></td></tr>
    <tr><td>Want the honest case for and against RAG in the long-context era</td><td><a href="{{ '/ai/building-with-llms/beyond-chunks/' | relative_url }}">Part 17 &mdash; Beyond chunks</a></td></tr>
  </tbody>
</table>
