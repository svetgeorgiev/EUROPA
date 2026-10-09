import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNavigationData, isNavigationData, nearestNamedStreet } from '../src/world/navigation.ts';

const anchor = { latitude: 42.493, longitude: 26.011, elevationMeters: 0 };
const raw = {
  osm3s: { timestamp_osm_base: '2026-10-10T08:00:00Z' },
  elements: [
    { type: 'node', id: 1, lat: 42.493, lon: 26.0109 },
    { type: 'node', id: 2, lat: 42.493, lon: 26.0111 },
    { type: 'node', id: 3, lat: 42.4931, lon: 26.0111 },
    { type: 'node', id: 4, lat: 42.4931, lon: 26.0109 },
    { type: 'node', id: 5, lat: 42.49305, lon: 26.01103,
      tags: { name: 'Town Library', 'name:bg': 'Градска библиотека', amenity: 'library' } },
    { type: 'node', id: 6, lat: 42.49304, lon: 26.01095, tags: { amenity: 'pharmacy' } },
    { type: 'node', id: 7, lat: 42.4931, lon: 26.0110, tags: { name: 'Private citizen', office: 'private' } },
    { type: 'node', id: 8, lat: 42.53, lon: 26.02, tags: { name: 'Far away park', leisure: 'park' } },
    { type: 'way', id: 100, nodes: [1, 2], tags: {
      highway: 'residential', name: 'Street One', 'name:bg': 'Улица Първа'
    } },
    { type: 'way', id: 101, nodes: [1, 2, 3, 4, 1], tags: {
      building: 'yes', amenity: 'hospital', name: 'Болница'
    } },
    { type: 'way', id: 102, nodes: [1, 999], tags: { highway: 'tertiary', name: 'Incomplete Road' } },
    { type: 'way', id: 103, nodes: [1, 2], tags: { highway: 'residential' } },
  ]
};

test('real names and public landmarks are extracted from actual OSM tags only', () => {
  const navigation = buildNavigationData(raw, anchor);
  assert.equal(navigation.streets.length, 1);
  assert.equal(navigation.streets[0].name, 'Улица Първа');
  assert.equal(navigation.streets[0].id, 'way/100');
  assert.equal(navigation.landmarks.length, 2);
  assert.deepEqual(navigation.landmarks.map(item => item.name).sort(),
    ['Болница', 'Градска библиотека'].sort());
  assert.ok(navigation.landmarks.some(item => item.kind === 'amenity:library'));
  assert.ok(navigation.landmarks.some(item => item.kind === 'amenity:hospital'));
  assert.equal(navigation.collectedAt, '2026-10-10T08:00:00Z');
  assert.equal(navigation.licenseUrl, 'https://www.openstreetmap.org/copyright');
  assert.equal(navigation.halfSizeMeters, 500);
  assert.ok(isNavigationData(navigation, anchor));
});

test('geometry positions are near the anchor but not invented and private names are omitted', () => {
  const navigation = buildNavigationData(raw, anchor);
  assert.ok(navigation.streets[0].point.x < 5 && navigation.streets[0].point.x > -5);
  assert.ok(navigation.streets[0].point.z < 5 && navigation.streets[0].point.z > -5);
  assert.ok(navigation.landmarks.every(item =>
    Math.abs(item.point.x) <= 510 && Math.abs(item.point.z) <= 510));
  assert.ok(!navigation.streets.some(item => item.name === 'Incomplete Road'));
  assert.ok(!navigation.landmarks.some(item =>
    ['Private citizen', 'Far away park'].includes(item.name)));
});

test('navigation accepts Overpass out geom road ways as well as core OSM node references', () => {
  const source = { elements: [{
    type: 'way', id: 300, tags: { highway: 'residential', name: 'ул. Тест' },
    geometry: [{ lat: 42.4931, lon: 26.011 }, { lat: 42.4932, lon: 26.011 }]
  }] };
  const navigation = buildNavigationData(source, anchor);
  assert.equal(navigation.streets[0].name, 'ул. Тест');
  assert.equal(navigation.landmarks.length, 0);
});

test('missing geographic tags never become fabricated labels', () => {
  const empty = buildNavigationData({ elements: [
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
    { type: 'node', id: 12, lat: 42.493, lon: 26.011, tags: { amenity: 'school' } }
  ] }, anchor);
  assert.equal(empty.streets.length, 0);
  assert.equal(empty.landmarks.length, 0);
});

test('validation rejects malformed sources, bad anchors and mismatched coordinates', () => {
  assert.throws(() => buildNavigationData({}, anchor), /elements array/);
  assert.throws(() => buildNavigationData(raw, { ...anchor, latitude: 91 }), RangeError);
  const valid = buildNavigationData(raw, anchor);
  assert.equal(isNavigationData(valid, { ...anchor, longitude: 26.012 }), false);
  assert.equal(isNavigationData({ ...valid, streets: [{ name: 'X', point: { x: NaN, z: 0 } }] }), false);
  assert.equal(isNavigationData({ ...valid, landmarks: null }), false);
});

test('nearest mapped street hint uses bounded distance and returns null otherwise', () => {
  const nav = buildNavigationData(raw, anchor);
  assert.equal(nearestNamedStreet(nav.streets, { x: 0, z: 0 })?.name, 'Улица Първа');
  assert.equal(nearestNamedStreet(nav.streets, { x: 400, z: 400 }), null);
});
