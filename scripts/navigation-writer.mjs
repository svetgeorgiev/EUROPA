import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { buildNavigationData } from '../src/world/navigation.ts';
import { NOVA_ZAGORA_ANCHOR } from '../src/geo/worldConfig.ts';

export const NAV_FILE = resolve('public/worlds/nova-zagora/navigation.json');

/**
 * A separate file keeps the user's existing map.json and 16 chunks untouched.
 * Validate and stage first; failed imports never delete earlier good metadata.
 */
export async function exportNavigation(source, {
  output = NAV_FILE,
  collectedAt = source?.osm3s?.timestamp_osm_base ?? new Date().toISOString(),
  logger = console
} = {}) {
  const navigation = buildNavigationData(source, NOVA_ZAGORA_ANCHOR, collectedAt);
  if (!navigation.streets.length && !navigation.landmarks.length) {
    throw new Error('OSM source contains no named streets or supported public landmarks in the map area; existing navigation data not replaced.');
  }
  await mkdir(dirname(output), { recursive: true });
  const staging = output + '.tmp-' + process.pid;
  try {
    await writeFile(staging, JSON.stringify(navigation), 'utf8');
    // Windows rename won't overwrite an existing file reliably. Once the
    // staged bytes are valid, replace the output without touching map/chunks.
    const content = await readFile(staging, 'utf8');
    await writeFile(output, content, 'utf8');
  } finally {
    await rm(staging, { force: true });
  }
  logger.info('Imported ' + navigation.streets.length + ' named street ways and ' +
    navigation.landmarks.length + ' named public landmarks.');
  logger.info('Saved separate ODbL navigation file to ' + output);
  logger.info('© OpenStreetMap contributors: https://www.openstreetmap.org/copyright');
  return navigation;
}
