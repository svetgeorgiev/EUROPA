import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkAt, chunkId, nearbyChunkIds, splitWorldMap,
  isChunkManifest, isChunkFile
} from '../src/world/chunkGrid.ts';

const map = {
  schemaVersion: 1,
  location: 'Nova Zagora, Bulgaria',
  source: 'OpenStreetMap',
  attribution: '© OpenStreetMap contributors',
  licenseUrl: 'https://www.openstreetmap.org/copyright',
  collectedAt: '2026-10-09T22:00:00Z',
  anchor: { latitude: 42.493, longitude: 26.011, elevationMeters: 0 },
  halfSizeMeters: 500,
  roads: [
    { id: 101, highway: 'residential', widthMeters: 6, a: { x: -499, z: -125 }, b: { x: 499, z: -125 } },
    { id: 102, highway: 'footway', widthMeters: 2, a: { x: -120, z: -120 }, b: { x: -95, z: -100 } }
  ],
  buildings: [
    { id: 201, heightMeters: 8, outline: [{ x: -260, z: -260 }, { x: -235, z: -260 }, { x: -235, z: -240 }, { x: -260, z: -240 }] },
    { id: 202, heightMeters: 6, outline: [{ x: 20, z: 20 }, { x: 45, z: 20 }, { x: 45, z: 40 }, { x: 20, z: 40 }] }
  ]
};

test('splits an OSM world into sixteen deterministic 250m tiles', () => {
  const { manifest, chunks } = splitWorldMap(map);
  assert.equal(chunks.length, 16);
  assert.equal(manifest.chunks.length, 16);
  assert.equal(manifest.tileSizeMeters, 250);
  assert.deepEqual(chunks.map(c => c.id).slice(0, 4), ['0_0', '1_0', '2_0', '3_0']);
  assert.ok(isChunkManifest(manifest));
  assert.ok(chunks.every(c => isChunkFile(c, c.id)));
  assert.equal(manifest.collectedAt, map.collectedAt);
  assert.equal(manifest.attribution, map.attribution);
  assert.equal(chunks.flatMap(c => c.buildings).length, map.buildings.length);
  assert.equal(new Set(chunks.flatMap(c => c.buildings.map(b => b.id))).size, 2);
});

test('roads touching tile seams occur on both sides with safe overlap', () => {
  const { chunks } = splitWorldMap(map);
  const roadSegments = chunks.flatMap(c => c.roads.filter(r => r.id === 101).map(r => ({ id: c.id, r })));
  const ids = new Set(roadSegments.map(v => v.id));
  assert.ok(ids.has('0_1') && ids.has('1_1') && ids.has('2_1') && ids.has('3_1'));
  assert.ok(roadSegments.some(v => v.id === '0_1' && v.r.b.x > -250));
  assert.ok(roadSegments.some(v => v.id === '1_1' && v.r.a.x < -250));
  assert.ok(roadSegments.every(v => v.r.b.x > v.r.a.x));
});

test('chunk selection is deterministic at exact tile boundaries', () => {
  const { manifest } = splitWorldMap(map);
  assert.deepEqual(chunkAt({ x: -500, z: -500 }, manifest), { col: 0, row: 0 });
  assert.deepEqual(chunkAt({ x: -250, z: -250 }, manifest), { col: 1, row: 1 });
  assert.deepEqual(chunkAt({ x: 499.9, z: 499.9 }, manifest), { col: 3, row: 3 });
  assert.equal(chunkAt({ x: 500, z: 0 }, manifest), null);
  assert.equal(chunkAt({ x: NaN, z: 0 }, manifest), null);
  assert.equal(chunkId(2, 3), '2_3');
  assert.throws(() => chunkId(-1, 0));
});

test('three-by-three desired set clips correctly at world edges', () => {
  const { manifest } = splitWorldMap(map);
  assert.deepEqual(new Set(nearbyChunkIds({ col: 0, row: 0 }, manifest)), new Set(['0_0', '0_1', '1_0', '1_1']));
  assert.equal(nearbyChunkIds({ col: 2, row: 2 }, manifest).length, 9);
  assert.equal(nearbyChunkIds({ col: 1, row: 1 }, manifest)[0], '1_1');
});

test('invalid or incomplete manifests are rejected', () => {
  const { manifest } = splitWorldMap(map);
  assert.equal(isChunkManifest({ ...manifest, chunks: manifest.chunks.slice(1) }), false);
  assert.equal(isChunkManifest({ ...manifest, cols: 123 }), false);
  assert.equal(isChunkManifest({ ...manifest, chunks: [manifest.chunks[0], ...manifest.chunks.slice(0, 15)] }), false);
  assert.equal(isChunkFile({ id: '1_1', schemaVersion: 1, roads: [], buildings: [] }, '0_0'), false);
});

test('split is deterministic and never invents roads or buildings', () => {
  const first = splitWorldMap(map);
  const second = splitWorldMap(map);
  assert.deepEqual(first, second);
  assert.ok(first.chunks.flatMap(c => c.roads).every(r => [101, 102].includes(r.id)));
  assert.ok(first.chunks.flatMap(c => c.buildings).every(b => [201, 202].includes(b.id)));
});

export { map };
