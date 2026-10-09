import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorldMap, isWorldMap } from '../src/world/osm.ts';

const anchor = { latitude: 42.493, longitude: 26.011, elevationMeters: 0 };
const p = (x, z) => ({ lat: anchor.latitude + z * 0.000009, lon: anchor.longitude + x * 0.000012 });
const data = {
  elements: [
    { type: 'way', id: 1, tags: { highway: 'residential' }, geometry: [p(-600, 0), p(0, 0), p(600, 0)] },
    { type: 'way', id: 2, tags: { building: 'yes', 'building:levels': '3' }, geometry: [p(10, 10), p(35, 10), p(35, 30), p(10, 30), p(10, 10)] },
    { type: 'way', id: 3, tags: { building: 'yes' }, geometry: [p(0, 0), p(15, 0), p(15, 15)] },
    { type: 'node', id: 4, tags: { highway: 'residential' }, geometry: [p(0, 0), p(1, 1)] }
  ]
};
test('generates real road segments and closed building footprints only', () => {
  const world = buildWorldMap(data, anchor, '2026-01-01T00:00:00Z');
  assert.equal(world.roads.length, 2);
  assert.equal(world.buildings.length, 1);
  assert.equal(world.buildings[0].heightMeters, 9);
  assert.equal(world.buildings[0].outline.length, 4);
  assert.ok(isWorldMap(world));
  assert.equal(world.collectedAt, '2026-01-01T00:00:00Z');
});
test('clips road segments at the configured geographic square', () => {
  const world = buildWorldMap(data, anchor);
  for (const road of world.roads) {
    for (const v of [road.a, road.b]) {
      assert.ok(Math.abs(v.x) <= 510.001);
      assert.ok(Math.abs(v.z) <= 510.001);
    }
  }
});
test('rejects invalid Overpass responses', () => {
  assert.throws(() => buildWorldMap({ elements: null }, anchor));
  assert.equal(isWorldMap({ roads: [], buildings: [], source: 'OpenStreetMap' }), false);
});
