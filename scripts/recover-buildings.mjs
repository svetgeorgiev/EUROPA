import { previewBuildingRecovery } from './recovery-pipeline.mjs';

const args = process.argv.slice(2);
const arg = key => {
  const index = args.indexOf(key);
  if (index < 0) return undefined;
  const next = args[index + 1];
  if (!next || next.startsWith('--')) throw new Error(key + ' requires a value');
  return next;
};
if (args.includes('--help') || args.includes('-h')) {
  console.log('EUROPA-002D.3 — offline OSM building recovery');
  console.log('Usage: pnpm map:recover --input path/to/nova-zagora.geojson');
  console.log('       pnpm map:recover --input path/to/nova-zagora.geojson --apply');
  console.log('       Optional: --source-date 2026-10-10T00:00:00Z');
  console.log('Inputs: osmium export GeoJSON with -a type,id, or raw OSM JSON.');
  console.log('A preview is produced by default. No live OSM downloads.');
  process.exit(0);
}
for (const token of args) {
  if (!['--input', '--apply', '--source-date'].includes(token) &&
      !(args[args.indexOf(token) - 1] === '--input' ||
        args[args.indexOf(token) - 1] === '--source-date')) {
    throw new Error('Unknown recovery argument: ' + token);
  }
}
const inputPath = arg('--input');
if (!inputPath) throw new Error('Provide --input path/to/osmium.geojson. See docs/GEO-002D3-RECOVERY.md');
await previewBuildingRecovery({
  inputPath, sourceDate: arg('--source-date'),
  apply: args.includes('--apply')
});
