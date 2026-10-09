import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadGeometry, buildBuildingGeometry } from '../src/world/meshGeometry.ts';

function point(x, z) { return { x, z }; }
function crossY(positions, a, b, c) {
  const ax = positions[a * 3], az = positions[a * 3 + 2];
  const bx = positions[b * 3], bz = positions[b * 3 + 2];
  const cx = positions[c * 3], cz = positions[c * 3 + 2];
  return (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
}

test('road ribbons face upward and have upward normals in four directions', () => {
  const roads = [
    { a: point(0, 0), b: point(0, 50) },
    { a: point(0, 50), b: point(0, 0) },
    { a: point(0, 0), b: point(50, 0) },
    { a: point(50, 0), b: point(0, 0) },
    { a: point(-20, -20), b: point(20, 10) },
  ].map((road, id) => ({ ...road, id, highway: 'residential', widthMeters: 6 }));
  const mesh = buildRoadGeometry(roads);
  assert.equal(mesh.positions.length / 3, roads.length * 4);
  assert.equal(mesh.indices.length, roads.length * 6);
  for (let i = 0; i < mesh.normals.length; i += 3) {
    assert.deepEqual(mesh.normals.slice(i, i + 3), [0, 1, 0]);
  }
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const upward = crossY(mesh.positions, ...mesh.indices.slice(i, i + 3));
    assert.ok(upward > 0, 'each triangle has upward-facing vertex order');
  }
  assert.ok(mesh.positions.every(Number.isFinite));
});

test('degenerate roads are safely ignored', () => {
  const roads = [
    { id: 1, a: point(1, 1), b: point(1, 1), highway: 'service', widthMeters: 4 },
    { id: 2, a: point(0, 0), b: point(10, 0), highway: 'service', widthMeters: -1 }
  ];
  const mesh = buildRoadGeometry(roads);
  assert.equal(mesh.positions.length, 0);
  assert.equal(mesh.indices.length, 0);
});

function square(reverse = false) {
  const outline = [point(0, 0), point(10, 0), point(10, 10), point(0, 10)];
  return { id: 42, heightMeters: 6, outline: reverse ? outline.reverse() : outline };
}

test('buildings have separate flat wall and roof geometry in either winding', () => {
  for (const reverse of [false, true]) {
    const mesh = buildBuildingGeometry(square(reverse));
    assert.ok(mesh);
    assert.equal(mesh.positions.length / 3, mesh.normals.length / 3);
    assert.equal(mesh.positions.length / 3, mesh.colors.length / 4);
    assert.equal(mesh.indices.length % 3, 0);
    const n = 4;
    for (let face = 0; face < n; face++) {
      const start = face * 4 * 3;
      const normal = mesh.normals.slice(start, start + 3);
      assert.equal(normal[1], 0);
      assert.ok(Math.abs(Math.hypot(normal[0], normal[2]) - 1) < 1e-8);
      // Distinct faces are flat-shaded, not smoothed over their corners.
      for (let v = 1; v < 4; v++) {
        assert.deepEqual(mesh.normals.slice(start + 3*v, start + 3*v + 3), normal);
      }
    }
    const roofOffset = n * 4;
    for (let i = roofOffset; i < mesh.positions.length / 3; i++) {
      assert.equal(mesh.normals[i * 3 + 1], 1, 'roof has upward normal');
      assert.equal(mesh.colors[i * 4], 0.48, 'roof has muted distinct tint');
      assert.ok(mesh.positions[i * 3 + 1] > 6);
    }
    // Four walls, six indices each. Roof triangles begin at index 24.
    for (let i = n * 6; i < mesh.indices.length; i += 3) {
      assert.ok(crossY(mesh.positions, ...mesh.indices.slice(i, i + 3)) > 0);
    }
  }
});

test('invalid and zero-area polygons create no visual mesh', () => {
  const building = square();
  assert.equal(buildBuildingGeometry({ ...building, outline: [point(0, 0), point(1, 0), point(2, 0)] }), null);
  assert.equal(buildBuildingGeometry({ ...building, outline: [point(0, 0)] }), null);
  assert.equal(buildBuildingGeometry({ ...building, outline: [point(NaN, 1), point(1, 0), point(0, 1)] }), null);
});
