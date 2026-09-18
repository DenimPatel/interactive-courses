---
layout: series-hub
title: Nonlinear Optimization, Interactively
section: vision
series: nonlinear_optimization
permalink: /vision/nonlinear-optimization/
subtitle: Gradient descent, Newton's method, Gauss-Newton and Levenberg-Marquardt, built up around one running example - a robot working out where it is - and ending in full 3D rotation and SLAM.
description: An interactive, step-by-step guide to gradient descent, Newton's method, Gauss-Newton and Levenberg-Marquardt, built around a robot localizing itself from noisy measurements.
---

<p class="section-lede" style="max-width:70ch;">The same four solvers carry the whole series; what changes is the thing being estimated - a position, then a full pose, then a map, then a trajectory, then a 3D orientation. The <a href="{{ '/vision/nonlinear-optimization/3d-rotations-math/' | relative_url }}">math primer</a> is the companion for Part 5 and can be read at any point. This is also the machinery behind bundle adjustment in the <a href="{{ '/vision/multi-view-geometry/' | relative_url }}">multi-view geometry guide</a>.</p>

<p class="section-lede" style="max-width:70ch;">These parts use calculus as a tool. If the gradient, Jacobian or Hessian are not yet second nature - or were always asserted rather than derived - <a href="{{ '/math/calculus/' | relative_url }}">Calculus, Interactively</a> builds single-variable and multivariable calculus from local linearity up, and <a href="{{ '/math/calculus-in-motion/' | relative_url }}">Calculus in Motion, Interactively</a> covers the curvature and convergence this guide relies on.</p>
