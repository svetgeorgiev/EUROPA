import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { worldToGeo } from '../src/geo/coordinates.ts';
import { NOVA_ZAGORA_ANCHOR as anchor } from '../src/geo/worldConfig.ts';
import { normalizeOsmiumGeoJSON } from '../src/world/recoveryInput.ts';
import { buildWorldMap } from '../src/world/osm.ts';
import { buildNavigationData } from '../src/world/navigation.ts';
import { splitWorldMap } from '../src/world/chunkGrid.ts';
import { previewBuildingRecovery } from '../scripts/recovery-pipeline.mjs';

const at = (x,z) => {
  const { longitude,latitude } = worldToGeo({x,y:0,z},anchor);
  return [longitude,latitude];
};
const feature = (type,id,tags,geometry) => ({
  type:'Feature', properties:{'@type':type,'@id':id,...tags},geometry
});
const street = feature('way',11,{highway:'residential',name:'ул. Нова'},
  {type:'LineString',coordinates:[at(-90,0),at(90,0)]});
const baselineBuilding = feature('way',101,{building:'house'},
  {type:'Polygon',coordinates:[[at(-30,0),at(-20,0),at(-20,10),at(-30,10),at(-30,0)]]});
const addedBuilding=feature('way',102,{building:'school'},
  {type:'Polygon',coordinates:[[at(15,0),at(30,0),at(30,18),at(15,18),at(15,0)]]});
const poi=feature('node',201,{amenity:'school',name:'СУ Иван Вазов'},
  {type:'Point',coordinates:at(22,8)});
const named=feature('node',202,{amenity:'bank',name:'TBI Bank'},
  {type:'Point',coordinates:at(90,90)});
function raw(features) {return {type:'FeatureCollection',features};}
function convert(input) {
  const source=normalizeOsmiumGeoJSON(input,anchor);
  return {
    map:buildWorldMap({elements:source.elements},anchor,'source-date'),
    nav:buildNavigationData({elements:source.elements},anchor,'source-date')
  };
}
async function makeFixture() {
  const root=await mkdtemp(join(tmpdir(),'europa-recover-'));
  const worldDir=join(root,'public','worlds','nova-zagora');
  const reportPath=join(root,'report.json');
  const inputPath=join(root,'source.geojson');
  await mkdir(join(worldDir,'chunks'),{recursive:true});
  const old=convert(raw([street,baselineBuilding,poi,named]));
  const {manifest,chunks}=splitWorldMap(old.map);
  await writeFile(join(worldDir,'map.json'),JSON.stringify(old.map));
  await writeFile(join(worldDir,'navigation.json'),JSON.stringify(old.nav));
  await writeFile(join(worldDir,'chunks','manifest.json'),JSON.stringify(manifest));
  for(const chunk of chunks) {
    await writeFile(join(worldDir,'chunks',chunk.id+'.json'),JSON.stringify(chunk));
  }
  await writeFile(inputPath,JSON.stringify(raw([street,baselineBuilding,addedBuilding,poi,named])));
  const logger={info(){},warn(){}};
  return {root,worldDir,reportPath,inputPath,logger,old};
}

test('default recovery only writes a report and never touches working map/chunks', async () => {
  const fix=await makeFixture();
  try {
    const original=await readFile(join(fix.worldDir,'map.json'),'utf8');
    const manifest=await readFile(join(fix.worldDir,'chunks','manifest.json'),'utf8');
    const report=await previewBuildingRecovery({...fix,sourceDate:'2026-10-10T00:00:00Z'});
    assert.equal(report.before.buildingCount,1);
    assert.equal(report.candidate.buildingCount,2);
    assert.equal(report.addedBuildingCount,1);
    assert.equal(report.passedSafetyGate,true);
    assert.equal(JSON.parse(await readFile(fix.reportPath,'utf8')).candidate.buildingCount,2);
    assert.equal(await readFile(join(fix.worldDir,'map.json'),'utf8'),original);
    assert.equal(await readFile(join(fix.worldDir,'chunks','manifest.json'),'utf8'),manifest);
  } finally {await rm(fix.root,{recursive:true,force:true});}
});

test('explicit apply publishes coherent 16-tile map and navigation together', async () => {
  const fix=await makeFixture();
  try {
    const report=await previewBuildingRecovery({...fix,apply:true});
    assert.equal(report.addedBuildingCount,1);
    const map=JSON.parse(await readFile(join(fix.worldDir,'map.json'),'utf8'));
    const nav=JSON.parse(await readFile(join(fix.worldDir,'navigation.json'),'utf8'));
    const chunks=JSON.parse(await readFile(join(fix.worldDir,'chunks','manifest.json'),'utf8'));
    const sites=JSON.parse(await readFile(join(fix.worldDir,'sites.json'),'utf8'));
    assert.equal(map.buildings.length,2);
    assert.deepEqual(map.buildings.map(b=>b.sourceId).sort(),['way/101','way/102']);
    assert.equal(nav.collectedAt,map.collectedAt);
    assert.equal(nav.anchor.latitude,map.anchor.latitude);
    assert.equal(chunks.collectedAt,map.collectedAt);
    assert.equal(chunks.chunks.length,16);
    assert.equal(sites.source,'OpenStreetMap');
  } finally {await rm(fix.root,{recursive:true,force:true});}
});

test('failed mid-swap recovers all three original datasets and does not leave half-built chunks', async () => {
  const fix=await makeFixture();
  try {
    const before=await Promise.all(['map.json','navigation.json','chunks/manifest.json']
      .map(file=>readFile(join(fix.worldDir,file),'utf8')));
    await assert.rejects(previewBuildingRecovery({
      ...fix,apply:true,failAfterSwap:1
    }),/Injected commit-stage failure/);
    const after=await Promise.all(['map.json','navigation.json','chunks/manifest.json']
      .map(file=>readFile(join(fix.worldDir,file),'utf8')));
    assert.deepEqual(after,before);
    await assert.rejects(readFile(join(fix.worldDir,'sites.json'),'utf8'),/ENOENT/);
  } finally {await rm(fix.root,{recursive:true,force:true});}
});

test('apply refuses source that removes an existing OSM building without explicit review', async () => {
  const fix=await makeFixture();
  try {
    const current=convert(raw([street,baselineBuilding,addedBuilding,poi,named]));
    await writeFile(join(fix.worldDir,'map.json'),JSON.stringify(current.map));
    await writeFile(fix.inputPath,JSON.stringify(raw([street,baselineBuilding,poi,named])));
    const report=await previewBuildingRecovery(fix);
    assert.equal(report.passedSafetyGate,false);
    assert.ok(report.missingBuildingSources.includes('way/102'));
    await assert.rejects(previewBuildingRecovery({...fix,apply:true}),/Apply blocked/);
    const map=JSON.parse(await readFile(join(fix.worldDir,'map.json'),'utf8'));
    assert.equal(map.buildings.length,2);
  } finally {await rm(fix.root,{recursive:true,force:true});}
});

test('bad input fails before any data is overwritten', async () => {
  const fix=await makeFixture();
  try {
    await writeFile(fix.inputPath,JSON.stringify(raw([
      {type:'Feature',properties:{building:'yes'},geometry:addedBuilding.geometry}
    ])));
    const old=await readFile(join(fix.worldDir,'map.json'),'utf8');
    await assert.rejects(previewBuildingRecovery({...fix,apply:true}),/genuine OSM @type\/@id/);
    assert.equal(await readFile(join(fix.worldDir,'map.json'),'utf8'),old);
  } finally {await rm(fix.root,{recursive:true,force:true});}
});


test('integration: osmium dual area+line export yields real 2 building IDs, not 4 meshes', async () => {
  const fix=await makeFixture();
  try {
    const asLine = building => feature('way',
      building.properties['@id'],{ building: building.properties.building },{
      type:'LineString',coordinates:building.geometry.coordinates[0]
    });
    const dual=raw([street,asLine(baselineBuilding),baselineBuilding,
      asLine(addedBuilding),addedBuilding,poi,named]);
    await writeFile(fix.inputPath,JSON.stringify(dual));
    const report=await previewBuildingRecovery(fix);
    assert.equal(report.candidate.buildingCount,2);
    assert.equal(report.candidate.uniqueBuildingCount,2);
    assert.equal(report.candidate.duplicateBuildingSources.length,0);
    assert.equal(report.importStats.duplicateLinearBuildingRepresentations,2);
    assert.deepEqual(report.newBuildingSources,['way/102']);
    assert.equal(report.passedSafetyGate,true);
  } finally { await rm(fix.root,{recursive:true,force:true}); }
});
