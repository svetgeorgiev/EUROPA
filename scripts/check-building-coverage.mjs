import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isWorldMap } from '../src/world/osm.ts';
import { isNavigationData } from '../src/world/navigation.ts';
import { getCoverageReport } from '../src/world/buildingCoverage.ts';

const args = process.argv.slice(2);
const index = args.indexOf('--name');
const searchName = index >= 0 ? args[index + 1] : '';
if (index >= 0 && !searchName) throw new Error('--name requires a landmark name');
const root = resolve('public/worlds/nova-zagora');
const map = JSON.parse(await readFile(resolve(root, 'map.json'), 'utf8'));
const navigation = JSON.parse(await readFile(resolve(root, 'navigation.json'), 'utf8'));
if (!isWorldMap(map) || !isNavigationData(navigation, map.anchor)) {
  throw new Error('Valid map.json and navigation.json from the same Nova Zagora anchor are required');
}
const report = getCoverageReport(map, navigation);
const counts = Object.fromEntries([
  'inside-footprint', 'near-footprint', 'no-nearby-footprint'
].map(status => [status, report.filter(item => item.status === status).length]));
console.log('EUROPA — existing 1 km² Nova Zagora import');
console.log(map.buildings.length + ' imported building footprints; ' + report.length + ' named public POIs.');
console.log('OSM map timestamp:', map.collectedAt, ' / navigation:', navigation.collectedAt);
console.log('Coverage:', counts);
const entries = searchName
  ? report.filter(item => item.landmark.name.toLocaleLowerCase('bg').includes(searchName.toLocaleLowerCase('bg')))
  : report;
if (!entries.length) console.log('No matching named POI in the current navigation data.');
for (const entry of entries) {
  const p = entry.landmark.point;
  console.log(
    entry.landmark.name + ' [' + entry.landmark.kind + ']',
    'position: X=' + p.x.toFixed(1) + ', Z=' + p.z.toFixed(1),
    'status: ' + entry.status,
    'nearest: ' + (entry.nearestBuildingSource ?? 'none'),
    'distance: ' + (entry.distanceMeters === null ? 'unknown' : entry.distanceMeters + 'm')
  );
}
console.log('A POI without a nearby footprint does NOT prove the physical building is absent.');
console.log('It means our current OSM-derived 3D dataset has no nearby imported building outline.');
console.log('© OpenStreetMap contributors — https://www.openstreetmap.org/copyright');
