import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CORE_API_HEADERS, makeCoreMapUrl } from './osm-core-api.mjs';
import { NOVA_ZAGORA_ANCHOR } from '../src/geo/worldConfig.ts';
import { exportNavigation } from './navigation-writer.mjs';

const args = process.argv.slice(2);
const inputAt = args.indexOf('--input');
const input = inputAt >= 0 ? args[inputAt + 1] : null;
const core = args.includes('--osm-api');
if (args.includes('--help')) {
  console.log('Usage: pnpm map:nav --input path/to/osm-map.json');
  console.log('   or: pnpm map:nav --osm-api   (one-time small-area prototype request)');
  process.exit(0);
}
if (inputAt >= 0 && !input) throw new Error('--input requires a JSON filepath');
if (Boolean(input) === core) {
  throw new Error('Choose exactly one: --input path/to/raw-osm.json OR --osm-api');
}
let raw;
if (input) {
  console.log('Importing named OSM streets and landmarks from:', input);
  raw = JSON.parse(await readFile(resolve(input), 'utf8'));
} else {
  // Explicit opt-in; never request OSM upstream automatically on page load.
  // Use a saved raw extract for repeated builds or a future proper OSM PBF.
  const url = makeCoreMapUrl(NOVA_ZAGORA_ANCHOR);
  console.log('One-time 1 km² OSM main API metadata bootstrap.');
  console.log('This is not suitable for production, per-player or bulk map requests.');
  const response = await fetch(url, {
    method: 'GET',
    headers: CORE_API_HEADERS,
    signal: AbortSignal.timeout(90000)
  });
  if (!response.ok) {
    throw new Error('OpenStreetMap API HTTP ' + response.status +
      ' — do not retry rapidly; use --input with a previously saved source instead.');
  }
  const length = Number(response.headers.get('content-length'));
  if (length > 25_000_000) throw new Error('OSM API response exceeds the prototype limit');
  raw = await response.json();
}
await exportNavigation(raw);
console.log('Refresh the running EUROPA browser tab to load real OSM names.');
