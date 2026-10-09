import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CORE_API_HEADERS, makeCoreMapUrl, normalizeCoreMapJSON, requestCoreMap
} from '../scripts/osm-core-api.mjs';
import { buildWorldMap } from '../src/world/osm.ts';

const anchor = { latitude: 42.493, longitude: 26.011, elevationMeters: 0 };
const fixture = {
  version: 0.6,
  generator: 'OpenStreetMap server',
  elements: [
    { type: 'node', id: 11, lat: 42.493, lon: 26.011 },
    { type: 'node', id: 12, lat: 42.493, lon: 26.0113 },
    { type: 'node', id: 13, lat: 42.4932, lon: 26.0113 },
    { type: 'node', id: 14, lat: 42.4932, lon: 26.011 },
    { type: 'way', id: 200, nodes: [11, 12], tags: { highway: 'residential' } },
    { type: 'way', id: 201, nodes: [11, 12, 13, 14, 11], tags: { building: 'yes', 'building:levels': '2' } },
    { type: 'way', id: 202, nodes: [11, 99], tags: { highway: 'path' } },
    { type: 'way', id: 203, nodes: [11, 12], tags: { landuse: 'residential' } }
  ]
};

test('OSM bbox is lon/lat ordered and small enough for one town', () => {
  const url = new URL(makeCoreMapUrl(anchor));
  assert.equal(url.pathname, '/api/0.6/map.json');
  const [left, bottom, right, top] = url.searchParams.get('bbox').split(',').map(Number);
  assert.ok(left < 26.011 && 26.011 < right);
  assert.ok(bottom < 42.493 && 42.493 < top);
  assert.ok((right - left) * (top - bottom) < 0.002);
  assert.throws(() => makeCoreMapUrl(anchor, 800), RangeError);
});

test('OSM map.json node references are converted into Overpass-compatible geometry', () => {
  const normalized = normalizeCoreMapJSON(fixture);
  assert.equal(normalized.elements.length, 2);
  assert.equal(normalized.missingNodeWays, 1);
  assert.deepEqual(normalized.elements[0].geometry, [
    { lat: 42.493, lon: 26.011 },
    { lat: 42.493, lon: 26.0113 }
  ]);
  assert.deepEqual(normalized.elements[1].geometry[0], normalized.elements[1].geometry.at(-1));
  const world = buildWorldMap(normalized, anchor);
  assert.equal(world.roads.length, 1);
  assert.equal(world.buildings.length, 1);
  assert.equal(world.buildings[0].heightMeters, 6);
});

test('missing nodes are never connected as an artificial road', () => {
  const normalized = normalizeCoreMapJSON(fixture);
  assert.ok(!normalized.elements.some(e => e.id === 202));
});

test('rejects invalid OSM JSON instead of writing a fake map', () => {
  assert.throws(() => normalizeCoreMapJSON({}), /elements array/);
  assert.throws(() => normalizeCoreMapJSON({ elements: null }), /elements array/);
});

test('one explicit core request is GET with application/json and project identity', async () => {
  const calls = [];
  const logger = { info() {}, warn() {} };
  const source = await requestCoreMap(anchor, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json(fixture);
    },
    logger
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.accept, 'application/json');
  assert.match(CORE_API_HEADERS['user-agent'], /EUROPA/);
  assert.equal(source.elements.length, 2);
});

test('server rejection surfaces a useful error without automatic re-request', async () => {
  let calls = 0;
  await assert.rejects(
    requestCoreMap(anchor, {
      fetchImpl: async () => {
        calls++;
        return new Response('Busy server', { status: 503 });
      },
      logger: { info() {}, warn() {} }
    }),
    /HTTP 503/
  );
  assert.equal(calls, 1);
});
