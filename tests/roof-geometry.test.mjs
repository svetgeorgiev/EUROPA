import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoofGeometry, chooseRoofStyle } from '../src/world/roofGeometry.ts';
const p = (x, z) => ({ x, z });
const house = {
  id: 101, heightMeters: 6,
  outline: [p(0,0), p(16,0), p(16,9), p(0,9)]
};
function verifyRoof(roof) {
  assert.ok(roof);
  assert.ok(roof.indices.length >= 12);
  assert.equal(roof.positions.length, roof.normals.length);
  assert.equal(roof.uvs.length, roof.positions.length / 3 * 2);
  assert.ok([...roof.positions, ...roof.normals, ...roof.uvs].every(Number.isFinite));
  assert.ok(roof.positions.some((_, i) => i % 3 === 1 &&
    roof.positions[i] > house.heightMeters + 0.5), 'visible ridge');
  assert.ok(roof.indices.every(i => i >= 0 && i < roof.positions.length / 3));
}
test('smaller rectangular footprints get a clearly pitched gable roof', () => {
  assert.equal(chooseRoofStyle(house), 'gabled');
  verifyRoof(buildRoofGeometry(house));
});
test('explicit OSM flat roofs and large apartment blocks remain flat', () => {
  assert.equal(chooseRoofStyle({ ...house, roofShape: 'flat' }), 'flat');
  assert.equal(buildRoofGeometry({ ...house, roofShape: 'flat' }), null);
  assert.equal(chooseRoofStyle({ ...house, buildingType: 'apartments' }), 'flat');
});
test('hipped and tagged roof heights create deterministic roof geometry', () => {
  const input = { ...house, roofShape: 'hipped', roofHeightMeters: 1.8 };
  const geometry = buildRoofGeometry(input);
  verifyRoof(geometry);
  assert.deepEqual(buildRoofGeometry(input), geometry);
  const highest = Math.max(...geometry.positions.filter((_, i) => i % 3 === 1));
  assert.ok(highest > 7.8 && highest < 8.0);
});
test('non-rectangular/very tiny footprints never produce fake pitched roofs', () => {
  const shape = { ...house, outline: [p(0,0), p(8,0), p(3,8)] };
  assert.equal(chooseRoofStyle(shape), 'flat');
  assert.equal(buildRoofGeometry({ ...shape, roofShape: 'gabled' }), null);
  assert.equal(buildRoofGeometry({ ...house, outline: [p(0,0),p(1,0),p(1,1),p(0,1)] }), null);
});
test('a rotated footprint produces the same style and valid roof triangles', () => {
  const transformed = { ...house,
    outline: [p(0,0), p(0,16), p(-9,16), p(-9,0)] };
  assert.equal(chooseRoofStyle(transformed), 'gabled');
  verifyRoof(buildRoofGeometry(transformed));
});
