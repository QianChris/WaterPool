const test = require('node:test');
const assert = require('node:assert');
const Physics = require('../physics.js');

function approx(actual, expected, eps = 1e-6) {
  assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} to be ~${expected}, got ${actual}`);
}

test('worldToTex maps world corners to texture [0,1]', () => {
  assert.deepStrictEqual(Physics.worldToTex(0, 0), { u: 0.5, v: 0.5 });
  assert.deepStrictEqual(Physics.worldToTex(Physics.HALF_W, Physics.HALF_D), { u: 1, v: 1 });
  assert.deepStrictEqual(Physics.worldToTex(-Physics.HALF_W, -Physics.HALF_D), { u: 0, v: 0 });
});

test('texToWorld inverts worldToTex', () => {
  const t = Physics.worldToTex(-1, -1.5);
  const w = Physics.texToWorld(t.u, t.v);
  approx(w.x, -1);
  approx(w.z, -1.5);
});

test('submergedVolume is zero above water, half at surface, full below', () => {
  const full = (4 / 3) * Math.PI * Math.pow(0.25, 3);
  assert.strictEqual(Physics.submergedVolume(0.25, 1, 0), 0);
  approx(Physics.submergedVolume(0.25, 0, 0), full / 2);
  approx(Physics.submergedVolume(0.25, -0.5, 0), full);
});

test('verticalAccel is zero at half-submerged equilibrium for density 0.5', () => {
  const ball = Physics.createBall(0, 0, 0, 0.25, 0.5);
  approx(Physics.verticalAccel(ball, 0), 0);
});

test('verticalAccel is upward when fully submerged for density 0.5', () => {
  const ball = Physics.createBall(0, -0.5, 0, 0.25, 0.5);
  assert.ok(Physics.verticalAccel(ball, 0) > 0);
});

test('resolveBallBall separates overlap and reverses equal-mass head-on velocities', () => {
  const a = Physics.createBall(-0.2, 0, 0, 0.25, 1);
  const b = Physics.createBall(0.2, 0, 0, 0.25, 1);
  a.vx = 1;
  b.vx = -1;
  Physics.resolveBallBall(a, b);
  const dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  assert.ok(dist >= 0.5, `distance after resolve ${dist} should be >= 0.5`);
  assert.ok(a.vx < 0, `a.vx ${a.vx} should be < 0`);
  assert.ok(b.vx > 0, `b.vx ${b.vx} should be > 0`);
});

test('resolveWall clamps and bounces off right wall', () => {
  const b = Physics.createBall(Physics.HALF_W - 0.25 + 0.1, 0, 0, 0.25, 1);
  b.vx = 1;
  Physics.resolveWall(b);
  assert.ok(b.x <= Physics.HALF_W - 0.25, `x ${b.x} clamped`);
  assert.ok(b.vx < 0, `vx ${b.vx} bounced`);
});

test('resolveWall clamps and bounces off floor', () => {
  const b = Physics.createBall(0, -0.9, 0, 0.25, 1);
  b.vy = -1;
  Physics.resolveWall(b);
  assert.ok(b.y >= Physics.POOL_BOTTOM + 0.25, `y ${b.y} clamped`);
  assert.ok(b.vy > 0, `vy ${b.vy} bounced`);
});