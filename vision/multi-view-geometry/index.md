---
layout: series-hub
title: Multi-View Geometry, Interactively
section: vision
series: multi_view_geometry
permalink: /vision/multi-view-geometry/
subtitle: A step-by-step guide to the geometry that turns flat images into 3D structure, built around one running scene - a cube seen by one or more draggable pinhole cameras. Every part is interactive; nothing is a static diagram.
description: An interactive, step-by-step guide to multi-view geometry - projective foundations and conics, projection, calibration, epipolar geometry, homographies, triangulation, the five-point and affine-factorization solvers, the trifocal tensor, bundle adjustment, self-calibration, degenerate configurations and full SfM pipelines.
---

<p class="section-lede" style="max-width:70ch;">Parts build on each other, but each one stands alone. If you already know homogeneous coordinates, start at <a href="{{ '/vision/multi-view-geometry/pinhole-camera/' | relative_url }}">Part 4</a>; if you are here for a specific estimator, jump straight to it. The structure-from-motion parts assemble everything into a working reconstruction pipeline, and lean on the <a href="{{ '/vision/nonlinear-optimization/' | relative_url }}">nonlinear optimization guide</a> for the solver underneath.</p>
