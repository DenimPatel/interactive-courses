/* Guide kit — Plotly 3D scene helpers for NEW interactive guide pages.
 * Promoted from the shared-scene setup duplicated across the multi-view-geometry pages
 * (see vision/multi-view-geometry/pinhole-camera/index.html and siblings): the running
 * cube scene's vertex/edge tables, a wireframe cube trace, a camera-frustum trace, and
 * the base Plotly 3D scene layout. Requires assets/js/guide-math.js? No — self-contained,
 * but expects Plotly to already be loaded (guide-head.html's `plotly: true` include).
 * The 19 existing vision pages keep their own inline copies; new pages should use
 * window.GuidePlot3D instead.
 * Load after Plotly and before any page-specific <script>. */
(function (global) {
  "use strict";

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  var COLOR_TEXT = css('--color-text') || '#201e1d';
  var COLOR_DIVIDER = css('--color-divider') || 'rgba(32,30,29,0.16)';

  // ---------- shared scene: a cube centered at the origin ----------
  var CUBE_R = 0.9;
  var CUBE_VERTS = [];
  [-1, 1].forEach(function (sx) {
    [-1, 1].forEach(function (sy) {
      [-1, 1].forEach(function (sz) {
        CUBE_VERTS.push([sx * CUBE_R, sy * CUBE_R, sz * CUBE_R]);
      });
    });
  });
  function vi(x, y, z) { // index into CUBE_VERTS by sign bits
    return ((x > 0 ? 1 : 0) << 2) | ((y > 0 ? 1 : 0) << 1) | (z > 0 ? 1 : 0);
  }
  var CUBE_EDGES = [];
  [-1, 1].forEach(function (sy) { [-1, 1].forEach(function (sz) { CUBE_EDGES.push([vi(-1, sy, sz), vi(1, sy, sz)]); }); });
  [-1, 1].forEach(function (sx) { [-1, 1].forEach(function (sz) { CUBE_EDGES.push([vi(sx, -1, sz), vi(sx, 1, sz)]); }); });
  [-1, 1].forEach(function (sx) { [-1, 1].forEach(function (sy) { CUBE_EDGES.push([vi(sx, sy, -1), vi(sx, sy, 1)]); }); });

  function cubeLineTrace(color, width) {
    var xs = [], ys = [], zs = [];
    CUBE_EDGES.forEach(function (e) {
      var a = CUBE_VERTS[e[0]], b = CUBE_VERTS[e[1]];
      xs.push(a[0], b[0], null); ys.push(a[1], b[1], null); zs.push(a[2], b[2], null);
    });
    return { type: 'scatter3d', mode: 'lines', x: xs, y: ys, z: zs, line: { color: color, width: width || 4 }, hoverinfo: 'skip' };
  }

  // Draws a small wireframe frustum pyramid for a camera at cam.C looking along
  // cam.R[2] (forward), with cam.R[0]/cam.R[1] as right/down. Pair with GuideMath.orbitCamera.
  function cameraFrustumTrace(cam, color, size) {
    size = size || 0.55;
    var right = cam.R[0], down = cam.R[1], fwd = cam.R[2];
    var GM = global.GuideMath;
    function add(a, b) { return GM ? GM.add(a, b) : [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
    function scaleV(a, s) { return GM ? GM.scale(a, s) : [a[0] * s, a[1] * s, a[2] * s]; }
    var corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (s) {
      return add(add(cam.C, scaleV(fwd, size)),
        add(scaleV(right, s[0] * size * 0.6), scaleV(down, s[1] * size * 0.6)));
    });
    var xs = [], ys = [], zs = [];
    corners.forEach(function (pt) { xs.push(cam.C[0], pt[0], null); ys.push(cam.C[1], pt[1], null); zs.push(cam.C[2], pt[2], null); });
    for (var i = 0; i < 4; i++) {
      var a = corners[i], b = corners[(i + 1) % 4];
      xs.push(a[0], b[0], null); ys.push(a[1], b[1], null); zs.push(a[2], b[2], null);
    }
    return { type: 'scatter3d', mode: 'lines', x: xs, y: ys, z: zs, line: { color: color, width: 3 }, hoverinfo: 'skip' };
  }

  function cameraCenterTrace(cam, color) {
    return { type: 'scatter3d', mode: 'markers', x: [cam.C[0]], y: [cam.C[1]], z: [cam.C[2]], marker: { size: 5, color: color }, hoverinfo: 'skip' };
  }

  // Resolve an axis range from the several shapes callers use:
  //   undefined                    -> fallback
  //   [min, max]                   -> same range on every axis
  //   [[x0,x1],[y0,y1],[z0,z1]]    -> one per axis, in x/y/z order
  //   {x:[x0,x1], y:..., z:...}    -> one per axis by name
  function axisRange(spec, which, fallback) {
    if (!spec) return fallback;
    var idx = which === 'x' ? 0 : which === 'y' ? 1 : 2;
    if (Array.isArray(spec)) {
      if (spec.length === 2 && typeof spec[0] === 'number' && typeof spec[1] === 'number') return spec;
      return spec[idx] || fallback;
    }
    if (typeof spec === 'object' && spec[which]) return spec[which];
    return fallback;
  }

  // Base Plotly 3D scene layout, theme-aware via the site's --color-* tokens.
  // The cube default ([-6,6] on all axes, aspectmode 'cube') is preserved for the
  // existing vision scenes. For a z = f(x,y) surface, pass a per-axis range and
  // let the aspect follow the data, e.g.:
  //   GuidePlot3D.baseLayout({ range: {x:[-3,3], y:[-3,3], z:[-1,5]},
  //                            aspectmode: 'data' })
  // opts: {range, aspectmode, aspect:{x,y,z}, eye, colors}
  function baseLayout(opts) {
    opts = opts || {};
    // Resolve theme colours at call time so a runtime theme switch is picked up
    // (the module-level constants are only a fallback).
    var c = opts.colors || {};
    var text = c.text || css('--color-text') || COLOR_TEXT;
    var divider = c.divider || css('--color-divider') || COLOR_DIVIDER;
    var rx = axisRange(opts.range, 'x', [-6, 6]);
    var ry = axisRange(opts.range, 'y', [-6, 6]);
    var rz = axisRange(opts.range, 'z', [-6, 6]);
    var scene = {
      xaxis: { range: rx, backgroundcolor: 'transparent', gridcolor: divider, zerolinecolor: divider, color: text, title: opts.xTitle || 'x' },
      yaxis: { range: ry, backgroundcolor: 'transparent', gridcolor: divider, zerolinecolor: divider, color: text, title: opts.yTitle || 'y' },
      zaxis: { range: rz, backgroundcolor: 'transparent', gridcolor: divider, zerolinecolor: divider, color: text, title: opts.zTitle || 'z' },
      aspectmode: opts.aspectmode || 'cube',
      camera: { eye: opts.eye || { x: 1.4, y: -1.4, z: 1.0 } }
    };
    if (opts.aspect) scene.aspectratio = opts.aspect;
    return {
      autosize: true, margin: { l: 0, r: 0, t: 0, b: 0 }, showlegend: false, paper_bgcolor: 'transparent',
      scene: scene
    };
  }

  global.GuidePlot3D = {
    CUBE_VERTS: CUBE_VERTS, CUBE_EDGES: CUBE_EDGES,
    cubeLineTrace: cubeLineTrace, cameraFrustumTrace: cameraFrustumTrace,
    cameraCenterTrace: cameraCenterTrace, baseLayout: baseLayout
  };
})(window);
