import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportNavigation } from '../scripts/navigation-writer.mjs';

const fixture = {
  elements: [
    { type: 'node', id: 1, lat: 42.493, lon: 26.011 },
    { type: 'node', id: 2, lat: 42.49305, lon: 26.01103 },
    { type: 'way', id: 10, nodes: [1, 2],
      tags: { highway: 'residential', name: 'ул. Пример' } }
  ]
};
const quiet = { info() {} };

test('navigation import writes a standalone JSON file without altering an existing 3D map', async () => {
  const root = await mkdtemp(join(tmpdir(), 'europa-navigation-'));
  try {
    const mapPath = join(root, 'map.json');
    const navPath = join(root, 'navigation.json');
    await writeFile(mapPath, '{"important":"existing map"}');
    const result = await exportNavigation(fixture, { output: navPath, collectedAt: 'source-time', logger: quiet });
    assert.equal(result.streets.length, 1);
    assert.equal(result.collectedAt, 'source-time');
    assert.deepEqual(JSON.parse(await readFile(navPath, 'utf8')), result);
    assert.equal(await readFile(mapPath, 'utf8'), '{"important":"existing map"}');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bad or unnamed imports cannot overwrite previously valid navigation data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'europa-navigation-safe-'));
  try {
    const navPath = join(root, 'navigation.json');
    await writeFile(navPath, '{"original":"keep"}');
    await assert.rejects(exportNavigation({ elements: null }, {
      output: navPath, logger: quiet
    }), /elements array/);
    await assert.rejects(exportNavigation({ elements: [] }, {
      output: navPath, logger: quiet
    }), /no named streets/);
    assert.equal(await readFile(navPath, 'utf8'), '{"original":"keep"}');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
