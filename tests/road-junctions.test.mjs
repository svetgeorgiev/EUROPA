import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRoadSurface, roadCrossing, roadDecorIntervals } from '../src/world/roadJunctions.ts';
import { buildRoadDecor } from '../src/world/proceduralDetails.ts';

const p = (x, z) => ({ x, z });
const road = (id, a, b, widthMeters = 6) => ({
  id, a, b, widthMeters, highway: 'residential'
});

function surfaceArea(geometry) {
  let total = 0;
  for (let i = 0; i < geometry.indices.length; i += 3) {
    const [a, b, c] = geometry.indices.slice(i, i + 3);
    const pos = geometry.positions;
    const ax = pos[3*a], az = pos[3*a+2];
    const bx = pos[3*b], bz = pos[3*b+2];
    const cx = pos[3*c], cz = pos[3*c+2];
    const twiceArea = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    assert.ok(twiceArea > 0, 'all surface triangles must face upward');
    total += twiceArea / 2;
  }
  return total;
}

test('two perpendicular 6m roads become one non-overlapping crossing surface', () => {
  const segments = [
    road(1, p(-10, 0), p(10, 0)),
    road(2, p(0, -10), p(0, 10))
  ];
  const merged = mergeRoadSurface(segments);
  assert.ok(merged.indices.length >= 6);
  assert.ok(Math.abs(surfaceArea(merged) - 204) < 0.001, '6x20 + 6x20 - 6x6 = 204 m²');
  assert.equal(merged.normals.length, merged.positions.length);
  assert.equal(merged.uvs.length, merged.positions.length / 3 * 2);
  assert.ok(merged.uvs.every(Number.isFinite));
});

test('T junction and two same-direction overlaps do not double draw asphalt', () => {
  const t = mergeRoadSurface([
    road(1, p(-10, 0), p(10, 0)),
    road(2, p(0, 0), p(0, 10))
  ]);
  assert.ok(Math.abs(surfaceArea(t) - 162) < 0.001, 'T junction union area = 120 + 60 - 18');
  const duplicate = mergeRoadSurface([
    road(1, p(-10, 0), p(10, 0)),
    road(2, p(-10, 0), p(10, 0))
  ]);
  assert.ok(Math.abs(surfaceArea(duplicate) - 120) < 0.001);
});

test('adjacent streamed tiles own distinct halves without overlapping seams', () => {
  const segments = [road(9, p(-10, 0), p(10, 0))];
  const left = mergeRoadSurface(segments, { minX: -10, maxX: 0, minZ: -10, maxZ: 10 });
  const right = mergeRoadSurface(segments, { minX: 0, maxX: 10, minZ: -10, maxZ: 10 });
  assert.ok(Math.abs(surfaceArea(left) - 60) < 0.001);
  assert.ok(Math.abs(surfaceArea(right) - 60) < 0.001);
  assert.ok([...left.positions, ...right.positions].every(Number.isFinite));
  for (let i = 0; i < left.positions.length; i += 3) assert.ok(left.positions[i] <= 0.000001);
  for (let i = 0; i < right.positions.length; i += 3) assert.ok(right.positions[i] >= -0.000001);
});

test('crossing detector distinguishes intersection from parallel and distant ways', () => {
  const eastWest = road(1, p(-10, 0), p(10, 0));
  const northSouth = road(2, p(0, -10), p(0, 10));
  const cross = roadCrossing(eastWest, northSouth);
  assert.ok(cross);
  assert.ok(Math.abs(cross.distanceA - 10) < 0.00001);
  assert.ok(Math.abs(cross.distanceB - 10) < 0.00001);
  assert.equal(roadCrossing(eastWest, road(3, p(-10, 8), p(10, 8))), null);
  assert.equal(roadCrossing(eastWest, road(4, p(30, -5), p(30, 5))), null);
});

test('roadside strips and lane paint stop before street intersections', () => {
  const crossingRoads = [
    road(1, p(-20, 0), p(20, 0)),
    road(2, p(0, -20), p(0, 20))
  ];
  const intervals = roadDecorIntervals(crossingRoads, 0, 6.5);
  assert.deepEqual(intervals, [[0, 13.5], [26.5, 40]]);
  const { shoulders, markings } = buildRoadDecor(crossingRoads);
  assert.ok(shoulders.indices.length > 0);
  assert.ok(markings.indices.length > 0);
  for (const part of [shoulders, markings]) {
    for (let i = 0; i < part.positions.length; i += 3) {
      const x = part.positions[i], z = part.positions[i+2];
      assert.ok(Math.hypot(x, z) > 5.5, 'no decorative polygon crosses the junction centre');
    }
  }
});

test('road decorations can be clipped to exactly one tile boundary', () => {
  const bounds = { minX: -10, maxX: 0, minZ: -10, maxZ: 10 };
  const { shoulders, markings } = buildRoadDecor([
    road(1, p(-10, 0), p(10, 0))
  ], bounds);
  for (const part of [shoulders, markings]) {
    for (let i = 0; i < part.positions.length; i += 3) {
      assert.ok(part.positions[i] >= -10.00001 && part.positions[i] <= 0.00001);
      assert.ok(part.positions[i+2] >= -10.00001 && part.positions[i+2] <= 10.00001);
    }
  }
});

test('reject invalid bounds and ignore degenerate segments', () => {
  assert.throws(
    () => mergeRoadSurface([road(1, p(0,0), p(10,0))], {
      minX: 10, maxX: 0, minZ: -10, maxZ: 10
    }),
    RangeError
  );
  assert.equal(mergeRoadSurface([road(1, p(0,0), p(0,0))]).indices.length, 0);
});
