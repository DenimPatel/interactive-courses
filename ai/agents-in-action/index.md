---
layout: series-hub
title: Agents in Action, Interactively
section: ai
series: agents_in_action
permalink: /ai/agents-in-action/
subtitle: How to design, evaluate and ship an agentic application - workflows and the loop, tool design, planning, memory and compaction, the multi-agent argument, evaluation from error analysis to judges, fine-tuning for products, and production hardening against injection, cost and drift.
description: An interactive, step-by-step guide to agentic applications - workflow patterns versus agents, tool use and tool design, ReAct and planning, MCP and code execution, memory and compaction, multi-agent architectures, long-horizon harnesses, error analysis, datasets and CI, LLM-as-judge, RAG and agent evaluation, observability, fine-tuning decisions, prompt injection and production reliability.
---

<style>
  .route-table { width: 100%; border-collapse: collapse; font-size: 13.5px; margin-top: 10px; }
  .route-table th, .route-table td { padding: 10px 12px; border-bottom: 1px solid var(--color-divider); text-align: left; vertical-align: top; }
  .route-table th { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.6; }
</style>

<p class="section-lede" style="max-width:70ch;">The <a href="{{ '/ai/building-with-llms/' | relative_url }}">Building with LLMs</a> volume ends with an agent that can search and read a documentation corpus. This volume asks the harder question: whether that agent should exist at all, how to make it reliable, and how to know. It starts at the workflow-versus-agent decision, moves through tool design, planning, memory and the multi-agent argument, then spends three acts on the part that is actually hard &mdash; evaluation &mdash; before tuning and shipping.</p>

<p class="section-lede" style="max-width:70ch;">The throughline is the same documentation assistant, grown from a single tool call into an evaluated, hardened deployment. Where an idea belongs to the training or serving layer instead, this volume links out rather than re-teaching: <a href="{{ '/ai/llm-training/tools-agents/' | relative_url }}">Part 14 of the training guide</a> owns tool use as a post-training problem, and <a href="{{ '/ai/llm-serving/workloads/' | relative_url }}">Part 18 of the serving guide</a> owns agent traffic as a workload shape. Keep the <a href="{{ '/ai/agents-in-action/glossary/' | relative_url }}">glossary</a> and the decision tables with it open.</p>

<h3 class="era-heading">Already know some of this? Start here</h3>
<table class="route-table">
  <thead><tr><th>If you...</th><th>Start at</th></tr></thead>
  <tbody>
    <tr><td>Are deciding whether you need an agent at all</td><td><a href="{{ '/ai/agents-in-action/workflows-before-agents/' | relative_url }}">Part 1 &mdash; Workflows before agents</a></td></tr>
    <tr><td>Your agent calls tools but picks the wrong one</td><td><a href="{{ '/ai/agents-in-action/tool-use/' | relative_url }}">Part 2 &mdash; Tool use: the loop, and tool design as the craft</a></td></tr>
    <tr><td>Your context fills up before the task finishes</td><td><a href="{{ '/ai/agents-in-action/memory-compaction/' | relative_url }}">Part 5 &mdash; Memory and compaction</a></td></tr>
    <tr><td>Are arguing about whether to add a second agent</td><td><a href="{{ '/ai/agents-in-action/multi-agent/' | relative_url }}">Part 6 &mdash; Multi-agent: the argument</a></td></tr>
    <tr><td>Have traces but no idea what is failing</td><td><a href="{{ '/ai/agents-in-action/error-analysis/' | relative_url }}">Part 8 &mdash; Why eval is the hard part</a></td></tr>
    <tr><td>Want to judge outputs at scale without fooling yourself</td><td><a href="{{ '/ai/agents-in-action/llm-judge/' | relative_url }}">Part 10 &mdash; LLM-as-judge and its biases</a></td></tr>
    <tr><td>Are about to put a model behind an untrusted input</td><td><a href="{{ '/ai/agents-in-action/prompt-injection/' | relative_url }}">Part 15 &mdash; Prompt injection and the lethal trifecta</a></td></tr>
  </tbody>
</table>
