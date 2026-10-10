import test from 'node:test';
import assert from 'node:assert/strict';
import { worldToGeo } from '../src/geo/coordinates.ts';
import { NOVA_ZAGORA_ANCHOR as anchor } from '../src/geo/worldConfig.ts';
import { buildWorldMap } from '../src/world/osm.ts';
import { buildNavigationData } from '../src/world/navigation.ts';
import { normalizeOsmiumGeoJSON } from '../src/world/recoveryInput.ts';
import { auditLandmarks, compareRecovery, insideSite } from '../src/world/recoveryAudit.ts';

const at = (x,z) => {
  const geo = worldToGeo({ x, z, y: 0 }, anchor);
  return [geo.longitude, geo.latitude];
};
const feature = (type, id, tags, geometry) => ({
  type: 'Feature', properties: { '@type': type, '@id': id, ...tags }, geometry
});
const street = feature('way', 22, { highway: 'residential', name: 'ул. Примерна' },
  { type: 'LineString', coordinates: [at(-100,0),at(100,0)] });
const oldBuilding = feature('way', 101, { building: 'house' },
  { type: 'Polygon', coordinates: [[at(-30,-30),at(-20,-30),at(-20,-20),at(-30,-20),at(-30,-30)]] });
const addedBuilding = feature('way', 102, { building: 'school', 'building:levels': '2' },
  { type: 'Polygon', coordinates: [[at(15,15),at(30,15),at(30,30),at(15,30),at(15,15)]] });
const schoolNode = feature('node', 201, { amenity:'school', name:'СУ Иван Вазов' },
  {type:'Point', coordinates: at(20,20)});
const bankNode = feature('node', 202, { amenity:'bank', name:'TBI Bank' },
  {type:'Point',coordinates:at(90,90)});
const campus = feature('way', 301, { amenity:'school', name:'СУ Иван Вазов' },
  {type:'Polygon', coordinates:[[
    at(0,0),at(50,0),at(50,50),at(0,50),at(0,0)
  ]]});
function normalize(features) {
  return normalizeOsmiumGeoJSON({type:'FeatureCollection',features},anchor);
}
function world(data) {
  return buildWorldMap({elements:data.elements},anchor,'2026-10-10T00:00:00Z');
}
function navigation(data) {
  return buildNavigationData({elements:data.elements},anchor,'2026-10-10T00:00:00Z');
}

test('osmium GeoJSON converts real streets, named nodes, school sites and buildings', () => {
  const result=normalize([street,oldBuilding,addedBuilding,schoolNode,bankNode,campus]);
  const map=world(result), nav=navigation(result);
  assert.equal(map.roads.length,1);
  assert.equal(map.buildings.length,2);
  assert.deepEqual(map.buildings.map(b=>b.sourceId).sort(),['way/101','way/102']);
  assert.ok(result.sites.length===1);
  assert.equal(result.sites[0].name,'СУ Иван Вазов');
  assert.ok(nav.streets.some(s=>s.name==='ул. Примерна'));
  assert.ok(nav.landmarks.some(s=>s.name==='TBI Bank'));
  assert.ok(result.stats.namedSites===1);
});

test('campus polygon is evidence, never itself a fake physical building', () => {
  const data=normalize([street,oldBuilding,addedBuilding,schoolNode,bankNode,campus]);
  const audit=auditLandmarks(world(data),navigation(data),data.sites);
  const school=audit.landmarks.find(l=>l.name==='СУ Иван Вазов'&&l.id==='node/201');
  assert.ok(school);
  assert.equal(school.geometry,'inside-imported-building');
  assert.equal(school.verifiedBuildingSource,'way/102');
  assert.deepEqual(school.sites[0].campusBuildingIds,['way/102']);
  assert.equal(school.sites[0].nameAgrees,true);
  assert.ok(insideSite({x:22,z:22},data.sites[0]));
  const bank=audit.landmarks.find(l=>l.name==='TBI Bank');
  assert.equal(bank.geometry,'unmatched');
  assert.equal(bank.verifiedBuildingSource,null);
  assert.deepEqual(bank.sites,[]);
  assert.equal(world(data).buildings.length,2,'site way never fabricated a third building');
});

test('preview compares exact OSM source IDs and flags coverage regressions', () => {
  const baseline=normalize([street,oldBuilding,schoolNode,bankNode]);
  const next=normalize([street,oldBuilding,addedBuilding,schoolNode,bankNode,campus]);
  const result=compareRecovery(world(baseline),navigation(baseline),
    world(next),navigation(next),next.sites,'synthetic-test.geojson');
  assert.equal(result.addedBuildingCount,1);
  assert.deepEqual(result.newBuildingSources,['way/102']);
  assert.deepEqual(result.missingBuildingSources,[]);
  assert.equal(result.passedSafetyGate,true);
  assert.equal(result.before.countByGeometry['inside-imported-building'],0);
  assert.ok(result.candidate.countByGeometry['inside-imported-building']>=1);
  const regression=compareRecovery(world(next),navigation(next),
    world(baseline),navigation(baseline),[], 'regressed.geojson');
  assert.equal(regression.passedSafetyGate,false);
  assert.deepEqual(regression.missingBuildingSources,['way/102']);
});

test('OSM polygon holes and multi-outers are explicitly skipped as physical buildings', () => {
  const outer=[at(0,0),at(20,0),at(20,20),at(0,20),at(0,0)];
  const hole=[at(5,5),at(12,5),at(12,12),at(5,12),at(5,5)];
  const complex=feature('relation',404,{building:'yes',type:'multipolygon'},{
    type:'Polygon',coordinates:[outer,hole]
  });
  const multi=feature('relation',405,{building:'yes'},{
    type:'MultiPolygon',coordinates:[[outer],[outer.map(([x,y])=>[x+0.001,y])]]
  });
  const d=normalize([street,complex,multi]);
  assert.equal(d.stats.skippedComplexBuildingAreas,2);
  assert.equal(world(d).buildings.length,0);
});

test('a single true OSM relation outer polygon is imported with its relation ID', () => {
  const relation=feature('relation',503,{building:'school'},{
    type:'Polygon',coordinates:[[at(0,0),at(20,0),at(20,20),at(0,20),at(0,0)]]
  });
  const d=normalize([street,relation]);
  assert.equal(world(d).buildings.length,1);
  assert.equal(world(d).buildings[0].sourceId,'relation/503');
});

test('GeoJSON rejects anonymous GIS features: do not mint bogus OSM identities', () => {
  const anonymous={type:'Feature',properties:{building:'yes'},geometry:oldBuilding.geometry};
  assert.throws(()=>normalize([street,anonymous]),/genuine OSM @type\/@id/);
});

test('site geometry holes exclude their courtyard interiors from school evidence', () => {
  const site=feature('way',310,{amenity:'school',name:'School with courtyard'},{
    type:'Polygon',coordinates:[
      [at(-30,-30),at(30,-30),at(30,30),at(-30,30),at(-30,-30)],
      [at(-4,-4),at(4,-4),at(4,4),at(-4,4),at(-4,-4)]
    ]
  });
  const d=normalize([street,site]);
  assert.equal(d.sites.length,1);
  assert.equal(insideSite({x:0,z:0},d.sites[0]),false);
  assert.equal(insideSite({x:15,z:15},d.sites[0]),true);
  assert.equal(world(d).buildings.length,0);
});


test('school campus way keeps its area centroid when osmium also exports a LineString', () => {
  const linearCampus=feature('way',301,{amenity:'school',name:'СУ Иван Вазов'},{
    type:'LineString',coordinates:campus.geometry.coordinates[0]
  });
  for (const features of [[street,linearCampus,campus],
                          [street,campus,linearCampus]]) {
    const data=normalize(features);
    const landmarks=navigation(data).landmarks.filter(poi=>poi.id==='way/301');
    assert.equal(landmarks.length,1);
    assert.ok(Math.abs(landmarks[0].point.x-25)<0.3);
    assert.ok(Math.abs(landmarks[0].point.z-25)<0.3);
    assert.equal(data.sites.length,1,'campus area is preserved once');
    assert.equal(world(data).buildings.length,0,'campus is not a physical building');
  }
});


test('default osmium area+line export does not double-count buildings regardless of order', () => {
  const sameBuildingAsLine = feature('way',101,{building:'house'},{
    type:'LineString',coordinates:oldBuilding.geometry.coordinates[0]
  });
  for (const features of [
    [street,sameBuildingAsLine,oldBuilding,schoolNode],
    [street,oldBuilding,sameBuildingAsLine,schoolNode]
  ]) {
    const data=normalize(features);
    const map=world(data);
    assert.equal(map.buildings.length,1,'one actual OSM way is one building');
    assert.deepEqual(map.buildings.map(b=>b.sourceId),['way/101']);
    assert.equal(data.stats.duplicateLinearBuildingRepresentations,1);
    assert.equal(data.elements.filter(x=>x.type==='way'&&x.tags?.building).length,1);
  }
});

test('duplicated osmium line must not override the polygon school POI position', () => {
  const polygonSchool=feature('way',102,{
    building:'school',amenity:'school',name:'СУ Иван Вазов'
  },addedBuilding.geometry);
  const lineSchool=feature('way',102,{
    building:'school',amenity:'school',name:'СУ Иван Вазов'
  },{type:'LineString',coordinates:addedBuilding.geometry.coordinates[0]});
  const data=normalize([street,lineSchool,polygonSchool]);
  const poi=navigation(data).landmarks.find(item=>item.id==='way/102');
  assert.ok(poi);
  assert.ok(Math.abs(poi.point.x-22.5)<0.3,'POI is polygon centroid, not a line midpoint');
  assert.ok(Math.abs(poi.point.z-22.5)<0.3);
  assert.equal(world(data).buildings.length,1);
});

test('invalid courtyard building cannot sneak into physical map via duplicate LineString', () => {
  const outer=[at(0,0),at(30,0),at(30,30),at(0,30),at(0,0)];
  const hole=[at(10,10),at(20,10),at(20,20),at(10,20),at(10,10)];
  const area=feature('way',600,{building:'yes'},{
    type:'Polygon',coordinates:[outer,hole]
  });
  const line=feature('way',600,{building:'yes'},{
    type:'LineString',coordinates:outer
  });
  const data=normalize([street,line,area]);
  assert.equal(world(data).buildings.length,0);
  assert.equal(data.stats.skippedComplexBuildingAreas,1);
  assert.equal(data.stats.duplicateLinearBuildingRepresentations,1);
});

test('safety gate blocks any duplicated source identity even when total footprint count grows', () => {
  const previous=normalize([street,oldBuilding,schoolNode,bankNode]);
  const oldMap=world(previous);
  const duplicateCandidate={...oldMap,buildings:[
    ...oldMap.buildings,
    {...oldMap.buildings[0],outline:[...oldMap.buildings[0].outline]}
  ]};
  const report=compareRecovery(oldMap,navigation(previous),
    duplicateCandidate,navigation(previous),[],'duplicated-source.geojson');
  assert.equal(report.candidate.buildingCount,2);
  assert.equal(report.candidate.uniqueBuildingCount,1);
  assert.deepEqual(report.candidate.duplicateBuildingSources,['way/101']);
  assert.equal(report.passedSafetyGate,false);
  assert.ok(report.reviewWarnings.some(line=>line.includes('multiple 3D footprints')));
});


test('real-shaped osmium simple one-ring MultiPolygon keeps its actual OSM way ID', () => {
  const id=1016083252;
  const ring=[at(10,10),at(30,10),at(30,30),at(10,30),at(10,10)];
  const linear=feature('way',id,{building:'yes'},{
    type:'LineString',coordinates:ring
  });
  const area=feature('way',id,{building:'yes'},{
    type:'MultiPolygon',coordinates:[[ring]]
  });
  for (const features of [[street,linear,area],[street,area,linear]]) {
    const n=normalize(features);
    assert.equal(n.stats.duplicateLinearBuildingRepresentations,1);
    assert.equal(n.stats.skippedComplexBuildingAreas,0);
    const buildings=world(n).buildings;
    assert.equal(buildings.length,1);
    assert.equal(buildings[0].sourceId,'way/1016083252');
  }
});

test('geometry inspection identifies both valid and boundary-rejected outlines', async () => {
  const { inspectBuildingFootprint } = await import('../src/world/osmBuildingImports.ts');
  const toLatLon=([lon,lat])=>({lon,lat});
  const shape=(points)=>points.map(atPoint=>toLatLon(at(...atPoint)));
  const inside=inspectBuildingFootprint(shape([
    [10,10],[30,10],[30,30],[10,30],[10,10]
  ]),anchor);
  assert.equal(inside.status,'accepted');
  assert.ok(inside.importedAreaMeters2>300);
  const outside=inspectBuildingFootprint(shape([
    [540,10],[555,10],[555,30],[540,30],[540,10]
  ]),anchor);
  assert.equal(outside.status,'outside-world');
  const smallSliver=inspectBuildingFootprint(shape([
    [499.99,10],[520,10],[520,30],[499.99,30],[499.99,10]
  ]),anchor);
  assert.equal(smallSliver.status,'clip-rejected');
  assert.ok(smallSliver.sourceAreaMeters2>100);
});

test('read-only CLI inspector finds simple one-ring MultiPolygon without modifying map data', async () => {
  const { inspectRecoveryBuilding } = await import('../scripts/inspect-recovery-building.mjs');
  const id=1016083252;
  const ring=[at(10,10),at(30,10),at(30,30),at(10,30),at(10,10)];
  const input={type:'FeatureCollection',features:[
    street,
    feature('way',id,{building:'yes'},{type:'LineString',coordinates:ring}),
    feature('way',id,{building:'yes'},{type:'MultiPolygon',coordinates:[[ring]]})
  ]};
  const messages=[];
  const result=inspectRecoveryBuilding(input,'way/1016083252',{
    info:s=>messages.push(s)
  });
  assert.deepEqual(result,{sourceId:'way/1016083252',
    rawCount:2, normalizedCount:1, importedCount:1});
  assert.ok(messages.some(s=>s.includes('Clipping status: accepted')));
  assert.ok(messages.some(s=>s.includes('MultiPolygon, polygons=1')));
});
