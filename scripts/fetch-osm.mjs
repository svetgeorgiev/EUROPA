import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { buildWorldMap } from '../src/world/osm.ts';
import { worldToGeo } from '../src/geo/coordinates.ts';
import { NOVA_ZAGORA_ANCHOR } from '../src/geo/worldConfig.ts';

const output = resolve('public/worlds/nova-zagora/map.json');
const argv = process.argv.slice(2);
const inputAt = argv.indexOf('--input');
const inputFile = inputAt >= 0 ? argv[inputAt + 1] : null;
if (inputAt >= 0 && !inputFile) throw new Error('--input requires a JSON filepath');

const min = worldToGeo({ x: -500, y: 0, z: -500 }, NOVA_ZAGORA_ANCHOR);
const max = worldToGeo({ x: 500, y: 0, z: 500 }, NOVA_ZAGORA_ANCHOR);
const bbox = [min.latitude, min.longitude, max.latitude, max.longitude].map(v => v.toFixed(7)).join(',');
const query = '[out:json][timeout:60];(way["highway"](' + bbox + ');way["building"](' + bbox + '););out geom;';
const endpoints = [
  process.env.EUROPA_OVERPASS_URL,
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
].filter(Boolean);

async function obtainData() {
  if (inputFile) {
    console.log('Using existing OSM Overpass JSON:', inputFile);
    return JSON.parse(await readFile(resolve(inputFile), 'utf8'));
  }
  let lastError;
  for (const endpoint of endpoints) {
    try {
      console.log('Fetching OpenStreetMap extract from', endpoint, '(may take up to 70 seconds)...');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(75000),
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (!Array.isArray(data.elements)) throw new Error('Invalid Overpass response');
      return data;
    } catch (error) {
      lastError = error;
      console.warn('Overpass endpoint failed:', String(error));
    }
  }
  throw new Error('Could not fetch OSM data. Try again later or use pnpm map:fetch -- --input path/to/overpass.json. Last error: ' + String(lastError));
}

const source = await obtainData();
const generated = buildWorldMap(source, NOVA_ZAGORA_ANCHOR, new Date().toISOString());
console.log('Imported', generated.roads.length, 'road segments and', generated.buildings.length, 'building footprints.');
if (generated.roads.length < 10 || generated.buildings.length < 10) {
  throw new Error('Insufficient OSM features; refusing to replace an existing world. Check the bounding box and Overpass response.');
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(generated), 'utf8');
console.log('Saved real OpenStreetMap data to', output);
console.log('Source © OpenStreetMap contributors (ODbL 1.0): https://www.openstreetmap.org/copyright');
console.log('Restart or refresh Vite to see the real-world road/building layout.');
