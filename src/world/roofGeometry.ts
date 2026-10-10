import type { BuildingFootprint, Point2 } from './osm.ts';

/** Render-only roof triangles. They never alter sealed building collisions. */
export interface RoofGeometry {
  positions: number[];
  normals: number[];
  indices: number[];
  uvs: number[];
}
export type RoofStyle = 'flat' | 'gabled' | 'hipped';

function edgeLength(a: Point2, b: Point2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}
function signedArea(points: Point2[]): number {
  return points.reduce((sum, a, index) => {
    const b = points[(index + 1) % points.length];
    return sum + a.x * b.z - b.x * a.z;
  }, 0) / 2;
}
/** Small rectangular OSM footprints are plausible pitched-roof candidates. */
function rectangularOutline(outline: Point2[]): Point2[] | null {
  if (outline.length !== 4 || Math.abs(signedArea(outline)) < 12) return null;
  const edges = outline.map((a, i) => ({
    x: outline[(i + 1) % 4].x - a.x,
    z: outline[(i + 1) % 4].z - a.z
  }));
  const lengths = edges.map(v => Math.hypot(v.x, v.z));
  if (Math.min(...lengths) < 3 || Math.max(...lengths) > 65) return null;
  for (let i = 0; i < 4; i++) {
    const a = edges[i], b = edges[(i + 1) % 4];
    const cos = Math.abs((a.x * b.x + a.z * b.z) / (lengths[i] * lengths[(i + 1) % 4]));
    if (cos > 0.16) return null; // Not close to a true rectangle.
  }
  const q = [...outline];
  if (lengths[1] > lengths[0]) q.push(q.shift()!); // Long edge q0 → q1.
  return q;
}

export function chooseRoofStyle(building: BuildingFootprint): RoofStyle {
  const explicit = building.roofShape?.toLowerCase();
  if (explicit === 'flat') return 'flat';
  if (explicit === 'gabled' || explicit === 'gable') return 'gabled';
  if (explicit === 'hipped' || explicit === 'hip') return 'hipped';
  const kind = building.buildingType?.toLowerCase() ?? '';
  if (['apartments', 'commercial', 'industrial', 'retail', 'warehouse', 'office'].includes(kind)) {
    return 'flat';
  }
  const rectangle = rectangularOutline(building.outline);
  if (!rectangle) return 'flat';
  const area = Math.abs(signedArea(building.outline));
  return area >= 32 && area <= 440 && building.heightMeters <= 12 ? 'gabled' : 'flat';
}

export function buildRoofGeometry(building: BuildingFootprint): RoofGeometry | null {
  const style = chooseRoofStyle(building);
  const q = rectangularOutline(building.outline);
  if (style === 'flat' || !q || !Number.isFinite(building.heightMeters)) return null;
  const [a, b, c, d] = q;
  const wallY = building.heightMeters + 0.04;
  const width = edgeLength(a, d);
  const requestedRise = building.roofHeightMeters;
  const rise = typeof requestedRise === 'number' && requestedRise > 0
    ? Math.min(4, requestedRise) : Math.min(2.4, Math.max(0.7, width * 0.30));
  const ridgeY = wallY + rise;
  const ridge0: Point2 = { x: (a.x + d.x) / 2, z: (a.z + d.z) / 2 };
  const ridge1: Point2 = { x: (b.x + c.x) / 2, z: (b.z + c.z) / 2 };
  const geometry: RoofGeometry = { positions: [], normals: [], indices: [], uvs: [] };

  // Use separate vertices for each roof face, for crisp tile-roof lighting.
  const triangle = (p: Point2, py: number, q: Point2, qy: number,
    r: Point2, ry: number): void => {
    const ux = q.x - p.x, uy = qy - py, uz = q.z - p.z;
    const vx = r.x - p.x, vy = ry - py, vz = r.z - p.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-6) return;
    // Back-face culling is disabled on roof materials, but normal orientation
    // must still be consistent for daylight lighting.
    const base = geometry.positions.length / 3;
    for (const [point, y] of [[p, py], [q, qy], [r, ry]] as Array<[Point2, number]>) {
      geometry.positions.push(point.x, y, point.z);
      geometry.uvs.push(point.x / 1.2, point.z / 1.2);
    }
    // Roof slopes should point up; gable end triangles are vertical.
    if (Math.abs(ny) > 1e-5 && ny < 0) {
      [nx, ny, nz] = [-nx, -ny, -nz];
      geometry.indices.push(base, base + 2, base + 1);
    } else {
      geometry.indices.push(base, base + 1, base + 2);
    }
    for (let i = 0; i < 3; i++) {
      geometry.normals.push(nx / length, ny / length, nz / length);
    }
  };

  const quad = (p: Point2, py: number, t: Point2, ty: number,
    u: Point2, uy: number, v: Point2, vy: number): void => {
    triangle(p, py, t, ty, u, uy);
    triangle(p, py, u, uy, v, vy);
  };

  if (style === 'hipped') {
    const shortLength = edgeLength(a, d);
    const longLength = edgeLength(a, b);
    // Hip ridge is shorter than the building length and closes all four sides.
    const t = Math.min(0.43, Math.max(0.08, shortLength / (2 * longLength)));
    const start = { x: ridge0.x + (ridge1.x - ridge0.x) * t,
      z: ridge0.z + (ridge1.z - ridge0.z) * t };
    const end = { x: ridge1.x + (ridge0.x - ridge1.x) * t,
      z: ridge1.z + (ridge0.z - ridge1.z) * t };
    quad(a, wallY, b, wallY, end, ridgeY, start, ridgeY);
    quad(d, wallY, c, wallY, end, ridgeY, start, ridgeY);
    triangle(a, wallY, start, ridgeY, d, wallY);
    triangle(b, wallY, c, wallY, end, ridgeY);
  } else {
    quad(a, wallY, b, wallY, ridge1, ridgeY, ridge0, ridgeY);
    quad(d, wallY, c, wallY, ridge1, ridgeY, ridge0, ridgeY);
    triangle(a, wallY, ridge0, ridgeY, d, wallY);
    triangle(b, wallY, c, wallY, ridge1, ridgeY);
  }
  return geometry.indices.length ? geometry : null;
}
