import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRoadsideTrees, buildTreeGeometry } from '../src/world/Streetscape.ts';
import { footprintDistance } from '../src/world/buildingCoverage.ts';

const p = (x, z) => ({ x, z });
const bounds = { minX: -125, maxX: 125, minZ: -125, maxZ: 125 };
const roads = [
  { id: 1, highway: 'residential', widthMeters: 6,
    a: p(-110, 0), b: p(110, 0) },
  { id: 2, highway: 'tertiary', widthMeters: 8,
    a: p(30, -110), b: p(30, 110) }
];
const buildings = [
  { id: 10, heightMeters: 6,
    outline: [p(-45, 4), p(-20, 4), p(-20, 20), p(-45, 20)] },
  { id: 11, heightMeters: 9,
    outline: [p(36, 30), p(56, 30), p(56, 50), p(36, 50)] }
];
function roadDistance(point, road) {
  const dx=road.b.x-road.a.x, dz=road.b.z-road.a.z;
  const t=Math.max(0,Math.min(1,(
    (point.x-road.a.x)*dx+(point.z-road.a.z)*dz)/(dx*dx+dz*dz)));
  return Math.hypot(point.x-road.a.x-dx*t,point.z-road.a.z-dz*t);
}
test('generated roadside trees are deterministic, bounded and never on a road', () => {
  const actual = generateRoadsideTrees(roads, buildings, bounds, 34);
  assert.ok(actual.length > 3, 'prototype should have visible roadside vegetation');
  assert.ok(actual.length <= 34, 'budget is respected');
  assert.deepEqual(actual, generateRoadsideTrees(roads, buildings, bounds, 34));
  for (const tree of actual) {
    assert.ok(tree.x >= bounds.minX+4 && tree.x < bounds.maxX-4);
    assert.ok(tree.z >= bounds.minZ+4 && tree.z < bounds.maxZ-4);
    assert.ok(tree.height >= 4.7 && tree.height <= 7.1);
    for (const road of roads) {
      assert.ok(roadDistance(tree, road) >= road.widthMeters / 2 + 2.09,
        'no foliage trunk centres on mapped streets');
    }
    for (const footprint of buildings) {
      assert.ok(footprintDistance(tree, footprint) >= 3.69,
        'trees must not intersect a mapped building footprint');
    }
  }
  for (let i=0;i<actual.length;i++) for(let j=i+1;j<actual.length;j++) {
    assert.ok(Math.hypot(actual[i].x-actual[j].x,actual[i].z-actual[j].z)>=9-1e-8);
  }
});
test('only mapped street categories generate urban verge planting', () => {
  const tracks = [{ ...roads[0], highway: 'footway' }];
  assert.deepEqual(generateRoadsideTrees(tracks, buildings, bounds), []);
});
test('trees are clipped to tile, so neighbours do not duplicate stems', () => {
  const left = {minX:-125,maxX:0,minZ:-125,maxZ:125};
  const right = {minX:0,maxX:125,minZ:-125,maxZ:125};
  const a=generateRoadsideTrees(roads,buildings,left);
  const b=generateRoadsideTrees(roads,buildings,right);
  assert.ok(a.every(t=>t.x<0));
  assert.ok(b.every(t=>t.x>=0));
  assert.ok(!a.some(t=>b.some(u=>t.x===u.x&&t.z===u.z)));
});
test('all foliage and trunks can be batched in two finite geometry buffers', () => {
  const placed=generateRoadsideTrees(roads,buildings,bounds,22);
  const geom=buildTreeGeometry(placed);
  for (const part of [geom.trunks,geom.foliage]) {
    assert.ok(part.indices.length>=placed.length*18);
    assert.equal(part.positions.length,part.normals.length);
    assert.equal(part.colors.length,part.positions.length/3*4);
    assert.equal(part.indices.length%3,0);
    assert.ok([...part.positions,...part.normals,...part.colors].every(Number.isFinite));
    assert.ok(part.indices.every(i=>Number.isSafeInteger(i)&&i>=0&&i<part.positions.length/3));
  }
  assert.deepEqual(buildTreeGeometry(placed),geom);
});
test('malformed/empty placement data fails closed without corrupt triangles', () => {
  assert.equal(buildTreeGeometry([]).foliage.indices.length,0);
  const invalid={ x:NaN,z:0,height:5,radius:2,shade:0 };
  assert.equal(buildTreeGeometry([invalid]).trunks.positions.length,0);
  assert.deepEqual(generateRoadsideTrees(roads,buildings, {
    minX:10,maxX:0,minZ:0,maxZ:30
  }),[]);
});
