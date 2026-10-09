import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_OVERPASS_ENDPOINTS, OVERPASS_HEADERS, listOverpassEndpoints, requestOverpass
} from '../scripts/overpass-client.mjs';

const silent = { info() {}, warn() {} };

test('uses currently listed public endpoints and deduplicates an optional override', () => {
  assert.equal(DEFAULT_OVERPASS_ENDPOINTS[0], 'https://overpass.private.coffee/api/interpreter');
  assert.deepEqual(listOverpassEndpoints(DEFAULT_OVERPASS_ENDPOINTS[0]), DEFAULT_OVERPASS_ENDPOINTS);
  assert.equal(listOverpassEndpoints('https://custom.example/api/interpreter')[0], 'https://custom.example/api/interpreter');
  assert.throws(() => listOverpassEndpoints('file:///etc/passwd'), /HTTP/);
});

test('sends an identifiable User-Agent and a POST-encoded Overpass query', async () => {
  const data = { elements: [{ type: 'way', id: 1 }] };
  const calls = [];
  const fetchImpl = async (endpoint, options) => {
    calls.push({ endpoint, options });
    return Response.json(data);
  };
  const result = await requestOverpass('[out:json];out;', { endpoints: ['https://api.example/interpreter'], fetchImpl, logger: silent });
  assert.deepEqual(result, data);
  assert.match(calls[0].options.headers['user-agent'], /EUROPA/);
  assert.equal(calls[0].options.headers.referer, 'https://github.com/svetgeorgiev/EUROPA');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(new URLSearchParams(calls[0].options.body).get('data'), '[out:json];out;');
});

test('pauses and falls back after HTTP 406 (rejected anonymous client)', async () => {
  const calls = [];
  const delays = [];
  const response = await requestOverpass('query', {
    endpoints: ['https://main.example/', 'https://backup.example/'],
    fetchImpl: async url => {
      calls.push(url);
      return calls.length === 1 ? new Response('Blocked unidentified client', { status: 406 }) : Response.json({ elements: [1] });
    },
    pause: async ms => { delays.push(ms); },
    logger: silent,
  });
  assert.equal(response.elements.length, 1);
  assert.deepEqual(delays, [30000]);
  assert.equal(calls.length, 2);
});

test('pauses and falls back after HTTP 429 (rate limiting)', async () => {
  const delays = [];
  let attempt = 0;
  const response = await requestOverpass('query', {
    endpoints: ['https://main.example/', 'https://backup.example/'],
    fetchImpl: async () => ++attempt === 1 ? new Response('Too many requests', { status: 429 }) : Response.json({ elements: [1] }),
    pause: async ms => { delays.push(ms); },
    logger: silent,
  });
  assert.equal(response.elements.length, 1);
  assert.deepEqual(delays, [30000]);
});

test('reports failed download without falsely claiming successful import', async () => {
  await assert.rejects(requestOverpass('query', {
    endpoints: ['https://main.example/'],
    fetchImpl: async () => new Response('Server busy', { status: 503 }),
    logger: silent,
  }), /download failed on all endpoints/);
});
