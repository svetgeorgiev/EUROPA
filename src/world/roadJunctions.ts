import earcut from 'earcut';
import polygonClipping from 'polygon-clipping';
import type { Point2, RoadSegment } from './osm.ts';
import { buildRoadGeometry } from './meshGeometry.ts';

/** Exact tile clipping in local world metres; north is +Z, east is +X. */
export interface MapBounds { minX: number; maxX: number; minZ: number; maxZ: number; }
export interface MergedRoadGeometry {
  positions: number[];
  normals: number[];
  indices: number[];
  uvs: number[];
}
type Pair = [number, number];
type Ring = Pair[];

const VALID_EPS = 1e-8;

function quadForRoad(road: RoadSegment): Ring | null {
  const dx = road.b.x - road.a.x, dz = road.b.z - road.a.z;
  const length = Math.hypot(dx, dz);
  if (!(length > 0.2) || !Number.isFinite(length) ||
    !Number.isFinite(road.widthMeters) || !(road.widthMeters > 0)) return null;
  const nx = -dz / length * road.widthMeters / 2;
  const nz = dx / length * road.widthMeters / 2;
  const a: Pair = [road.a.x + nx, road.a.z + nz];
  const b: Pair = [road.a.x - nx, road.a.z - nz];
  const c: Pair = [road.b.x - nx, road.b.z - nz];
  const d: Pair = [road.b.x + nx, road.b.z + nz];
  if (![...a, ...b, ...c, ...d].every(Number.isFinite)) return null;
  return [a, b, c, d, a];
}

function rectangle(bounds: MapBounds): Ring {
  return [
    [bounds.minX, bounds.minZ],
    [bounds.maxX, bounds.minZ],
    [bounds.maxX, bounds.maxZ],
    [bounds.minX, bounds.maxZ],
    [bounds.minX, bounds.minZ]
  ];
}

/**
 * Union all overlapping road rectangles before triangulation.
 *
 * Previous independent coplanar quads produced z-fighting, strange patches
 * and double surfaces at crossing streets. A single planar union per tile
 * has no overlapping asphalt triangles. Exact tile clipping avoids overlap
 * of road surfaces across streamed chunk boundaries.
 */
export function mergeRoadSurface(
  roads: readonly RoadSegment[],
  bounds?: MapBounds,
  y = 0.045
): MergedRoadGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const polygons = roads
    .map(quadForRoad)
    .filter((ring): ring is Ring => ring !== null)
    .map(ring => [ring]);
  if (!polygons.length) return { positions, normals, indices, uvs };

  let union = polygonClipping.union(polygons[0], ...polygons.slice(1));
  if (bounds) {
    if (!(bounds.maxX > bounds.minX && bounds.maxZ > bounds.minZ)) {
      throw new RangeError('Invalid streamed road tile bounds');
    }
    union = polygonClipping.intersection(union, [rectangle(bounds)]);
  }

  for (const polygon of union) {
    const flat: number[] = [];
    const holeIndices: number[] = [];
    for (const [ringIndex, original] of polygon.entries()) {
      const ring = original.slice();
      if (ring.length > 1) {
        const first = ring[0], last = ring[ring.length - 1];
        if (Math.hypot(first[0] - last[0], first[1] - last[1]) < VALID_EPS) ring.pop();
      }
      if (ring.length < 3) continue;
      if (ringIndex > 0) holeIndices.push(flat.length / 2);
      for (const [x, z] of ring) flat.push(x, z);
    }
    if (flat.length < 6) continue;
    const triangles = earcut(flat, holeIndices);
    const base = positions.length / 3;
    for (let i = 0; i < flat.length; i += 2) {
      const x = flat[i], z = flat[i + 1];
      positions.push(x, y, z);
      normals.push(0, 1, 0);
      // World-anchored UVs avoid huge stretched/rotated grain at intersections.
      uvs.push(x / 8, z / 8);
    }
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i], b = triangles[i + 1], c = triangles[i + 2];
      const ax = flat[a * 2], az = flat[a * 2 + 1];
      const bx = flat[b * 2], bz = flat[b * 2 + 1];
      const cx = flat[c * 2], cz = flat[c * 2 + 1];
      const signed = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      if (Math.abs(signed) <= VALID_EPS) continue;
      if (signed > 0) indices.push(base + a, base + b, base + c);
      else indices.push(base + a, base + c, base + b);
    }
  }
  return { positions, normals, indices, uvs };
}

/** Return intersection along the two centreline segments, when they cross. */
export function roadCrossing(a: RoadSegment, b: RoadSegment): {
  distanceA: number; distanceB: number; angle: number
} | null {
  const ax = a.b.x - a.a.x, az = a.b.z - a.a.z;
  const bx = b.b.x - b.a.x, bz = b.b.z - b.a.z;
  const lenA = Math.hypot(ax, az), lenB = Math.hypot(bx, bz);
  if (lenA < 0.1 || lenB < 0.1) return null;
  const det = ax * bz - az * bx;
  if (Math.abs(det) < 1e-7 * lenA * lenB) return null;
  const dx = b.a.x - a.a.x, dz = b.a.z - a.a.z;
  const t = (dx * bz - dz * bx) / det;
  const u = (dx * az - dz * ax) / det;
  if (t < -0.0001 || t > 1.0001 || u < -0.0001 || u > 1.0001) return null;
  // Mild bends along a single OSM way should not lose street decoration.
  const acuteSin = Math.abs(det / (lenA * lenB));
  if (a.id === b.id && acuteSin < 0.35) return null;
  return {
    distanceA: Math.max(0, Math.min(lenA, t * lenA)),
    distanceB: Math.max(0, Math.min(lenB, u * lenB)),
    angle: Math.asin(Math.min(1, acuteSin))
  };
}

export function roadDecorIntervals(
  roads: readonly RoadSegment[],
  index: number,
  margin = 7
): [number, number][] {
  const current = roads[index];
  const length = Math.hypot(current.b.x - current.a.x, current.b.z - current.a.z);
  if (!Number.isFinite(length) || length < 0.5) return [];
  const blocked: [number, number][] = [];
  for (let i = 0; i < roads.length; i++) {
    if (i === index) continue;
    const crossing = roadCrossing(current, roads[i]);
    if (!crossing) continue;
    blocked.push([
      Math.max(0, crossing.distanceA - margin),
      Math.min(length, crossing.distanceA + margin)
    ]);
  }
  blocked.sort((a, b) => a[0] - b[0]);
  const intervals: [number, number][] = [];
  let cursor = 0;
  for (const [a, b] of blocked) {
    if (a - cursor >= 1) intervals.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (length - cursor >= 1) intervals.push([cursor, length]);
  return intervals;
}


/**
 * Geometry fallback for malformed/problematic OSM road topology.
 * If polygon union fails for one tile, render its source road ribbons rather
 * than dropping the entire chunk (and therefore the ground/buildings).
 *
 * The fallback can show overlaps at intersections. It is a warning path,
 * never represented as the preferred finished junction geometry.
 * The optional merge function is injectable for deterministic tests.
 */
export function mergeRoadSurfaceSafely(
  roads: readonly RoadSegment[],
  bounds?: MapBounds,
  onWarning: (message: string) => void = () => {},
  merge: typeof mergeRoadSurface = mergeRoadSurface
): MergedRoadGeometry {
  try {
    return merge(roads, bounds);
  } catch (error) {
    onWarning('Road polygon merge failed; using simple road ribbons. ' + String(error));
    const fallback = buildRoadGeometry(roads);
    return {
      positions: fallback.positions,
      indices: fallback.indices,
      normals: fallback.normals,
      uvs: fallback.uvs
    };
  }
}
