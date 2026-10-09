import type { BuildingFootprint, Point2, RoadSegment } from './osm.ts';

export interface DetailGeometry {
  positions: number[];
  indices: number[];
  normals: number[];
  colors?: number[];
}
interface MutableGeometry extends DetailGeometry { colors: number[] }

function blank(colors = false): DetailGeometry {
  return colors
    ? { positions: [], indices: [], normals: [], colors: [] }
    : { positions: [], indices: [], normals: [] };
}

/** A double-sided, flat horizontal ribbon. All points use world X/Z metres. */
function ribbon(
  mesh: DetailGeometry,
  a: Point2,
  b: Point2,
  offsetFromCenter: number,
  width: number,
  y: number
): void {
  const dx = b.x - a.x, dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (!(length > 0.1) || !Number.isFinite(length) || !(width > 0)) return;
  const nx = -dz / length, nz = dx / length;
  const left = offsetFromCenter - width / 2;
  const right = offsetFromCenter + width / 2;
  const base = mesh.positions.length / 3;
  mesh.positions.push(
    a.x + nx * left, y, a.z + nz * left,
    a.x + nx * right, y, a.z + nz * right,
    b.x + nx * left, y, b.z + nz * left,
    b.x + nx * right, y, b.z + nz * right
  );
  mesh.indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  for (let i = 0; i < 4; i++) mesh.normals.push(0, 1, 0);
}

const PAVED = new Set([
  'primary', 'secondary', 'tertiary', 'residential', 'living_street', 'unclassified'
]);

/**
 * Procedurally inferred details, NOT surveyed OSM sidewalks or markings.
 * Kept below a modest geometry budget, with one merged mesh per tile/type.
 */
export function buildRoadDecor(roads: readonly RoadSegment[]): {
  shoulders: DetailGeometry;
  markings: DetailGeometry;
} {
  const shoulders = blank();
  const markings = blank();
  for (const road of roads) {
    if (!PAVED.has(road.highway) || road.widthMeters < 5) continue;
    for (const side of [-1, 1]) {
      ribbon(shoulders, road.a, road.b,
        side * (road.widthMeters / 2 + 0.68), 1.15, 0.065);
    }
    if (road.widthMeters < 6 || road.highway === 'living_street') continue;
    const dx = road.b.x - road.a.x, dz = road.b.z - road.a.z;
    const length = Math.hypot(dx, dz);
    if (!Number.isFinite(length) || length < 3.8) continue;
    const ux = dx / length, uz = dz / length;
    // Deliberately faded 2.5m dashed centre markings. Each OSM way segment
    // starts its own dashes; real marked road data is not yet available.
    for (let start = 0.6; start + 2.5 < length; start += 10) {
      ribbon(markings,
        { x: road.a.x + ux * start, z: road.a.z + uz * start },
        { x: road.a.x + ux * (start + 2.5), z: road.a.z + uz * (start + 2.5) },
        0, 0.11, 0.072);
    }
  }
  return { shoulders, markings };
}

function polygonArea(points: readonly Point2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const b = points[(i + 1) % points.length];
    area += points[i].x * b.z - b.x * points[i].z;
  }
  return area / 2;
}

function quad(
  mesh: MutableGeometry,
  a: Point2,
  b: Point2,
  u0: number,
  u1: number,
  y0: number,
  y1: number,
  depth: number,
  normal: Point2,
  color: readonly [number, number, number]
): void {
  const dx = b.x - a.x, dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.01) return;
  const ux = dx / length, uz = dz / length;
  const offset = mesh.positions.length / 3;
  for (const [u, y] of [[u0, y0], [u1, y0], [u0, y1], [u1, y1]]) {
    mesh.positions.push(a.x + ux * u + normal.x * depth, y,
      a.z + uz * u + normal.z * depth);
    mesh.normals.push(normal.x, 0, normal.z);
    mesh.colors.push(color[0], color[1], color[2], 1);
  }
  mesh.indices.push(offset, offset + 1, offset + 2,
    offset + 2, offset + 1, offset + 3);
}

const FRAME: readonly [number, number, number] = [0.54, 0.56, 0.53];
const GLASS: readonly [number, number, number] = [0.12, 0.20, 0.24];
const MULLION: readonly [number, number, number] = [0.47, 0.50, 0.48];
const DOOR: readonly [number, number, number] = [0.30, 0.25, 0.22];

/**
 * Generated visual details only. Deterministic from OSM footprints; not claims
 * about the real town's number of windows, doors, or building facade styles.
 *
 * A single mesh per tile keeps draw calls modest. The details do not affect
 * the authoritative sealed building footprint collision system.
 */
export function buildFacadeDecor(buildings: readonly BuildingFootprint[]): DetailGeometry {
  const mesh = blank(true) as MutableGeometry;
  for (const building of buildings) {
    const outline = building.outline;
    if (outline.length < 3 || outline.length > 300 ||
        !Number.isFinite(building.heightMeters) || building.heightMeters < 2.5 ||
        outline.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))) continue;
    const area = polygonArea(outline);
    if (Math.abs(area) < 1e-5) continue;
    const winding = area > 0 ? 1 : -1;
    const lengths = outline.map((a, i) =>
      Math.hypot(outline[(i + 1) % outline.length].x - a.x,
        outline[(i + 1) % outline.length].z - a.z));
    const longestEdge = lengths.indexOf(Math.max(...lengths));
    const floors = Math.min(4, Math.max(1, Math.floor(building.heightMeters / 3)));

    for (let edge = 0; edge < outline.length; edge++) {
      const a = outline[edge], b = outline[(edge + 1) % outline.length];
      const length = lengths[edge];
      if (!(length >= 3.8)) continue;
      const outward: Point2 = {
        x: winding * (b.z - a.z) / length,
        z: -winding * (b.x - a.x) / length
      };
      const columns = Math.max(1, Math.min(6, Math.floor(length / 3.2)));
      const bay = length / columns;
      for (let floor = 0; floor < floors; floor++) {
        const centerY = 1.65 + floor * 3;
        if (centerY + 0.7 >= building.heightMeters) continue;
        for (let col = 0; col < columns; col++) {
          const cx = (col + 0.5) * bay;
          const isDoor = floor === 0 && edge === longestEdge &&
            col === Math.floor(columns / 2) && bay >= 2.2;
          if (isDoor) {
            quad(mesh, a, b, cx - 0.67, cx + 0.67, 0.03, 2.25,
              0.065, outward, FRAME);
            quad(mesh, a, b, cx - 0.58, cx + 0.58, 0.03, 2.18,
              0.08, outward, DOOR);
            continue;
          }
          const half = Math.min(0.74, bay * 0.31);
          quad(mesh, a, b, cx - half, cx + half, centerY - 0.72, centerY + 0.72,
            0.055, outward, FRAME);
          quad(mesh, a, b, cx - half + 0.10, cx + half - 0.10,
            centerY - 0.62, centerY + 0.62, 0.085, outward, GLASS);
          quad(mesh, a, b, cx - 0.035, cx + 0.035,
            centerY - 0.62, centerY + 0.62, 0.11, outward, MULLION);
          quad(mesh, a, b, cx - half + 0.10, cx + half - 0.10,
            centerY - 0.04, centerY + 0.04, 0.115, outward, MULLION);
        }
      }
    }
  }
  return mesh;
}
