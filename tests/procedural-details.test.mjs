import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFacadeDecor, buildRoadDecor
} from '../src/world/proceduralDetails.ts';
import { buildRoadGeometry } from '../src/world/meshGeometry.ts';

const at = (x, z) => ({ x, z });
const road = (id, a, b, highway = 'residential', widthMeters = 6) =>
  ({ id, a, b, highway, widthMeters });
const building = (id, outline, heightMeters = 6) =>
  ({ id, outline, heightMeters });

function upwardCross(positions, ia, ib, ic) {
  const ax = positions[ia * 3], az = positions[ia * 3 + 2];
  const bx = positions[ib * 3], bz = positions[ib * 3 + 2];
  const cx = positions[ic * 3], cz = positions[ic * 3 + 2];
  return (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
}

function hasValidGeometry(geom) {
  assert.equal(geom.positions.length % 3, 0);
  assert.equal(geom.normals.length, geom.positions.length);
  assert.equal(geom.indices.length % 3, 0);
  assert.ok(geom.positions.every(Number.isFinite));
  assert.ok(geom.normals.every(Number.isFinite));
  assert.ok(geom.indices.every(i => Number.isInteger(i) &&
    i >= 0 && i < geom.positions.length / 3));
  if (geom.colors) {
    assert.equal(geom.colors.length, geom.positions.length / 3 * 4);
    assert.ok(geom.colors.every(Number.isFinite));
  }
}

test('residential street receives two pavement strips and faded dash geometry', () => {
  const details = buildRoadDecor([road(1, at(0, 0), at(0, 40))]);
  assert.equal(details.shoulders.positions.length / 3, 8); // one on each side
  assert.equal(details.markings.positions.length / 3, 16); // four dashes
  for (const part of [details.shoulders, details.markings]) {
    hasValidGeometry(part);
    for (let i = 0; i < part.indices.length; i += 3) {
      assert.ok(upwardCross(part.positions, ...part.indices.slice(i, i + 3)) > 0,
        'road decoration must face upward');
    }
    for (let i = 0; i < part.normals.length; i += 3) {
      assert.deepEqual(part.normals.slice(i, i + 3), [0, 1, 0]);
    }
  }
  assert.equal(buildRoadDecor([road(1, at(0, 0), at(0, 40))]).markings.indices.length,
    details.markings.indices.length);
});

test('footpaths and service tracks receive no invented lane markings', () => {
  const details = buildRoadDecor([
    road(1, at(0, 0), at(0, 40), 'footway', 2),
    road(2, at(0, 0), at(40, 0), 'service', 4),
    road(3, at(0, 0), at(40, 0), 'track', 3)
  ]);
  assert.equal(details.markings.indices.length, 0);
  assert.equal(details.shoulders.indices.length, 0);
});

test('facade details include dark panes, visible frames and a doorway', () => {
  const footprint = building(20, [
    at(0, 0), at(20, 0), at(20, 10), at(0, 10)
  ], 6);
  const facade = buildFacadeDecor([footprint]);
  assert.ok(facade.indices.length > 0);
  hasValidGeometry(facade);
  const triplets = [];
  for (let i = 0; i < facade.colors.length; i += 4)
    triplets.push(facade.colors.slice(i, i + 3).join(','));
  assert.ok(triplets.includes('0.12,0.2,0.24'), 'window glass should be dark');
  assert.ok(triplets.includes('0.3,0.25,0.22'), 'one doorway should be visible');
  assert.ok(triplets.includes('0.54,0.56,0.53'), 'window frames should be visible');
  assert.deepEqual(buildFacadeDecor([footprint]), facade, 'detail placement is stable');
  assert.ok(facade.positions.every((n, i) => i % 3 !== 1 || (n >= 0 && n < 6)));
});

test('facade detail works for reversed building winding and many streamed buildings', () => {
  const footprints = Array.from({ length: 80 }, (_, i) => {
    const x = i % 10 * 20, z = Math.floor(i / 10) * 20;
    const outline = [at(x, z), at(x + 12, z), at(x + 12, z + 9), at(x, z + 9)];
    return building(i + 1, i % 2 ? outline.reverse() : outline, 6 + (i % 3) * 3);
  });
  const details = buildFacadeDecor(footprints);
  hasValidGeometry(details);
  assert.ok(details.indices.length > 80 * 6, 'there should be batched details');
  assert.ok(details.positions.length < 2_000_000, 'tiles need bounded detail geometry');
});

test('invalid footprints produce no decorative triangles', () => {
  const mesh = buildFacadeDecor([
    building(1, []),
    building(2, [at(0, 0), at(1, 0), at(0, 1)], 2),
    building(3, [at(NaN, 0), at(1, 0), at(0, 1)]),
    building(4, [at(0, 0), at(1, 0), at(2, 0)])
  ]);
  assert.equal(mesh.indices.length, 0);
});

test('asphalt ribbons include UV mapping for deterministic procedural grain', () => {
  const mesh = buildRoadGeometry([road(7, at(-2, 3), at(0, 19))]);
  assert.equal(mesh.positions.length / 3, 4);
  assert.equal(mesh.uvs.length, 8);
  assert.ok(mesh.uvs[7] > 1);
  assert.deepEqual(mesh.uvs.slice(0, 4), [0, 0, 1, 0]);
});
