import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateChunkFiles } from '../scripts/chunk-writer.mjs';

const fixture = {
  schemaVersion: 1,
  location: 'Nova Zagora, Bulgaria', source: 'OpenStreetMap',
  attribution: '© OpenStreetMap contributors',
  licenseUrl: 'https://www.openstreetmap.org/copyright',
  collectedAt: 'fixture-data',
  anchor: { latitude: 42.493, longitude: 26.011, elevationMeters: 0 },
  halfSizeMeters: 500,
  roads: [{
    id: 100, highway: 'residential', widthMeters: 6,
    a: { x: -400, z: -400 }, b: { x: 400, z: 400 }
  }],
  buildings: [{
    id: 200, heightMeters: 6,
    outline: [
      { x: -250, z: -250 }, { x: -230, z: -250 },
      { x: -230, z: -230 }, { x: -250, z: -230 }
    ]
  }]
};
const quiet = { info() {} };

test('writer exports 16 tile files and a manifest without editing the source map', async () => {
  const root = await mkdtemp(join(tmpdir(), 'europa-tiles-'));
  const mapPath = join(root, 'map.json');
  const outputDir = join(root, 'chunks');
  try {
    const original = JSON.stringify(fixture);
    await writeFile(mapPath, original);
    const manifest = await generateChunkFiles({ mapPath, outputDir, logger: quiet });
    assert.equal(manifest.chunks.length, 16);
    assert.equal(manifest.collectedAt, 'fixture-data');
    assert.equal(await readFile(mapPath, 'utf8'), original);
    const diskManifest = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8'));
    assert.deepEqual(diskManifest, manifest);
    const chunk = JSON.parse(await readFile(join(outputDir, '1_1.json'), 'utf8'));
    assert.equal(chunk.id, '1_1');
    assert.ok(Array.isArray(chunk.roads));
    assert.ok(Array.isArray(chunk.buildings));
    await writeFile(join(outputDir, 'stale.json'), 'stale');
    await generateChunkFiles({ mapPath, outputDir, logger: quiet });
    await assert.rejects(readFile(join(outputDir, 'stale.json')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bad source input does not destroy a previously generated chunk directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'europa-bad-tiles-'));
  const mapPath = join(root, 'map.json');
  const outputDir = join(root, 'chunks');
  try {
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, 'manifest.json'), 'previous valid map');
    await writeFile(mapPath, JSON.stringify({ invalid: true }));
    await assert.rejects(generateChunkFiles({ mapPath, outputDir, logger: quiet }), /Invalid/);
    assert.equal(await readFile(join(outputDir, 'manifest.json'), 'utf8'), 'previous valid map');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
