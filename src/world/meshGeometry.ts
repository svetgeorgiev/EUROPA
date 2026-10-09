import earcut from 'earcut';
import type { BuildingFootprint, Point2, RoadSegment } from './osm.ts';

/**
 * Geometry-only helpers used by static 002B and streamed 002C renderers.
 * No Babylon scene, meshes, physics or networking: easy to test separately.
 * World convention: X east, Z north, Y up.
 */
export interface ColoredGeometry {
  positions: number[];
  indices: number[];
  normals: number[];
  colors: number[];
}

export type RoadGeometry = Omit<ColoredGeometry, 'colors'> & { uvs: number[] };

export function buildRoadGeometry(roads: readonly RoadSegment[], y = 0.045): RoadGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (const road of roads) {
    const dx = road.b.x - road.a.x;
    const dz = road.b.z - road.a.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.2 || !Number.isFinite(length) || !Number.isFinite(road.widthMeters) ||
        road.widthMeters <= 0) continue;

    const nx = -dz / length * road.widthMeters / 2;
    const nz = dx / length * road.widthMeters / 2;
    const offset = positions.length / 3;

    positions.push(
      road.a.x + nx, y, road.a.z + nz,
      road.a.x - nx, y, road.a.z - nz,
      road.b.x + nx, y, road.b.z + nz,
      road.b.x - nx, y, road.b.z - nz
    );

    // Unconditionally upward normals, independent of road direction.
    // The underlying flat ground supplies collisions; roads are visual-only.
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    // Repeat small asphalt grain consistently along each OSM road segment.
    uvs.push(0, 0, 1, 0, 0, length / 8, 1, length / 8);
    indices.push(offset, offset + 2, offset + 1,
      offset + 1, offset + 2, offset + 3);
  }
  return { positions, indices, normals, uvs };
}

function signedArea(points: readonly Point2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    area += points[i].x * next.z - next.x * points[i].z;
  }
  return area / 2;
}

/**
 * Separate vertices per wall face and roof triangle for clear, flat normals.
 * Darker muted roof vertex colors are visual-only: the collision system still
 * reads the original OSM footprint, with no entrances or interiors invented.
 */
export function buildBuildingGeometry(building: BuildingFootprint): ColoredGeometry | null {
  const points = building.outline;
  if (points.length < 3 || points.length > 300 || !Number.isFinite(building.heightMeters)) return null;
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))) return null;
  const area = signedArea(points);
  if (Math.abs(area) < 1e-7) return null;

  const coords = points.flatMap(p => [p.x, p.z]);
  const roofIndices = earcut(coords);
  if (roofIndices.length === 0) return null;

  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const outwardSign = area >= 0 ? 1 : -1;
  const wallHeight = building.heightMeters;

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-5) continue;
    const offset = positions.length / 3;
    const nx = outwardSign * dz / length;
    const nz = outwardSign * -dx / length;
    positions.push(
      a.x, 0, a.z,
      a.x, wallHeight, a.z,
      b.x, 0, b.z,
      b.x, wallHeight, b.z
    );
    for (let k = 0; k < 4; k++) {
      normals.push(nx, 0, nz);
      // Subtle deterministic facade variation, not claimed OSM facade data.
      const variation = 0.94 + 0.025 * (i % 3);
      colors.push(variation, variation, variation, 1);
    }
    if (outwardSign > 0) {
      indices.push(offset, offset + 1, offset + 2,
        offset + 2, offset + 1, offset + 3);
    } else {
      indices.push(offset, offset + 2, offset + 1,
        offset + 2, offset + 3, offset + 1);
    }
  }

  for (let i = 0; i < roofIndices.length; i += 3) {
    const a = points[roofIndices[i]];
    const b = points[roofIndices[i + 1]];
    const c = points[roofIndices[i + 2]];
    const crossY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    if (Math.abs(crossY) < 1e-8) continue;
    const roof = crossY >= 0 ? [a, b, c] : [a, c, b];
    const offset = positions.length / 3;
    for (const point of roof) {
      positions.push(point.x, wallHeight + 0.025, point.z);
      normals.push(0, 1, 0);
      colors.push(0.48, 0.55, 0.58, 1);
    }
    indices.push(offset, offset + 1, offset + 2);
  }

  return { positions, indices, normals, colors };
}
