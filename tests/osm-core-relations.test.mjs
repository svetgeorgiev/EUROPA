import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCoreMapJSON } from '../scripts/osm-core-api.mjs';
test('OSM core relation retains untagged outer member ways for building importer', () => {
  const elements = [
    {type:'node',id:1,lat:42.493,lon:26.011},
    {type:'node',id:2,lat:42.493,lon:26.0111},
    {type:'node',id:3,lat:42.4931,lon:26.0111},
    {type:'node',id:4,lat:42.4931,lon:26.011},
    {type:'way',id:9,nodes:[1,2,3]},
    {type:'way',id:10,nodes:[3,4,1]},
    {type:'relation',id:42,tags:{type:'multipolygon',building:'yes'},
      members:[{type:'way',ref:9,role:'outer'},{type:'way',ref:10,role:'outer'}]}
  ];
  const result = normalizeCoreMapJSON({elements});
  assert.equal(result.elements.filter(x=>x.type==='way').length,2);
  assert.equal(result.elements.filter(x=>x.type==='relation').length,1);
  assert.equal(result.elements.find(x=>x.type==='relation').members.length,2);
});
