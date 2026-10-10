import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_MOTION, applyDamage, stepPlanarMotion } from '../src/game/motionPhysics.ts';

test('player starts smoothly and approaches walk speed without overshooting', () => {
  let v = { x: 0, z: 0 };
  const first = stepPlanarMotion(v, { x: 0, z: 1 }, 0.016, true, false);
  assert.ok(first.z > 0 && first.z < DEFAULT_MOTION.walkSpeed);
  v = first;
  for (let i = 0; i < 120; i++) v = stepPlanarMotion(v, { x: 0, z: 1 }, 0.016, true, false);
  assert.ok(Math.abs(v.z - DEFAULT_MOTION.walkSpeed) < 0.00001);
  assert.equal(v.x, 0);
});

test('sprint approaches a higher speed; no diagonal advantage', () => {
  let v = { x: 0, z: 0 };
  for (let i = 0; i < 100; i++) v = stepPlanarMotion(v, { x: 1, z: 1 }, 0.02, true, true);
  assert.ok(Math.abs(Math.hypot(v.x, v.z) - DEFAULT_MOTION.sprintSpeed) < 1e-4);
});

test('stopping decelerates and airborne steering is deliberately weaker', () => {
  const initial = { x: 0, z: 4 };
  const grounded = stepPlanarMotion(initial, { x: 0, z: 0 }, 0.02, true, false);
  const airborne = stepPlanarMotion(initial, { x: 0, z: 0 }, 0.02, false, false);
  assert.ok(grounded.z < airborne.z);
  assert.ok(airborne.z < initial.z);
});

test('large and negative deltas are bounded for stable movement', () => {
  const v = stepPlanarMotion({ x: 0, z: 0 }, { x: 0, z: 1 }, 100, true, false);
  assert.ok(v.z <= DEFAULT_MOTION.acceleration * 0.05);
  const stopped = stepPlanarMotion(v, { x: 0, z: 1 }, -3, true, false);
  assert.deepEqual(stopped, v);
});

test('damage reduces health without negative values or accidental healing', () => {
  assert.equal(applyDamage(3, 1), 2);
  assert.equal(applyDamage(1, 5), 0);
  assert.equal(applyDamage(2, -99), 2);
  assert.equal(applyDamage(0, 1), 0);
});
