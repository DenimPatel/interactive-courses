#!/usr/bin/env node
/* Numerics self-check for assets/js/lie-viz.js (window.Lie).
 *
 * Every page of the Lie-theory series computes with this file, and the closed forms in
 * it (Log near pi, the right/left Jacobians, the SE(3) Q block) are exactly the kind of
 * formula that is easy to get subtly wrong. This script loads the browser file into a
 * minimal Node sandbox and asserts identities that must hold, checking every analytic
 * Jacobian against a central-difference Jacobian.
 *
 * Run: node scripts/check-lie-viz.js
 * Exits non-zero if any assertion fails. */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'assets', 'js', 'lie-viz.js');
const windowObj = {};
new Function('window', fs.readFileSync(SRC, 'utf8'))(windowObj);
const Lie = windowObj.Lie;
if (!Lie) { console.error('check-lie-viz: lie-viz.js did not export window.Lie'); process.exit(1); }
const { m3, v3, mN, so2, so3, se2, se3, quat, euler } = Lie;

let failures = 0, checks = 0;
function ok(cond, label) { checks++; if (!cond) { failures++; console.error('  FAIL ' + label); } }
function close(a, b, tol, label) {
  checks++;
  if (!(isFinite(a) && Math.abs(a - b) <= tol)) { failures++; console.error('  FAIL ' + label + ': expected ' + b + ' (±' + tol + '), got ' + a); }
}
function closeV(a, b, tol, label) {
  let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  close(m, 0, tol, label + ' (max abs diff)');
}
function closeM(A, B, tol, label) { close(mN.maxAbsDiff(A, B), 0, tol, label + ' (max abs diff)'); }
function section(name) { console.log('- ' + name); }

const rng = Lie.lcg(12345);
function randVec(n, s) { const v = []; for (let i = 0; i < n; i++) v.push((rng() * 2 - 1) * s); return v; }

// ---------------------------------------------------------------- SO(2)
section('SO(2)');
close(so2.wrap(3 * Math.PI / 2), -Math.PI / 2, 1e-12, 'wrap(3pi/2)');
close(so2.log(so2.exp(2.5)), 2.5, 1e-12, 'log(exp(2.5))');
close(so2.minus(Lie.rad(10), Lie.rad(350)), Lie.rad(20), 1e-12, '10deg (-) 350deg = +20deg');
close(so2.mean([Lie.rad(350), Lie.rad(10)]), 0, 1e-9, 'intrinsic mean of 350deg and 10deg is 0');

// ---------------------------------------------------------------- SO(3) exp/log
section('SO(3) exp / log');
for (let k = 0; k < 200; k++) {
  const w = randVec(3, 2.0);
  const R = so3.exp(w);
  close(m3.orthoError(R), 0, 1e-12, 'exp(w) orthogonal');
  close(m3.det(R), 1, 1e-12, 'det exp(w) = 1');
  if (v3.norm(w) < Math.PI) closeV(so3.log(R), w, 1e-9, 'log(exp(w)) = w, |w|<pi');
}
for (let k = 0; k < 100; k++) {
  const R = so3.random(rng);
  closeM(so3.exp(so3.log(R)), R, 1e-9, 'exp(log(R)) = R, random R');
}
// tiny angles
[1e-12, 1e-8, 1e-5, 1e-3].forEach(function (t) {
  const w = v3.scale(v3.normalize([0.3, -0.5, 0.8]), t);
  closeV(so3.log(so3.exp(w)), w, 1e-12 + t * 1e-6, 'log(exp(w)) at |w|=' + t);
});
// near pi
[1e-2, 1e-4, 1e-6, 1e-9, 0].forEach(function (d) {
  const k = v3.normalize([0.2, 0.9, -0.4]);
  const w = v3.scale(k, Math.PI - d);
  const R = so3.exp(w);
  const w2 = so3.log(R);
  closeM(so3.exp(w2), R, 1e-9, 'exp(log(R)) near pi, pi-th=' + d);
  close(v3.norm(w2), Math.PI - d, 1e-7, '|log R| near pi, pi-th=' + d);
});
// series converges to the closed form
closeM(so3.expSeries([0.4, -1.1, 0.7], 30), so3.exp([0.4, -1.1, 0.7]), 1e-12, 'series(30) = closed-form exp');
// hat / vee / bracket
{
  const a = [0.3, -0.2, 0.9], b = [-1.1, 0.4, 0.25];
  closeV(so3.vee(so3.hat(a)), a, 0, 'vee(hat(a)) = a');
  closeV(m3.mulV(so3.hat(a), b), v3.cross(a, b), 1e-15, 'hat(a) b = a x b');
  const A = so3.hat(a), B = so3.hat(b);
  closeV(so3.vee(m3.sub(m3.mul(A, B), m3.mul(B, A))), so3.bracket(a, b), 1e-15, '[hat a, hat b] = hat(a x b)');
  closeM(m3.mul(m3.mul(A, A), A), m3.scale(A, -v3.dot(a, a)), 1e-14, 'hat(a)^3 = -|a|^2 hat(a)');
}

// ---------------------------------------------------------------- SO(3) Jacobians
section('SO(3) Jacobians against central differences');
for (let k = 0; k < 40; k++) {
  const w = randVec(3, k < 5 ? 1e-5 : 2.2);
  // Jr: Log(Exp(w)^T Exp(w + d)) ~ Jr d
  const Jr = so3.Jr(w);
  const JrNum = Lie.numJac(function (x) { return so3.exp(x); }, w, 3, Lie.vecPlus, function (A, B) { return so3.minus(A, B); });
  closeM(Jr, JrNum, 1e-6, 'Jr analytic = numeric');
  const JlNum = Lie.numJac(function (x) { return so3.exp(x); }, w, 3, Lie.vecPlus, function (A, B) { return so3.minusL(A, B); });
  closeM(so3.Jl(w), JlNum, 1e-6, 'Jl analytic = numeric');
  closeM(m3.mul(so3.Jr(w), so3.JrInv(w)), m3.I(), 1e-9, 'Jr Jr^-1 = I');
  closeM(m3.mul(so3.Jl(w), so3.JlInv(w)), m3.I(), 1e-9, 'Jl Jl^-1 = I');
  closeM(so3.Jl(w), m3.mul(so3.exp(w), so3.Jr(w)), 1e-9, 'Jl = R Jr');
  // Log Jacobian: d Log(R (+) d)/d d = Jr^-1(Log R)
  const R = so3.exp(w);
  if (v3.norm(w) < 3) {
    const JlogNum = Lie.numJac(function (X) { return so3.log(X); }, R, 3, so3.plus, Lie.vecMinus);
    closeM(so3.JrInv(w), JlogNum, 1e-6, 'd Log / d R = Jr^-1');
  }
  // Adjoint: R Exp(d) = Exp(Ad_R d) R
  const d = randVec(3, 0.5);
  closeM(m3.mul(R, so3.exp(d)), m3.mul(so3.exp(m3.mulV(so3.Ad(R), d)), R), 1e-12, 'R Exp(d) = Exp(R d) R');
  // action Jacobian: d(R p)/d d (right) = -R [p]x
  const p = randVec(3, 2);
  const JactNum = Lie.numJac(function (X) { return m3.mulV(X, p); }, R, 3, so3.plus, Lie.vecMinus);
  closeM(m3.scale(m3.mul(R, so3.hat(p)), -1), JactNum, 1e-6, 'd(R p)/d delta = -R [p]x');
  // inverse Jacobian: d(R^-1)/dR = -R (right)
  const JinvNum = Lie.numJac(function (X) { return m3.T(X); }, R, 3, so3.plus, function (A, B) { return so3.minus(A, B); });
  closeM(m3.scale(R, -1), JinvNum, 1e-6, 'd(R^-1)/dR = -Ad_R');
}

// minus and the rotation pose-graph edge r = Log(Zᵀ R1ᵀ R2), as used in the Jacobians part
for (let k = 0; k < 20; k++) {
  const A = so3.random(rng), B = so3.plus(A, randVec(3, 0.9)), tau = so3.minus(B, A);
  closeM(m3.scale(so3.JlInv(tau), -1), Lie.numJac(function (X) { return so3.minus(B, X); }, A, 3, so3.plus, Lie.vecMinus), 1e-6, 'd(R2 (-) R1)/dR1 = -Jl^-1');
  closeM(so3.JrInv(tau), Lie.numJac(function (X) { return so3.minus(X, A); }, B, 3, so3.plus, Lie.vecMinus), 1e-6, 'd(R2 (-) R1)/dR2 = Jr^-1');
  const Z = so3.plus(m3.mul(m3.T(A), B), randVec(3, 0.2));
  const res = function (X, Y) { return so3.log(m3.mul(m3.mul(m3.T(Z), m3.T(X)), Y)); };
  const r = res(A, B);
  closeM(m3.scale(m3.mul(so3.JlInv(r), m3.T(Z)), -1), Lie.numJac(function (X) { return res(X, B); }, A, 3, so3.plus, Lie.vecMinus), 1e-6, 'pose-graph edge d r/d R1');
  closeM(so3.JrInv(r), Lie.numJac(function (X) { return res(A, X); }, B, 3, so3.plus, Lie.vecMinus), 1e-6, 'pose-graph edge d r/d R2');
}

// ---------------------------------------------------------------- quaternions
section('Quaternions');
for (let k = 0; k < 100; k++) {
  const R = so3.random(rng);
  const q = quat.fromMat(R);
  close(quat.norm(q), 1, 1e-12, '|q| = 1');
  closeM(quat.toMat(q), R, 1e-12, 'toMat(fromMat(R)) = R');
  closeM(quat.toMat(q.map(function (x) { return -x; })), R, 1e-12, 'q and -q give the same R');
  const w = so3.log(R);
  closeM(quat.toMat(quat.exp(w)), R, 1e-9, 'quat.exp(w) matches so3.exp(w)');
  closeV(quat.log(quat.exp(w)), w, 1e-9, 'quat.log(quat.exp(w)) = w');
  const v = randVec(3, 1);
  closeV(quat.rotate(q, v), m3.mulV(R, v), 1e-12, 'q v q* = R v');
}
{
  const R1 = so3.random(rng), R2 = so3.random(rng);
  closeM(quat.toMat(quat.mul(quat.fromMat(R1), quat.fromMat(R2))), m3.mul(R1, R2), 1e-12, 'q1 q2 <-> R1 R2');
  const a = quat.fromMat(R1), b = quat.fromMat(R2);
  closeM(quat.toMat(quat.slerp(a, b, 0)), R1, 1e-12, 'slerp(0) = a');
  closeM(quat.toMat(quat.slerp(a, b, 1)), R2, 1e-12, 'slerp(1) = b');
  // constant angular speed, and slerp = geodesic interp
  const total = so3.dist(R1, R2);
  for (let i = 1; i < 10; i++) {
    const Rt = quat.toMat(quat.slerp(a, b, i / 10));
    close(so3.dist(R1, Rt), total * i / 10, 1e-9, 'slerp constant speed at t=' + i / 10);
    closeM(Rt, so3.interp(R1, R2, i / 10), 1e-9, 'slerp = R0 Exp(t Log(R0^T R1))');
  }
}

// ---------------------------------------------------------------- Euler
section('Euler ZYX');
{
  const e = euler.fromMat(euler.toMat(0.7, -0.4, 1.9));
  close(e.yaw, 0.7, 1e-12, 'yaw'); close(e.pitch, -0.4, 1e-12, 'pitch'); close(e.roll, 1.9, 1e-12, 'roll');
  const L = euler.fromMat(euler.toMat(0.3, Math.PI / 2, 0.5));
  ok(L.locked, 'pitch = 90deg flagged as gimbal lock');
  closeM(euler.toMat(L.yaw, L.pitch, L.roll), euler.toMat(0.3, Math.PI / 2, 0.5), 1e-9, 'locked angles still reproduce R');
  close(m3.det(euler.rateMatrix(0.4, 0.3)), -Math.cos(0.4), 1e-12, 'det(rate matrix) = -cos(pitch)');
}

// ---------------------------------------------------------------- SE(2)
section('SE(2)');
for (let k = 0; k < 50; k++) {
  const tau = randVec(3, 2); tau[2] = (rng() * 2 - 1) * 3;
  closeV(se2.log(se2.exp(tau)), tau, 1e-9, 'se2 log(exp(tau)) = tau');
  const T = se2.exp(tau), d = randVec(3, 0.4);
  closeM(mN.mul(T, se2.exp(d)), mN.mul(se2.exp(mN.mulV(se2.Ad(T), d)), T), 1e-12, 'se2 T Exp(d) = Exp(Ad d) T');
  closeM(mN.mul(T, se2.inv(T)), mN.eye(3), 1e-12, 'se2 T T^-1 = I');
}
for (let k = 0; k < 30; k++) {
  const tau = randVec(3, 2); if (k < 3) tau[2] *= 1e-7;
  closeM(se2.Jr(tau), Lie.numJac(function (x) { return se2.exp(x); }, tau, 3, Lie.vecPlus, se2.minus), 1e-6, 'se2 Jr analytic = numeric');
  closeM(se2.Jl(tau), Lie.numJac(function (x) { return se2.exp(x); }, tau, 3, Lie.vecPlus, function (A, B) { return se2.log(mN.mul(A, se2.inv(B))); }), 1e-6, 'se2 Jl analytic = numeric');
}
{ // pure rotation leaves origin fixed; pure translation is a straight line
  const T = se2.exp([1, 0, Math.PI]);
  close(T[0][2], 0, 1e-12, 'se2 half-turn with rho=(1,0): x'); close(T[1][2], 2 / Math.PI, 1e-12, 'se2 half-turn: y = 2/pi');
}

// ---------------------------------------------------------------- SE(3)
section('SE(3)');
for (let k = 0; k < 40; k++) {
  const tau = randVec(6, 1.6);
  if (k < 4) { for (let i = 3; i < 6; i++) tau[i] *= 1e-6; }
  const T = se3.exp(tau);
  closeV(se3.log(T), tau, 1e-8, 'se3 log(exp(tau)) = tau');
  closeM(mN.mul(T, se3.inv(T)), mN.eye(4), 1e-12, 'se3 T T^-1 = I');
  const d = randVec(6, 0.4);
  closeM(mN.mul(T, se3.exp(d)), mN.mul(se3.exp(mN.mulV(se3.Ad(T), d)), T), 1e-11, 'se3 T Exp(d) = Exp(Ad_T d) T');
  const JrNum = Lie.numJac(function (x) { return se3.exp(x); }, tau, 6, Lie.vecPlus, function (A, B) { return se3.minus(A, B); });
  closeM(se3.Jr(tau), JrNum, 2e-6, 'se3 Jr analytic = numeric');
  const JlNum = Lie.numJac(function (x) { return se3.exp(x); }, tau, 6, Lie.vecPlus, function (A, B) { return se3.minusL(A, B); });
  closeM(se3.Jl(tau), JlNum, 2e-6, 'se3 Jl analytic = numeric');
  // action Jacobian: d(T p)/d d = [R, -R[p]x]
  const p = randVec(3, 1.5), R = se3.R(T);
  const Jact = [];
  const A1 = R, A2 = m3.scale(m3.mul(R, so3.hat(p)), -1);
  for (let i = 0; i < 3; i++) Jact.push(A1[i].concat(A2[i]));
  const JactNum = Lie.numJac(function (X) { return se3.act(X, p); }, T, 6, se3.plus, Lie.vecMinus);
  closeM(Jact, JactNum, 1e-6, 'se3 d(T p)/d delta = [R, -R[p]x]');
}
{ // screw motion: rotation about z with pitch
  const T = se3.exp([0, 0, 0.5, 0, 0, Math.PI / 2]);
  closeV(se3.t(T), [0, 0, 0.5], 1e-12, 'se3 translation along the rotation axis is unchanged');
}

// ---------------------------------------------------------------- alignment & averaging
section('Kabsch / averaging');
{
  const Rtrue = so3.random(rng), ttrue = [0.3, -1.2, 0.8];
  const P = [], Q = [];
  for (let i = 0; i < 12; i++) { const p = randVec(3, 2); P.push(p); Q.push(v3.add(m3.mulV(Rtrue, p), ttrue)); }
  const est = Lie.kabsch(P, Q);
  closeM(est.R, Rtrue, 1e-9, 'kabsch recovers R');
  closeV(est.t, ttrue, 1e-9, 'kabsch recovers t');
  closeM(Lie.projectSO3(Rtrue), Rtrue, 1e-9, 'projectSO3(R) = R');
  const M = m3.add(Rtrue, m3.scale(m3.I(), 0.05));
  close(m3.orthoError(Lie.projectSO3(M)), 0, 1e-9, 'projectSO3 output is orthogonal');
  close(m3.det(Lie.projectSO3(M)), 1, 1e-9, 'projectSO3 output has det 1');
  // Karcher mean of symmetric perturbations of R is R
  const Rs = [];
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  axes.forEach(function (a) { Rs.push(so3.plus(Rtrue, v3.scale(a, 0.3))); Rs.push(so3.plus(Rtrue, v3.scale(a, -0.3))); });
  closeM(so3.mean(Rs), Rtrue, 1e-9, 'Karcher mean of +/- perturbations = centre');
  close(so3.dist(so3.chordalMean(Rs), Rtrue), 0, 1e-9, 'chordal mean of symmetric set = centre');
}
// eigSym sanity
{
  const S = [[4, 1, 0], [1, 3, 1], [0, 1, 2]];
  const e = mN.eigSym(S);
  e.vectors.forEach(function (v, i) { closeV(mN.mulV(S, v), v.map(function (x) { return x * e.values[i]; }), 1e-10, 'eigSym S v = lambda v'); });
}
// solve / inv
{
  const A = [[4, 1, 2], [1, 5, 1], [2, 1, 6]];
  closeM(mN.mul(A, mN.inv(A)), mN.eye(3), 1e-12, 'mN.inv');
}

console.log('check-lie-viz: ' + (checks - failures) + '/' + checks + ' checks passed.');
process.exit(failures ? 1 : 0);
