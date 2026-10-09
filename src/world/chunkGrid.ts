import type { GeoAnchor } from '../geo/coordinates.ts';
import type { Point2, RoadSegment, BuildingFootprint, WorldMap } from './osm.ts';

/**
 * EUROPA-002C: fixed 250m grid covering an existing 002B local-world snapshot.
 * All X/Z values are local metres (east/north) from the same anchor.
 * This is a single-region prototype, NOT global floating-origin support.
 */
export const CHUNK_SIZE_METERS = 250;
export const CHUNK_SCHEMA_VERSION = 1 as const;
export const CHUNK_GRID_DIMENSION = 4;
const FOOTPATHS = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'track']);

export interface ChunkIndex { col: number; row: number; }
export interface ChunkSummary extends ChunkIndex {
  id: string;
  roadCount: number;
  buildingCount: number;
}
export interface ChunkFile extends ChunkIndex {
  schemaVersion: typeof CHUNK_SCHEMA_VERSION;
  id: string;
  roads: RoadSegment[];
  buildings: BuildingFootprint[];
}
export interface ChunkManifest {
  schemaVersion: typeof CHUNK_SCHEMA_VERSION;
  location: string;
  source: 'OpenStreetMap';
  attribution: string;
  licenseUrl: string;
  collectedAt: string;
  anchor: GeoAnchor;
  halfSizeMeters: number;
  tileSizeMeters: number;
  origin: Point2;
  cols: number;
  rows: number;
  spawn: Point2;
  chunks: ChunkSummary[];
}

export function chunkId(col: number, row: number): string {
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0) {
    throw new RangeError('Invalid chunk index');
  }
  return col + '_' + row;
}

export function chunkAt(
  point: Point2,
  manifest: Pick<ChunkManifest, 'origin' | 'tileSizeMeters' | 'cols' | 'rows'>
): ChunkIndex | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
  const col = Math.floor((point.x - manifest.origin.x) / manifest.tileSizeMeters);
  const row = Math.floor((point.z - manifest.origin.z) / manifest.tileSizeMeters);
  if (col < 0 || col >= manifest.cols || row < 0 || row >= manifest.rows) return null;
  return { col, row };
}

export function nearbyChunkIds(center: ChunkIndex, manifest: ChunkManifest, radius = 1): string[] {
  if (!Number.isInteger(radius) || radius < 0 || radius > 3) throw new RangeError('Invalid chunk radius');
  const available = new Set(manifest.chunks.map(chunk => chunk.id));
  const output: string[] = [];
  for (let row = Math.max(0, center.row - radius); row <= Math.min(manifest.rows - 1, center.row + radius); row++) {
    for (let col = Math.max(0, center.col - radius); col <= Math.min(manifest.cols - 1, center.col + radius); col++) {
      const id = chunkId(col, row);
      if (available.has(id)) output.push(id);
    }
  }
  // Load the centre first and neighbours progressively.
  return output.sort((a, b) => {
    const [ax, az] = a.split('_').map(Number);
    const [bx, bz] = b.split('_').map(Number);
    return (Math.abs(ax - center.col) + Math.abs(az - center.row)) -
      (Math.abs(bx - center.col) + Math.abs(bz - center.row));
  });
}

function clipSegmentToRect(
  a: Point2, b: Point2, minX: number, maxX: number, minZ: number, maxZ: number
): [Point2, Point2] | null {
  const dx = b.x - a.x, dz = b.z - a.z;
  const p = [-dx, dx, -dz, dz];
  const q = [a.x - minX, maxX - a.x, a.z - minZ, maxZ - a.z];
  let low = 0, high = 1;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-10) {
      if (q[i] < 0) return null;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) low = Math.max(low, t);
      else high = Math.min(high, t);
      if (low > high) return null;
    }
  }
  const p0 = { x: a.x + low * dx, z: a.z + low * dz };
  const p1 = { x: a.x + high * dx, z: a.z + high * dz };
  return Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.1 ? [p0, p1] : null;
}

function assignBuilding(building: BuildingFootprint, manifest: ChunkManifest): string | null {
  if (!building.outline.length) return null;
  const centre = building.outline.reduce((sum, p) => ({ x: sum.x + p.x, z: sum.z + p.z }), { x: 0, z: 0 });
  centre.x /= building.outline.length;
  centre.z /= building.outline.length;
  const col = Math.max(0, Math.min(manifest.cols - 1,
    Math.floor((centre.x - manifest.origin.x) / manifest.tileSizeMeters)));
  const row = Math.max(0, Math.min(manifest.rows - 1,
    Math.floor((centre.z - manifest.origin.z) / manifest.tileSizeMeters)));
  return chunkId(col, row);
}

function chooseSpawn(roads: RoadSegment[]): Point2 {
  let best = roads[0];
  let closest = Number.POSITIVE_INFINITY;
  for (const road of roads) {
    if (FOOTPATHS.has(road.highway)) continue;
    const mx = (road.a.x + road.b.x) / 2;
    const mz = (road.a.z + road.b.z) / 2;
    const distance = mx * mx + mz * mz;
    if (distance < closest) {
      closest = distance;
      best = road;
    }
  }
  return { x: (best.a.x + best.b.x) / 2, z: (best.a.z + best.b.z) / 2 };
}

export function splitWorldMap(map: WorldMap): { manifest: ChunkManifest; chunks: ChunkFile[] } {
  if (map.halfSizeMeters !== 500 || !map.roads?.length || !Array.isArray(map.buildings)) {
    throw new Error('002C requires a valid 1 km x 1 km map.json generated by 002B');
  }
  const manifest: ChunkManifest = {
    schemaVersion: CHUNK_SCHEMA_VERSION,
    location: map.location,
    source: 'OpenStreetMap',
    attribution: map.attribution,
    licenseUrl: map.licenseUrl,
    collectedAt: map.collectedAt,
    anchor: map.anchor,
    halfSizeMeters: map.halfSizeMeters,
    tileSizeMeters: CHUNK_SIZE_METERS,
    origin: { x: -500, z: -500 },
    cols: CHUNK_GRID_DIMENSION,
    rows: CHUNK_GRID_DIMENSION,
    spawn: chooseSpawn(map.roads),
    chunks: []
  };
  const chunks: ChunkFile[] = [];
  const lookup = new Map<string, ChunkFile>();
  for (let row = 0; row < manifest.rows; row++) {
    for (let col = 0; col < manifest.cols; col++) {
      const id = chunkId(col, row);
      const chunk: ChunkFile = { schemaVersion: 1, id, col, row, roads: [], buildings: [] };
      chunks.push(chunk);
      lookup.set(id, chunk);
    }
  }

  for (const road of map.roads) {
    // Clip road centre-lines to each relevant tile plus half its actual width.
    // This prevents cracks in road ribbons at chunk seams.
    const pad = Math.max(1, road.widthMeters / 2);
    for (const chunk of chunks) {
      const minX = manifest.origin.x + chunk.col * CHUNK_SIZE_METERS - pad;
      const minZ = manifest.origin.z + chunk.row * CHUNK_SIZE_METERS - pad;
      const line = clipSegmentToRect(road.a, road.b,
        minX, minX + CHUNK_SIZE_METERS + 2 * pad,
        minZ, minZ + CHUNK_SIZE_METERS + 2 * pad);
      if (line) chunk.roads.push({ ...road, a: line[0], b: line[1] });
    }
  }
  for (const building of map.buildings) {
    // The building has one owner: no duplicate renderers or collision meshes.
    // Adjacent chunks are preloaded, so a boundary-crossing footprint stays
    // visible within the surrounding neighbourhood.
    const id = assignBuilding(building, manifest);
    if (id) lookup.get(id)?.buildings.push(building);
  }
  manifest.chunks = chunks.map(chunk => ({
    id: chunk.id, col: chunk.col, row: chunk.row,
    roadCount: chunk.roads.length, buildingCount: chunk.buildings.length
  }));
  return { manifest, chunks };
}

export function isChunkManifest(input: unknown): input is ChunkManifest {
  if (!input || typeof input !== 'object') return false;
  const m = input as Partial<ChunkManifest>;
  if (m.schemaVersion !== 1 || m.source !== 'OpenStreetMap' ||
      m.tileSizeMeters !== CHUNK_SIZE_METERS || m.cols !== 4 || m.rows !== 4 ||
      m.halfSizeMeters !== 500 || m.origin?.x !== -500 || m.origin?.z !== -500 ||
      !Number.isFinite(m.anchor?.latitude) || !Number.isFinite(m.anchor?.longitude) ||
      !Number.isFinite(m.spawn?.x) || !Number.isFinite(m.spawn?.z) ||
      !Array.isArray(m.chunks) || m.chunks.length !== 16) return false;
  const expected = new Set<string>();
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) expected.add(chunkId(col, row));
  return m.chunks.every(c => {
    if (!c || !expected.has(c.id) || c.id !== chunkId(c.col, c.row)) return false;
    expected.delete(c.id);
    return true;
  }) && expected.size === 0;
}

export function isChunkFile(input: unknown, expectedId: string): input is ChunkFile {
  if (!input || typeof input !== 'object') return false;
  const c = input as Partial<ChunkFile>;
  if (c.schemaVersion !== 1 || c.id !== expectedId || !Array.isArray(c.roads) || !Array.isArray(c.buildings)) {
    return false;
  }
  return true;
}
