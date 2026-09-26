---
layout: series-hub
title: "Lie Groups & Lie Algebras, Interactively"
section: "vision"
series: "lie_theory"
permalink: "/vision/lie-theory/"
subtitle: "The mathematics of rotations and rigid motion, built from a compass needle up to IMU preintegration. Every idea comes with something you can drag, and every formula is checked numerically on the page."
description: "An interactive guide to Lie groups and Lie algebras for robotics and vision - SO(2), SO(3), SE(3), the exponential and logarithm maps, the adjoint, right and left Jacobians, optimization, uncertainty and interpolation on manifolds."
---

<p class="section-lede" style="max-width:70ch;">A robot's heading, a camera's orientation and a drone's pose are not vectors: you cannot add two of them, average them with a mean, or step along a gradient by plain addition. Lie theory is the small, precise toolkit that fixes all three at once. You <em>compose</em> in the group, <em>differentiate</em> in the tangent space, and move between the two with <code>Exp</code> and <code>Log</code>. The four acts build that toolkit in order. Act I shows why it is needed and what a group is. Act II builds the algebra of rotations. Act III extends it to full rigid motion. Act IV does calculus with it: Jacobians, optimization, uncertainty and integration.</p>

<p class="section-lede" style="max-width:70ch;">The prerequisites are matrix multiplication and a derivative. <a href="{{ '/math/linear-algebra/rotations/' | relative_url }}">Linear Algebra, Part 20</a> and <a href="{{ '/math/calculus-in-motion/manifolds/' | relative_url }}">Calculus on manifolds</a> are good warm-ups. For a single-page shortcut to just the parts the optimizer needs, the <a href="{{ '/vision/nonlinear-optimization/3d-rotations-math/' | relative_url }}">SO(3) primer</a> covers it. Everything here is the machinery behind rotation estimation in <a href="{{ '/vision/nonlinear-optimization/' | relative_url }}">Nonlinear Optimization</a> and bundle adjustment in <a href="{{ '/vision/multi-view-geometry/' | relative_url }}">Multi-View Geometry</a>. Keep the <a href="{{ '/vision/lie-theory/cheat-sheet/' | relative_url }}">formula sheet</a> open as you read.</p>
