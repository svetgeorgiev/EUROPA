import { geoToWorld, type GeoAnchor } from '../geo/coordinates.ts';
import { extractBuildings, type SourceFeature } from './osmBuildingImports.ts';

export type Point2 = { x: number; z: number };
export type RoadSegment = { id: number; highway: string; widthMeters: number; a: Point2; b: Point2 };
export type BuildingFootprint = {
  id: number; heightMeters: number; outline: Point2[];
  /** Original OSM way/id or relation/id when known. Legacy maps omit this. */
  sourceId?: string;
  buildingType?: string;
  roofShape?: string;
  roofMaterial?: string;
  roofHeightMeters?: number;
};

export interface WorldMap {
  schemaVersion: 1;
  location: 'Nova Zagora, Bulgaria';
  source: 'OpenStreetMap';
  attribution: '© OpenStreetMap contributors';
  licenseUrl: 'https://www.openstreetmap.org/copyright';
  collectedAt: string;
  anchor: GeoAnchor;
  halfSizeMeters: number;
  roads: RoadSegment[];
  buildings: BuildingFootprint[];
}

interface NodePosition { lat: number; lon: number }
export interface OverpassData {
  elements: SourceFeature[];
  osm3s?: { timestamp_osm_base?: string };
}

const HIGHWAY_WIDTHS: Record<string, number> = {
  motorway: 18, trunk: 15, primary: 12, secondary: 10,
  tertiary: 8, residential: 6, living_street: 5,
  unclassified: 6, service: 4, pedestrian: 5,
  footway: 2, path: 1.5, cycleway: 2, track: 3,
};
export const MAP_HALF_SIZE_METERS = 500;
const CLIP_MARGIN = 10;

function point2(position: NodePosition, anchor: GeoAnchor): Point2 {
  const local = geoToWorld(
    { latitude: position.lat, longitude: position.lon, elevationMeters: anchor.elevationMeters },
    anchor
  );
  return { x: local.x, z: local.z };
}

/** Liang-Barsky clipping against a square bounding box in local metres. */
function clipSegment(a: Point2, b: Point2, limit: number): [Point2, Point2] | null {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const p = [-dx, dx, -dz, dz];
  const q = [a.x + limit, limit - a.x, a.z + limit, limit - a.z];
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
  const first = { x: a.x + low * dx, z: a.z + low * dz };
  const last = { x: a.x + high * dx, z: a.z + high * dz };
  if (Math.hypot(last.x - first.x, last.z - first.z) < 0.3) return null;
  return [first, last];
}


export function buildWorldMap(
  data: OverpassData,
  anchor: GeoAnchor,
  collectedAt: string = data.osm3s?.timestamp_osm_base ?? 'unknown'
): WorldMap {
  if (!Array.isArray(data?.elements)) throw new Error('Overpass response has no elements array');
  const roads: RoadSegment[] = [];
  const limit = MAP_HALF_SIZE_METERS + CLIP_MARGIN;
  for (const way of data.elements) {
    if (way.type !== 'way' || !Number.isSafeInteger(way.id) || !Array.isArray(way.geometry)) continue;
    if (!way.tags || way.geometry.length < 2) continue;
    if (!way.geometry.every(pos => Number.isFinite(pos.lat) && Number.isFinite(pos.lon))) continue;
    const line = way.geometry.map(position => point2(position, anchor));
    const width = way.tags.highway ? HIGHWAY_WIDTHS[way.tags.highway] : undefined;
    if (width !== undefined) {
      for (let i = 0; i < line.length - 1; i++) {
        const clipped = clipSegment(line[i], line[i + 1], limit);
        if (clipped) roads.push({ id: way.id, highway: way.tags.highway, widthMeters: width, a: clipped[0], b: clipped[1] });
      }
    }
  }
  // Building geometry is imported separately so roads preserve their stable
  // 002B representation while boundary-crossing outlines and simple OSM
  // multipolygon relations can be handled without fabricating POI buildings.
  const { buildings } = extractBuildings(data.elements, anchor);
  return {
    schemaVersion: 1, location: 'Nova Zagora, Bulgaria',
    source: 'OpenStreetMap', attribution: '© OpenStreetMap contributors',
    licenseUrl: 'https://www.openstreetmap.org/copyright',
    collectedAt, anchor, halfSizeMeters: MAP_HALF_SIZE_METERS,
    roads, buildings
  };
}

export function isWorldMap(input: unknown): input is WorldMap {
  if (!input || typeof input !== 'object') return false;
  const candidate = input as Partial<WorldMap>;
  return candidate.schemaVersion === 1 && candidate.source === 'OpenStreetMap' &&
    candidate.location === 'Nova Zagora, Bulgaria' && Array.isArray(candidate.roads) &&
    Array.isArray(candidate.buildings) && candidate.roads.length > 0 &&
    candidate.halfSizeMeters === MAP_HALF_SIZE_METERS &&
    typeof candidate.anchor?.latitude === 'number' && typeof candidate.anchor?.longitude === 'number';
}
