import test from 'node:test';
import assert from 'node:assert/strict';
import { splitWorldMap } from '../src/world/chunkGrid.ts';
import { ChunkStreamer } from '../src/world/ChunkStreamer.ts';
import { mergeRoadSurfaceSafely } from '../src/world/roadJunctions.ts';

const fixture = {
  schemaVersion: 1,
  source: 'OpenStreetMap',
  location: 'Nova Zagora, Bulgaria',
  attribution: '© OpenStreetMap contributors',
  licenseUrl: 'https://www.openstreetmap.org/copyright',
  collectedAt: 'local-fixture',
  halfSizeMeters: 500,
  anchor: { latitude: 42.493, longitude: 26.011, elevationMeters: 0 },
  roads: [{ id: 1, highway: 'residential', widthMeters: 6,
    a: { x: -450, z: -450 }, b: { x: 450, z: 450 } }],
  buildings: []
};
const { manifest, chunks } = splitWorldMap(fixture);
const tiles = new Map(chunks.map(chunk => [chunk.id, chunk]));
const point = (col, row) => ({
  x: -500 + (col + 0.5) * 250,
  z: -500 + (row + 0.5) * 250
});

test('a transient HTTP error reports the specific tile and manual retry restores it', async () => {
  const attempts = new Map();
  const warnings = [];
  const active = new Set();
  const streamer = new ChunkStreamer(manifest, {
    loadChunk: async id => {
      attempts.set(id, (attempts.get(id) ?? 0) + 1);
      if (id === '0_1' && attempts.get(id) === 1) throw new Error('HTTP 503: temporarily busy');
      return tiles.get(id);
    },
    onLoad: tile => active.add(tile.id),
    onUnload: id => active.delete(id),
    onStatus: () => {},
    onWarning: warning => warnings.push(warning)
  });
  await streamer.moveTo(point(0, 0));
  assert.equal(streamer.stats.failed, 1);
  assert.deepEqual(streamer.stats.failedIds, ['0_1']);
  assert.match(streamer.stats.lastError, /HTTP 503/);
  assert.equal(streamer.stats.loaded, 3);
  assert.ok(!active.has('0_1'));
  assert.ok(warnings.some(warning => warning.includes('0_1')));

  // Merely rendering another frame (same tile) never hammers the endpoint.
  await streamer.moveTo(point(0, 0));
  assert.equal(attempts.get('0_1'), 1);

  await streamer.retryFailed();
  assert.equal(attempts.get('0_1'), 2);
  assert.equal(streamer.stats.loaded, 4);
  assert.equal(streamer.stats.failed, 0);
  assert.deepEqual(streamer.stats.failedIds, []);
  assert.equal(streamer.stats.lastError, '');
  assert.ok(active.has('0_1'));
  streamer.dispose();
  assert.equal(active.size, 0);
});

test('a geometry onLoad failure can be manually retried without orphan state', async () => {
  const attempts = new Map();
  const active = new Set();
  const streamer = new ChunkStreamer(manifest, {
    loadChunk: async id => tiles.get(id),
    onLoad: tile => {
      attempts.set(tile.id, (attempts.get(tile.id) ?? 0) + 1);
      if (tile.id === '1_0' && attempts.get(tile.id) === 1) throw new Error('polygon union exception');
      active.add(tile.id);
    },
    onUnload: id => active.delete(id),
    onStatus: () => {}
  });
  await streamer.moveTo(point(0, 0));
  assert.equal(streamer.stats.failed, 1);
  assert.equal(streamer.stats.loaded, 3);
  assert.equal(streamer.stats.lastError, 'polygon union exception');
  await streamer.retryFailed();
  assert.equal(streamer.stats.failed, 0);
  assert.equal(streamer.stats.loaded, 4);
  assert.equal(attempts.get('1_0'), 2);
  streamer.dispose();
});

test('manual retry does not run when no failures remain or after disposal', async () => {
  let requests = 0;
  const streamer = new ChunkStreamer(manifest, {
    loadChunk: async id => { requests++; return tiles.get(id); },
    onLoad: () => {},
    onUnload: () => {},
    onStatus: () => {}
  });
  await streamer.moveTo(point(0, 0));
  const before = requests;
  await streamer.retryFailed();
  assert.equal(requests, before);
  streamer.dispose();
  await streamer.retryFailed();
  assert.equal(requests, before);
});

test('malformed polygon union falls back to basic road geometry', () => {
  const roads = fixture.roads;
  const warnings = [];
  const result = mergeRoadSurfaceSafely(roads, undefined,
    warning => warnings.push(warning),
    () => { throw new Error('self-intersection in imported road polygon'); }
  );
  assert.equal(result.positions.length, 12);
  assert.equal(result.normals.length, 12);
  assert.equal(result.uvs.length, 8);
  assert.equal(result.indices.length, 6);
  assert.ok(warnings[0].includes('self-intersection'));
});

test('a successful polygon merge has no fallback warnings', () => {
  const warnings = [];
  const result = mergeRoadSurfaceSafely(fixture.roads, undefined,
    warning => warnings.push(warning)
  );
  assert.ok(result.indices.length >= 6);
  assert.equal(warnings.length, 0);
});
