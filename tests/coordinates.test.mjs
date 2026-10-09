import test from 'node:test';
import assert from 'node:assert/strict';
import { geoToWorld, worldToGeo } from '../src/geo/coordinates.ts';

const anchor = { latitude: 42.493, longitude: 26.011, elevationMeters: 200 };

function near(value, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(value - expected) <= tolerance, String(value) + ' not within ' + tolerance + ' of ' + expected);
}

test('anchor maps to local origin', () => {
  assert.deepEqual(geoToWorld(anchor, anchor), { x: 0, y: 0, z: 0 });
});

test('east positive X, north positive Z, elevation positive Y', () => {
  const position = geoToWorld({ latitude: 42.494, longitude: 26.012, elevationMeters: 215 }, anchor);
  assert.ok(position.x > 70 && position.x < 100);
  assert.ok(position.z > 100 && position.z < 125);
  assert.equal(position.y, 15);
});

test('round-trip local coordinates and elevation', () => {
  const original = { latitude: 42.49791, longitude: 26.00691, elevationMeters: 243.27 };
  const restored = worldToGeo(geoToWorld(original, anchor), anchor);
  near(restored.latitude, original.latitude, 1e-10);
  near(restored.longitude, original.longitude, 1e-10);
  near(restored.elevationMeters, original.elevationMeters);
});

test('reject invalid coordinates and nonfinite world positions', () => {
  assert.throws(() => geoToWorld({ latitude: 95, longitude: 26, elevationMeters: 0 }, anchor), RangeError);
  assert.throws(() => worldToGeo({ x: Infinity, y: 0, z: 0 }, anchor), RangeError);
  assert.throws(() => worldToGeo({ x: 0, y: 0, z: 0 }, { ...anchor, latitude: 90 }), RangeError);
});
