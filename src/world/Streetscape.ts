import type { BuildingFootprint, Point2, RoadSegment } from './osm.ts';
import type { MapBounds } from './roadJunctions.ts';
import { footprintDistance } from './buildingCoverage.ts';

export interface TreePlacement extends Point2 {
  height: number;
  radius: number;
  shade: number;
}
export interface TreeGeometry {
  positions: number[];
  normals: number[];
  indices: number[];
  colors: number[];
}
export interface StreetscapeGeometry {
  trunks: TreeGeometry;
  foliage: TreeGeometry;
}
const STREETS = new Set([
  'residential', 'living_street', 'tertiary', 'secondary', 'unclassified', 'primary'
]);
const LEAVES: readonly [number, number, number][] = [
  [0.83, 0.95, 0.77], [0.69, 0.84, 0.67],
  [0.88, 0.85, 0.63], [0.77, 0.90, 0.62],
  [0.85, 0.77, 0.54]
];
const BARK: readonly [number, number, number] = [0.92, 0.83, 0.73];
const asPoint = (v: Point2): Point2 => ({ x: v.x, z: v.z });
function segmentDistance(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const denom = dx * dx + dz * dz;
  const t = denom > 1e-9 ? Math.max(0, Math.min(1,
    ((p.x - a.x) * dx + (p.z - a.z) * dz) / denom)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
function hash(n: number): number {
  let value = (n >>> 0) ^ 0x9e3779b9;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}
function seedFor(road: RoadSegment, i: number, side: number): number {
  return Math.trunc(road.id) * 1021 + i * 773 +
    Math.round(road.a.x * 3) * 11 + Math.round(road.a.z * 3) * 7 + side * 193;
}
function insideBounds(point: Point2, bounds: MapBounds, margin = 4): boolean {
  return point.x >= bounds.minX + margin && point.x < bounds.maxX - margin &&
    point.z >= bounds.minZ + margin && point.z < bounds.maxZ - margin;
}
/**
 * Fictional streetscape decoration — NOT a vegetation inventory from OSM.
 * Plant only near existing mapped road corridors, never on asphalt or inside
 * the building footprints supplied by this prototype.
 */
export function generateRoadsideTrees(
  roads: readonly RoadSegment[],
  buildings: readonly BuildingFootprint[],
  bounds: MapBounds,
  maxTrees = 46
): TreePlacement[] {
  const trees: TreePlacement[] = [];
  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX) ||
      !Number.isFinite(bounds.minZ) || !Number.isFinite(bounds.maxZ) ||
      bounds.maxX <= bounds.minX || bounds.maxZ <= bounds.minZ || maxTrees < 1) return trees;
  // De-duplicate OSM ways that share the same centreline.
  const ordered = [...roads].filter(road => STREETS.has(road.highway)).sort(
    (a, b) => a.id - b.id || a.a.x - b.a.x || a.a.z - b.a.z
  );
  for (const road of ordered) {
    const dx = road.b.x - road.a.x, dz = road.b.z - road.a.z;
    const length = Math.hypot(dx, dz);
    if (length < 8 || !Number.isFinite(length) || !Number.isFinite(road.widthMeters)) continue;
    const normalX = -dz / length, normalZ = dx / length;
    const count = Math.max(1, Math.floor(length / 18));
    for (let i = 0; i < count; i++) {
      for (const side of [-1, 1]) {
        const seed = seedFor(road, i, side);
        if (hash(seed) < 0.17) continue;
        const t = Math.max(0.12, Math.min(0.88,
          ((i + 0.5) / count) + (hash(seed + 1) - 0.5) * 0.18));
        const offset = road.widthMeters / 2 + 3.7 + hash(seed + 2) * 1.8;
        const candidate: Point2 = {
          x: road.a.x + dx * t + normalX * side * offset,
          z: road.a.z + dz * t + normalZ * side * offset
        };
        if (!insideBounds(candidate, bounds)) continue;
        if (trees.some(tree => Math.hypot(tree.x - candidate.x, tree.z - candidate.z) < 9)) continue;
        // A second nearby road (crossroads, alleys) takes precedence.
        if (roads.some(other => {
          if (!(other.widthMeters > 0)) return false;
          return segmentDistance(candidate, other.a, other.b) < other.widthMeters / 2 + 2.1;
        })) continue;
        if (buildings.some(building => footprintDistance(candidate, building) < 3.7)) continue;
        trees.push({
          ...asPoint(candidate),
          height: 4.7 + hash(seed + 3) * 2.4,
          radius: 1.55 + hash(seed + 4) * 0.65,
          shade: Math.floor(hash(seed + 5) * LEAVES.length)
        });
        if (trees.length >= maxTrees) return trees;
      }
    }
  }
  return trees;
}
function empty(): TreeGeometry {
  return { positions: [], normals: [], indices: [], colors: [] };
}
type V3 = readonly [number, number, number];
function triangle(
  mesh: TreeGeometry, a: V3, b: V3, c: V3, color: readonly [number, number, number]
): void {
  const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross: V3 = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0]
  ];
  const norm = Math.hypot(...cross);
  if (norm < 1e-7) return;
  const start = mesh.positions.length / 3;
  for (const v of [a, b, c]) {
    mesh.positions.push(...v);
    mesh.normals.push(cross[0] / norm, cross[1] / norm, cross[2] / norm);
    mesh.colors.push(...color, 1);
  }
  mesh.indices.push(start, start + 1, start + 2);
}
function quad(mesh: TreeGeometry, a: V3, b: V3, c: V3, d: V3,
  color: readonly [number, number, number]): void {
  triangle(mesh, a, b, c, color);
  triangle(mesh, a, c, d, color);
}
/** Batches all trees in a tile into only two Babylon meshes. */
export function buildTreeGeometry(trees: readonly TreePlacement[]): StreetscapeGeometry {
  const trunks = empty(), foliage = empty();
  for (const tree of trees) {
    if (![tree.x, tree.z, tree.radius, tree.height].every(Number.isFinite) ||
        tree.radius < 0.1 || tree.height < 1) continue;
    const x = tree.x, z = tree.z;
    const trunkTop = tree.height * 0.51;
    const trunkRadius = 0.12 + tree.radius * 0.035;
    const sides = 6, leavesSides = 8;
    for (let j = 0; j < sides; j++) {
      const angleA = 2 * Math.PI * j / sides, angleB = 2 * Math.PI * (j + 1) / sides;
      const a: V3 = [x + Math.cos(angleA) * trunkRadius, 0, z + Math.sin(angleA) * trunkRadius];
      const b: V3 = [x + Math.cos(angleB) * trunkRadius, 0, z + Math.sin(angleB) * trunkRadius];
      const c: V3 = [b[0], trunkTop, b[2]], d: V3 = [a[0], trunkTop, a[2]];
      quad(trunks, a, b, c, d, BARK);
    }
    const shade = LEAVES[Math.abs(Math.trunc(tree.shade)) % LEAVES.length];
    // Faceted deciduous canopy: wide lower crown plus a narrower upper crown.
    const bottom = tree.height * 0.44, equator = tree.height * 0.70;
    const top = tree.height;
    for (let j = 0; j < leavesSides; j++) {
      const angleA = 2 * Math.PI * j / leavesSides;
      const angleB = 2 * Math.PI * (j + 1) / leavesSides;
      const ca = Math.cos(angleA), cb = Math.cos(angleB);
      const sa = Math.sin(angleA), sb = Math.sin(angleB);
      const lowA: V3 = [x + ca * tree.radius * 0.52, bottom, z + sa * tree.radius * 0.52];
      const lowB: V3 = [x + cb * tree.radius * 0.52, bottom, z + sb * tree.radius * 0.52];
      const midA: V3 = [x + ca * tree.radius, equator, z + sa * tree.radius];
      const midB: V3 = [x + cb * tree.radius, equator, z + sb * tree.radius];
      const apex: V3 = [x, top, z];
      quad(foliage, lowA, lowB, midB, midA, shade);
      triangle(foliage, midA, midB, apex, shade);
    }
  }
  return { trunks, foliage };
}
