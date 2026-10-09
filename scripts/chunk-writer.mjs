import { mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { splitWorldMap } from '../src/world/chunkGrid.ts';
import { isWorldMap } from '../src/world/osm.ts';

/** Generate a complete set offline, and swap it into place after all writes pass. */
export async function generateChunkFiles({
  mapPath = resolve('public/worlds/nova-zagora/map.json'),
  outputDir = resolve('public/worlds/nova-zagora/chunks'),
  logger = console,
} = {}) {
  const map = JSON.parse(await readFile(mapPath, 'utf8'));
  if (!isWorldMap(map)) throw new Error('Invalid/missing EUROPA-002B map.json; run pnpm map:fetch --osm-api first');
  const { manifest, chunks } = splitWorldMap(map);
  const stage = outputDir + '.stage-' + process.pid;
  const backup = outputDir + '.backup-' + process.pid;
  await rm(stage, { recursive: true, force: true });
  await rm(backup, { recursive: true, force: true });
  await mkdir(dirname(outputDir), { recursive: true });
  let previousMoved = false;
  try {
    await mkdir(stage, { recursive: true });
    for (const chunk of chunks) {
      await writeFile(join(stage, chunk.id + '.json'), JSON.stringify(chunk), 'utf8');
    }
    // Publish the manifest last within the staging directory.
    await writeFile(join(stage, 'manifest.json'), JSON.stringify(manifest), 'utf8');
    try {
      await rename(outputDir, backup);
      previousMoved = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await rename(stage, outputDir);
    } catch (error) {
      if (previousMoved) await rename(backup, outputDir);
      throw error;
    }
    if (previousMoved) await rm(backup, { recursive: true, force: true });
    logger.info('Generated ' + chunks.length + ' chunks (' + manifest.tileSizeMeters + 'm x ' + manifest.tileSizeMeters + 'm each).');
    logger.info('Saved ODbL-licensed chunks under ' + outputDir);
    logger.info('Source: © OpenStreetMap contributors — https://www.openstreetmap.org/copyright');
    return manifest;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
