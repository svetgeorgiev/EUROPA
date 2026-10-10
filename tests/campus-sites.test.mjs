import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCampusSiteData, isSchoolSite, insideMappedSite, mappedSchoolForLandmark,
  mappedBuildingsOnCampus, buildCampusSurface
} from '../src/world/CampusSites.ts';

const p=(x,z)=>({x,z});
const area=[p(0,0),p(80,0),p(80,80),p(0,80)];
const anchor={latitude:42.493,longitude:26.011,elevationMeters:0};
const school={
  sourceId:'way/301',name:'СУ Иван Вазов',kind:'amenity:school',
  outline:area,holes:[]
};
const source={
  schemaVersion:1,source:'OpenStreetMap',collectedAt:'2026-10-10T00:00:00Z',
  anchor,sites:[school]
};
const map={
  collectedAt:source.collectedAt,anchor,
  buildings:[
    {id:11,sourceId:'way/11',heightMeters:8,outline:[p(2,2),p(18,2),p(18,18),p(2,18)]},
    {id:12,sourceId:'way/12',heightMeters:8,outline:[p(25,2),p(40,2),p(40,18),p(25,18)]},
    {id:13,sourceId:'way/13',heightMeters:6,outline:[p(2,25),p(20,25),p(20,35),p(2,35)]},
    {id:14,sourceId:'way/14',heightMeters:6,outline:[p(110,110),p(130,110),p(130,120),p(110,120)]}
  ]
};
const landmark=(name,kind,x=45,z=42,id='node/345')=>({
  id,name,kind,point:p(x,z)
});

test('only matching local OSM snapshot/anchor enables optional school sites',()=>{
  assert.equal(isCampusSiteData(source,map),true);
  assert.equal(isSchoolSite(school),true);
  assert.equal(isSchoolSite({...school,kind:'leisure:park'}),false);
  assert.equal(isCampusSiteData({...source,collectedAt:'older'},map),false);
  assert.equal(isCampusSiteData({...source,anchor:{...anchor,latitude:42.4}},map),false);
  assert.equal(isCampusSiteData({...source,sites:[
    {...school,outline:[p(0,0),p(Infinity,1),p(0,30)]}
  ]},map),false);
  assert.equal(isCampusSiteData({...source,sites:[{
    ...school,sourceId:'invented/site'
  }]},map),false);
  assert.equal(isCampusSiteData(null,map),false);
});

test('a school node inside its named campus is identified, but unrelated POIs are not',()=>{
  const matched=mappedSchoolForLandmark(
    landmark('СУ Иван Вазов','amenity:school'),source.sites);
  assert.equal(matched?.sourceId,'way/301');
  assert.deepEqual(mappedBuildingsOnCampus(matched,map.buildings)
    .map(b=>b.sourceId),['way/11','way/12','way/13']);
  assert.equal(mappedSchoolForLandmark(
    landmark('TBI Bank','amenity:bank'),source.sites),null);
  assert.equal(mappedSchoolForLandmark(
    landmark('СУ Христо Ботев','amenity:school'),source.sites),null);
  assert.equal(mappedSchoolForLandmark(
    landmark('СУ Иван Вазов','amenity:school',140,140),source.sites),null);
  assert.equal(mappedSchoolForLandmark(
    landmark('СУ Иван Вазов','amenity:school',140,140,'way/301'),source.sites),
    school,'exactly the same OSM way is trusted');
});

test('campus holes exclude ground and any building inside a courtyard',()=>{
  const hole=[p(30,30),p(50,30),p(50,50),p(30,50)];
  const withHole={...school,holes:[hole]};
  assert.equal(insideMappedSite(p(40,40),withHole),false);
  assert.equal(insideMappedSite(p(10,10),withHole),true);
  const withCourtyardBuilding=[...map.buildings,{
    id:999,sourceId:'way/999',heightMeters:6,
    outline:[p(35,35),p(45,35),p(45,45),p(35,45)]
  }];
  assert.equal(mappedBuildingsOnCampus(withHole,withCourtyardBuilding).length,3);
  const geom=buildCampusSurface(withHole);
  assert.ok(geom && geom.indices.length>=6);
  assert.equal(geom.boundaryRings.length,2);
  let total=0;
  for(let i=0;i<geom.indices.length;i+=3){
    const v=geom.indices.slice(i,i+3).map(index=>({
      x:geom.positions[index*3],z:geom.positions[index*3+2],
      y:geom.positions[index*3+1]
    }));
    assert.ok(v.every(pt=>pt.y===0.018));
    const cross=(v[1].z-v[0].z)*(v[2].x-v[0].x)-
      (v[1].x-v[0].x)*(v[2].z-v[0].z);
    assert.ok(cross>0,'ground triangle faces up');
    total+=cross/2;
    const center=p(v.reduce((sum,pt)=>sum+pt.x,0)/3,
      v.reduce((sum,pt)=>sum+pt.z,0)/3);
    assert.equal(insideMappedSite(center,withHole),true);
  }
  assert.ok(Math.abs(total-(80*80-20*20))<0.1,
    'school tint respects inner courtyard and covers actual mapped area');
});

test('mapped school grounds are clipped to playable 1km² and never extrude buildings',()=>{
  const extending={
    ...school,outline:[p(470,-20),p(560,-20),p(560,40),p(470,40)]
  };
  const geom=buildCampusSurface(extending);
  assert.ok(geom);
  assert.ok(geom.positions.length>0);
  assert.ok(geom.positions.every(Number.isFinite));
  assert.ok(geom.positions.filter((_,i)=>i%3===0).every(x=>x<=500&&x>=-500));
  assert.ok(geom.positions.filter((_,i)=>i%3===2).every(z=>z<=500&&z>=-500));
  assert.ok(geom.positions.every((value,i)=>i%3!==1||value===0.018));
  assert.equal(buildCampusSurface({...school,kind:'amenity:bank'}),null);
  assert.equal(buildCampusSurface({...school,outline:[
    p(600,600),p(620,600),p(620,620),p(600,620)
  ]}),null);
  assert.equal(buildCampusSurface({...school,holes:[[
    p(1,1),p(NaN,3),p(2,5)
  ]]}),null);
});
