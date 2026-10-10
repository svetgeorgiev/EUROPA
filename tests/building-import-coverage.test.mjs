import test from 'node:test';
import assert from 'node:assert/strict';
import { worldToGeo } from '../src/geo/coordinates.ts';
import { buildWorldMap } from '../src/world/osm.ts';
import { extractBuildings } from '../src/world/osmBuildingImports.ts';
import {
  evaluateLandmarkCoverage, getCoverageReport
} from '../src/world/buildingCoverage.ts';
const anchor = { latitude: 42.493, longitude: 26.011, elevationMeters: 0 };
const geo = (x, z) => {
  const p = worldToGeo({ x, y: 0, z }, anchor);
  return { lat: p.latitude, lon: p.longitude };
};
const way = (id, coords, tags = { building: 'yes' }) =>
  ({ type: 'way', id, tags, geometry: coords.map(([x,z]) => geo(x,z)) });
const ring = [[0,0],[12,0],[12,10],[0,10],[0,0]];
test('partially clipped real building footprints remain in world', () => {
  const source = { elements: [
    way(111, [[490, 0],[525, 0],[525, 20],[490,20],[490,0]])
  ] };
  const result = extractBuildings(source.elements, anchor);
  assert.equal(result.buildings.length, 1);
  assert.equal(result.clippedCount, 1);
  assert.equal(result.buildings[0].sourceId, 'way/111');
  assert.ok(result.buildings[0].outline.every(p => p.x <= 500.001));
  assert.ok(result.buildings[0].outline.some(p => Math.abs(p.x - 500) < 0.01));
  assert.equal(buildWorldMap(source, anchor).buildings.length, 1);
});
test('real OSM roof / height tags survive import as optional metadata', () => {
  const building = extractBuildings([way(123, ring, {
    building: 'house', 'roof:shape': 'gabled',
    'roof:material': 'tiles', 'roof:height': '1.8 m',
    'building:levels': '2'
  })], anchor).buildings[0];
  assert.equal(building.heightMeters, 6);
  assert.equal(building.buildingType, 'house');
  assert.equal(building.roofShape, 'gabled');
  assert.equal(building.roofMaterial, 'tiles');
  assert.equal(building.roofHeightMeters, 1.8);
});
test('simple relation outer members are joined without inventing a polygon', () => {
  const a=way(9, [[0,0],[12,0],[12,10]], {});
  const b=way(10, [[12,10],[0,10],[0,0]], {});
  const relation = { type: 'relation', id: 555,
    tags: { type: 'multipolygon', building: 'house', 'roof:shape': 'hipped' },
    members: [{ type:'way', ref:9, role:'outer' }, {type:'way',ref:10,role:'outer'}] };
  const result = extractBuildings([a,b,relation], anchor);
  assert.equal(result.relationCount, 1);
  assert.equal(result.buildings.length, 1);
  assert.equal(result.buildings[0].id, -555);
  assert.equal(result.buildings[0].sourceId, 'relation/555');
  assert.equal(result.buildings[0].roofShape, 'hipped');
});
test('multipolygon courtyards are not silently filled with solid collisions', () => {
  const outer = way(21, ring, {});
  const inner = way(22, [[3,3],[5,3],[5,5],[3,5],[3,3]], {});
  const relation = { type:'relation', id: 777,
    tags:{ type:'multipolygon', building:'yes' },
    members:[{type:'way',ref:21,role:'outer'},{type:'way',ref:22,role:'inner'}] };
  const result = extractBuildings([outer,inner,relation], anchor);
  assert.equal(result.buildings.length, 0);
  assert.equal(result.unsupportedRelations, 1);
});
test('bank POI without a matching footprint is never turned into a building', () => {
  const landmark = {
    id:'node/99', name:'TBI Bank', kind:'amenity:bank', point:{x:42,z:153}
  };
  const map = buildWorldMap({ elements: [
    way(200, ring),
    way(300, [[-60,0],[60,0]], {highway:'residential'})
  ] }, anchor);
  assert.equal(map.buildings.length, 1);
  const missing = evaluateLandmarkCoverage(landmark, map.buildings);
  assert.equal(missing.status, 'no-nearby-footprint');
  const report = getCoverageReport(map, {
    anchor, landmarks:[landmark], streets:[], schemaVersion:1,
    source:'OpenStreetMap', attribution:'© OpenStreetMap contributors',
    licenseUrl:'https://www.openstreetmap.org/copyright',
    collectedAt:'fixture', halfSizeMeters:500
  });
  assert.equal(report[0].status, 'no-nearby-footprint');
  assert.equal(map.buildings.length, 1, 'POI did not fabricate a physical mesh');
  const matched = evaluateLandmarkCoverage({ ...landmark, point:{x:5,z:4} }, map.buildings);
  assert.equal(matched.status, 'inside-footprint');
});
