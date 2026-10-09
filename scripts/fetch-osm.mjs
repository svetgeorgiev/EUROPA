import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { buildWorldMap } from '../src/world/osm.ts';
import { worldToGeo } from '../src/geo/coordinates.ts';
import { NOVA_ZAGORA_ANCHOR } from '../src/geo/worldConfig.ts';
import { listOverpassEndpoints, requestOverpass } from './overpass-client.mjs';
import { normalizeCoreMapJSON, requestCoreMap } from './osm-core-api.mjs';

const output = resolve('public/worlds/nova-zagora/map.json');
const argv = process.argv.slice(2);
const useCoreApi = argv.includes('--osm-api');
const inputAt = argv.indexOf('--input');
const inputFile = inputAt >= 0 ? argv[inputAt + 1] : null;
if (inputAt >= 0 && !inputFile) throw new Error('--input requires a JSON filepath');
if (useCoreApi && inputAt >= 0) throw new Error('Choose either --osm-api or --input, not both');

const min = worldToGeo({ x: -500, y: 0, z: -500 }, NOVA_ZAGORA_ANCHOR);
const max = worldToGeo({ x: 500, y: 0, z: 500 }, NOVA_ZAGORA_ANCHOR);
const bbox = [min.latitude, min.longitude, max.latitude, max.longitude].map(v => v.toFixed(7)).join(',');
const query = '[out:json][timeout:60];(way["highway"](' + bbox + ');way["building"](' + bbox + '););out geom;';

async function obtainData() {
  if (inputFile) {
    console.log('Using existing OpenStreetMap JSON:', inputFile);
    const data = JSON.parse(await readFile(resolve(inputFile), 'utf8'));
    // Accept both Overpass out geom JSON and OSM core /map.json exports.
    return data.elements?.some(element => element.type === 'way' && Array.isArray(element.nodes))
      ? normalizeCoreMapJSON(data) : data;
  }
  if (useCoreApi) return requestCoreMap(NOVA_ZAGORA_ANCHOR);
  return requestOverpass(query, { endpoints: listOverpassEndpoints(process.env.EUROPA_OVERPASS_URL) });
}

const source = await obtainData();
const generated = buildWorldMap(
  source,
  NOVA_ZAGORA_ANCHOR,
  source.osm3s?.timestamp_osm_base ?? new Date().toISOString()
);
console.log('Imported', generated.roads.length, 'road segments and', generated.buildings.length, 'building footprints.');
if (generated.roads.length < 10 || generated.buildings.length < 10) {
  throw new Error('Insufficient OSM features; refusing to replace an existing world. Check the bounding box and Overpass response.');
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(generated), 'utf8');
console.log('Saved real OpenStreetMap data to', output);
console.log('Source © OpenStreetMap contributors (ODbL 1.0): https://www.openstreetmap.org/copyright');
console.log('Restart or refresh Vite to see the real-world road/building layout.');
