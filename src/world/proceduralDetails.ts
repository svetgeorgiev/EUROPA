import type { BuildingFootprint, Point2, RoadSegment } from './osm.ts';
import { roadDecorIntervals, type MapBounds } from './roadJunctions.ts';

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

/**
 * Clip each decorative road strip against its owning 250m tile. This avoids
 * the overlapping cross-tile quads that previously produced large dark patches.
 */
function clipRect(poly: Point2[], bounds: MapBounds): Point2[] {
  const planes: [keyof Point2, number, boolean][] = [
    ['x', bounds.minX, true], ['x', bounds.maxX, false],
    ['z', bounds.minZ, true], ['z', bounds.maxZ, false]
  ];
  let output = poly;
  for (const [axis, value, keepGreater] of planes) {
    const input = output;
    output = [];
    if (!input.length) break;
    const inside = (p: Point2) => keepGreater ? p[axis] >= value - 1e-9 : p[axis] <= value + 1e-9;
    const intersect = (a: Point2, b: Point2): Point2 => {
      const difference = b[axis] - a[axis];
      const t = Math.abs(difference) < 1e-12 ? 0 : (value - a[axis]) / difference;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    };
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length];
      const ia = inside(a), ib = inside(b);
      if (ia && ib) output.push(b);
      else if (ia && !ib) output.push(intersect(a, b));
      else if (!ia && ib) output.push(intersect(a, b), b);
    }
  }
  return output;
}

function ribbon(
  mesh: DetailGeometry,
  a: Point2,
  b: Point2,
  offsetFromCenter: number,
  width: number,
  y: number,
  clip?: MapBounds
): void {
  const dx = b.x - a.x, dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (!(length > 0.1) || !Number.isFinite(length) || !(width > 0)) return;
  const nx = -dz / length, nz = dx / length;
  const left = offsetFromCenter - width / 2;
  const right = offsetFromCenter + width / 2;
  const poly = [
    { x: a.x + nx * left, z: a.z + nz * left },
    { x: a.x + nx * right, z: a.z + nz * right },
    { x: b.x + nx * right, z: b.z + nz * right },
    { x: b.x + nx * left, z: b.z + nz * left }
  ];
  const vertices = clip ? clipRect(poly, clip) : poly;
  if (vertices.length < 3) return;
  const base = mesh.positions.length / 3;
  for (const p of vertices) {
    mesh.positions.push(p.x, y, p.z);
    mesh.normals.push(0, 1, 0);
  }
  for (let i = 1; i < vertices.length - 1; i++) {
    const a = vertices[0], b = vertices[i], c = vertices[i+1];
    const crossY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    if (Math.abs(crossY) < 1e-10) continue;
    if (crossY > 0) mesh.indices.push(base, base + i, base + i + 1);
    else mesh.indices.push(base, base + i + 1, base + i);
  }
}

const PAVED = new Set([
  'primary', 'secondary', 'tertiary', 'residential', 'living_street', 'unclassified'
]);

/**
 * Procedurally inferred details, NOT surveyed OSM sidewalks or markings.
 * Kept below a modest geometry budget, with one merged mesh per tile/type.
 */
export function buildRoadDecor(
  roads: readonly RoadSegment[],
  bounds?: MapBounds
): { shoulders: DetailGeometry; markings: DetailGeometry } {
  const shoulders = blank();
  const markings = blank();
  for (let index = 0; index < roads.length; index++) {
    const road = roads[index];
    if (!PAVED.has(road.highway) || road.widthMeters < 5) continue;
    const dx = road.b.x - road.a.x, dz = road.b.z - road.a.z;
    const length = Math.hypot(dx, dz);
    if (!Number.isFinite(length) || length < 0.5) continue;
    const ux = dx / length, uz = dz / length;
    const position = (distance: number): Point2 => ({
      x: road.a.x + ux * distance, z: road.a.z + uz * distance
    });

    // No pavements or dashed paint across the centre of another street.
    // Ordinary sections retain their markings and edge strips.
    for (const [begin, end] of roadDecorIntervals(roads, index, 6.5)) {
      if (end - begin < 1) continue;
      for (const side of [-1, 1]) {
        ribbon(shoulders, position(begin), position(end),
          side * (road.widthMeters / 2 + 0.68), 1.15, 0.065, bounds);
      }
      if (road.widthMeters < 6 || road.highway === 'living_street') continue;
      for (let start = begin + 0.6; start + 2.5 < end; start += 10) {
        ribbon(markings, position(start), position(start + 2.5),
          0, 0.11, 0.072, bounds);
      }
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
