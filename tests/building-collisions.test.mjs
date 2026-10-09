import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingCollisionField } from '../src/world/buildingCollisions.ts';

const square = (id, x0, z0, x1, z1, reverse = false) => ({
  id,
  heightMeters: 8,
  outline: (reverse ? [
    { x: x0, z: z0 }, { x: x0, z: z1 },
    { x: x1, z: z1 }, { x: x1, z: z0 }
  ] : [
    { x: x0, z: z0 }, { x: x1, z: z0 },
    { x: x1, z: z1 }, { x: x0, z: z1 }
  ])
});

test('building footprints are solid from both directions, independent of polygon winding', () => {
  const field = new BuildingCollisionField();
  field.setGroup('tile', [square(1, -1, -1, 1, 1)]);
  assert.equal(field.isBlocked({ x: 0, z: 0 }, 0.45), true);
  assert.equal(field.isBlocked({ x: -1.3, z: 0 }, 0.45), true);
  assert.equal(field.isBlocked({ x: -1.5, z: 0 }, 0.45), false);
  let fromLeft = { x: -5, z: 0 };
  let fromRight = { x: 5, z: 0 };
  for (let i = 0; i < 50; i++) {
    fromLeft = field.move(fromLeft, { x: 0.42, z: 0 }, 0.45);
    fromRight = field.move(fromRight, { x: -0.42, z: 0 }, 0.45);
  }
  assert.ok(fromLeft.x <= -1.45, 'cannot cross facade from outside');
  assert.ok(fromRight.x >= 1.45, 'cannot cross facade from opposite side');
  assert.ok(!field.isBlocked(fromLeft, 0.45));
  assert.ok(!field.isBlocked(fromRight, 0.45));

  field.setGroup('tile', [square(1, -1, -1, 1, 1, true)]);
  assert.ok(field.isBlocked({ x: 0, z: 0 }, 0.45));
  assert.ok(field.isBlocked({ x: 1.3, z: 0 }, 0.45));
});

test('diagonal movement slides along walls instead of stepping into the polygon', () => {
  const field = new BuildingCollisionField();
  field.setGroup('nearby', [square(2, 0, -10, 10, 10)]);
  let player = { x: -0.8, z: -8 };
  for (let i = 0; i < 50; i++) player = field.move(player, { x: 0.3, z: 0.2 }, 0.45);
  assert.ok(player.x < -0.44, 'keeps horizontal clearance');
  assert.ok(player.z > -4, 'still progresses parallel to facade');
  assert.ok(!field.isBlocked(player, 0.45));
});

test('fast movement cannot tunnel through narrow buildings or diagonally across corners', () => {
  const field = new BuildingCollisionField();
  field.setGroup('tile', [square(3, -0.15, -1, 0.15, 1)]);
  const player = field.move({ x: -3, z: 0 }, { x: 6, z: 0 }, 0.45);
  assert.ok(player.x < -0.59);
  assert.ok(!field.isBlocked(player, 0.45));
  const corner = field.move({ x: -1.0, z: -1.0 }, { x: 1.1, z: 1.1 }, 0.45);
  assert.ok(!field.isBlocked(corner, 0.45));
});

test('spawn inside an imported building gets a safe position outside its perimeter', () => {
  const field = new BuildingCollisionField();
  field.setGroup('tile', [square(4, -8, -8, 8, 8)]);
  const safe = field.findSafePosition({ x: 0, z: 0 }, 0.45, 500, 60);
  assert.ok(safe);
  assert.ok(Math.hypot(safe.x, safe.z) >= 8.4);
  assert.equal(field.isBlocked(safe, 0.45), false);
  const walked = field.move(safe, { x: -3, z: 0 }, 0.45);
  assert.ok(!field.isBlocked(walked, 0.45));
});

test('loaded tile collision data can be removed as the world streams', () => {
  const field = new BuildingCollisionField();
  const building = square(5, 10, 10, 20, 20);
  field.setGroup('2_2', [building]);
  assert.ok(field.isBlocked({ x: 15, z: 15 }, 0.45));
  field.removeGroup('2_2');
  assert.equal(field.isBlocked({ x: 15, z: 15 }, 0.45), false);
  field.setGroup('2_2', [building]);
  field.clear();
  assert.equal(field.isBlocked({ x: 15, z: 15 }, 0.45), false);
});

test('concave footprints remain blocked inside and near all corners', () => {
  const field = new BuildingCollisionField();
  field.setGroup('tile', [{
    id: 6, heightMeters: 6,
    outline: [
      { x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 2 },
      { x: 2, z: 2 }, { x: 2, z: 10 }, { x: 0, z: 10 }
    ]
  }]);
  assert.ok(field.isBlocked({ x: 1, z: 8 }, 0.45));
  assert.ok(field.isBlocked({ x: 8, z: 1 }, 0.45));
  assert.ok(!field.isBlocked({ x: 8, z: 8 }, 0.45));
  assert.ok(field.isBlocked({ x: 2.2, z: 2.2 }, 0.45));
});

test('handles malformed/empty outlines without poisoning the world', () => {
  const field = new BuildingCollisionField();
  field.setGroup('tile', [
    { id: 1, heightMeters: 6, outline: [] },
    { id: 2, heightMeters: 6, outline: [{ x: NaN, z: 0 }, { x: 1, z: 1 }, { x: 1, z: 0 }] }
  ]);
  assert.equal(field.isBlocked({ x: 10, z: 10 }, 0.45), false);
  assert.equal(field.isBlocked({ x: Infinity, z: 10 }, 0.45), true);
});
