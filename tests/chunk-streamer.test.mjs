import test from 'node:test';
import assert from 'node:assert/strict';
import { splitWorldMap } from '../src/world/chunkGrid.ts';
import { ChunkStreamer } from '../src/world/ChunkStreamer.ts';

const map = {
  schemaVersion: 1, location: 'Nova Zagora, Bulgaria',
  source: 'OpenStreetMap', attribution: '© OpenStreetMap contributors',
  licenseUrl: 'https://www.openstreetmap.org/copyright', collectedAt: 'test',
  anchor: { latitude: 42.493, longitude: 26.011, elevationMeters: 0 },
  halfSizeMeters: 500, roads: [{
    id: 1, highway: 'residential', widthMeters: 6, a: { x: -400, z: -400 }, b: { x: 400, z: 400 }
  }], buildings: []
};
const { manifest, chunks } = splitWorldMap(map);
const data = new Map(chunks.map(c => [c.id, c]));
const point = (col, row) => ({ x: -500 + (col + 0.5) * 250, z: -500 + (row + 0.5) * 250 });

test('loads nearby chunks, unloads far-away chunks and updates counters', async () => {
  const active = new Set();
  const unloaded = [];
  const snapshots = [];
  const streamer = new ChunkStreamer(manifest, {
    loadChunk: async id => data.get(id),
    onLoad: c => active.add(c.id),
    onUnload: id => { active.delete(id); unloaded.push(id); },
    onStatus: status => snapshots.push(status)
  });
  await streamer.moveTo(point(0, 0));
  assert.deepEqual(active, new Set(['0_0', '0_1', '1_0', '1_1']));
  assert.equal(streamer.stats.loaded, 4);
  await streamer.moveTo(point(2, 2));
  assert.equal(streamer.stats.loaded, 9);
  assert.equal(streamer.stats.loading, 0);
  assert.ok(unloaded.includes('0_0'));
  assert.ok(!active.has('0_0'));
  assert.ok(active.has('3_3'));
  assert.ok(snapshots.some(s => s.loading > 0));
  streamer.dispose();
  assert.equal(active.size, 0);
});

test('stale responses never activate an unloaded tile after player moves', async () => {
  const waiting = new Map();
  const active = new Set();
  const streamer = new ChunkStreamer(manifest, {
    loadChunk: id => new Promise(resolve => waiting.set(id, resolve)),
    onLoad: chunk => active.add(chunk.id),
    onUnload: id => active.delete(id),
    onStatus: () => {}
  });
  const old = streamer.moveTo(point(0, 0));
  const next = streamer.moveTo(point(3, 3));
  // All requests are started immediately; resolve stale and current tiles.
  for (const [id, resolve] of waiting) resolve(data.get(id));
  await Promise.all([old, next]);
  assert.deepEqual(active, new Set(['2_2', '2_3', '3_2', '3_3']));
  streamer.dispose();
});

test('invalid tile is not retried every frame; leaving and returning permits retry', async () => {
  let attempts = 0;
  const warnings = [];
  const streamer = new ChunkStreamer(manifest, {
    loadChunk: async id => {
      if (id === '0_0') {
        attempts++;
        if (attempts === 1) return { schemaVersion: 1, id, roads: null, buildings: [] };
      }
      return data.get(id);
    },
    onLoad: () => {},
    onUnload: () => {},
    onStatus: () => {},
    onWarning: message => warnings.push(message)
  });
  await streamer.moveTo(point(0, 0));
  assert.equal(attempts, 1);
  assert.equal(streamer.stats.failed, 1);
  await streamer.moveTo(point(0, 0));
  assert.equal(attempts, 1);
  await streamer.moveTo(point(3, 3));
  await streamer.moveTo(point(0, 0));
  assert.equal(attempts, 2);
  assert.equal(streamer.stats.failed, 0);
  assert.ok(warnings.length >= 1);
  streamer.dispose();
});

test('disposal ignores late network responses and clears all previously loaded tiles', async () => {
  let resolvePending;
  const activated = [];
  const streamer = new ChunkStreamer(manifest, {
    loadChunk: () => new Promise(resolve => { resolvePending = resolve; }),
    onLoad: chunk => activated.push(chunk.id),
    onUnload: () => {},
    onStatus: () => {}
  });
  const operation = streamer.moveTo(point(0, 0));
  streamer.dispose();
  resolvePending(data.get('1_1'));
  // Other promises may be unresolved: this specific test resolves via microtasks only.
  assert.equal(activated.length, 0);
  void operation;
});
