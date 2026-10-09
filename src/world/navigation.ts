import { geoToWorld, type GeoAnchor } from '../geo/coordinates.ts';
import type { Point2 } from './osm.ts';

/** Separate ODbL-derived navigation dataset. Never used as gameplay authority. */
export interface NamedStreet {
  id: string; name: string; highway: string; point: Point2;
}
export interface Landmark {
  id: string; name: string; kind: string; point: Point2;
}
export interface NavigationData {
  schemaVersion: 1;
  source: 'OpenStreetMap';
  attribution: '© OpenStreetMap contributors';
  licenseUrl: 'https://www.openstreetmap.org/copyright';
  collectedAt: string;
  anchor: GeoAnchor;
  halfSizeMeters: number;
  streets: NamedStreet[];
  landmarks: Landmark[];
}
type Tags = Record<string, string>;
interface RawElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  geometry?: Array<{ lat: number; lon: number }>;
  tags?: Tags;
}
export interface RawOsmNavigation {
  elements: RawElement[];
  osm3s?: { timestamp_osm_base?: string };
}
const HALFSIZE = 500;
const MARGIN = 10;

const PUBLIC_KINDS: Record<string, Set<string>> = {
  amenity: new Set([
    'school', 'university', 'college', 'kindergarten', 'hospital', 'clinic',
    'pharmacy', 'library', 'townhall', 'police', 'fire_station',
    'post_office', 'place_of_worship', 'theatre', 'cinema',
    'restaurant', 'cafe', 'bank', 'bus_station', 'community_centre'
  ]),
  tourism: new Set(['museum', 'attraction', 'hotel', 'information', 'gallery']),
  historic: new Set(['monument', 'memorial', 'castle', 'archaeological_site']),
  leisure: new Set(['park', 'stadium', 'sports_centre', 'playground']),
  railway: new Set(['station', 'halt']),
  public_transport: new Set(['station', 'platform']),
  shop: new Set(['supermarket', 'bakery', 'convenience']),
  place: new Set(['square', 'neighbourhood', 'suburb'])
};

function nameFrom(tags: Tags): string {
  // OSM Bulgarian names take priority when present. Never infer or translate.
  const raw = tags['name:bg'] || tags.name || tags['name:en'] || '';
  const name = raw.trim().replace(/\s+/g, ' ');
  return name.length > 0 && name.length <= 90 ? name : '';
}
function kindFrom(tags: Tags): string {
  for (const [key, values] of Object.entries(PUBLIC_KINDS)) {
    const value = tags[key];
    if (value && values.has(value)) return key + ':' + value;
  }
  return '';
}
function inArea(p: Point2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.z) &&
    Math.abs(p.x) <= HALFSIZE + MARGIN && Math.abs(p.z) <= HALFSIZE + MARGIN;
}
function local(point: { lat: number; lon: number }, anchor: GeoAnchor): Point2 | null {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) ||
      point.lat < -90 || point.lat > 90 || point.lon < -180 || point.lon > 180) return null;
  const p = geoToWorld({ latitude: point.lat, longitude: point.lon,
    elevationMeters: anchor.elevationMeters }, anchor);
  return { x: p.x, z: p.z };
}
function isValidAnchor(anchor: GeoAnchor): boolean {
  return Number.isFinite(anchor.latitude) && Number.isFinite(anchor.longitude) &&
    Number.isFinite(anchor.elevationMeters) && Math.abs(anchor.latitude) < 89.9 &&
    Math.abs(anchor.latitude) <= 90 && Math.abs(anchor.longitude) <= 180;
}

function midpointOnLongestSegment(points: Point2[]): Point2 | null {
  let best: Point2 | null = null;
  let longest = -1;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    // Only position text along the part of a road actually within our map.
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    if (!inArea(mid)) continue;
    const length = Math.hypot(a.x - b.x, a.z - b.z);
    if (length > longest && length > 2) {
      best = mid;
      longest = length;
    }
  }
  return best;
}

export function buildNavigationData(
  raw: RawOsmNavigation, anchor: GeoAnchor,
  collectedAt = raw?.osm3s?.timestamp_osm_base ?? new Date().toISOString()
): NavigationData {
  if (!raw || !Array.isArray(raw.elements)) throw new Error('Invalid OSM JSON: expected elements array');
  if (!isValidAnchor(anchor)) throw new RangeError('Invalid navigation anchor');

  const nodes = new Map<number, { lat: number; lon: number }>();
  for (const element of raw.elements) {
    if (element?.type === 'node' && Number.isSafeInteger(element.id) &&
        Number.isFinite(element.lat) && Number.isFinite(element.lon)) {
      nodes.set(element.id, { lat: element.lat!, lon: element.lon! });
    }
  }

  const streets: NamedStreet[] = [];
  const landmarks: Landmark[] = [];
  const visited = new Set<string>();
  for (const element of raw.elements) {
    if (!element || !['node', 'way'].includes(element.type) ||
        !Number.isSafeInteger(element.id) || !element.tags) continue;
    const tags = element.tags;
    const name = nameFrom(tags);
    if (!name) continue;
    const id = element.type + '/' + element.id;
    if (visited.has(id)) continue;
    visited.add(id);

    let points: Point2[] = [];
    if (element.type === 'node') {
      const lat = element.lat, lon = element.lon;
      if (typeof lat === 'number' && typeof lon === 'number') {
        const position = local({ lat, lon }, anchor);
        if (position) points = [position];
      }
    } else {
      const geography = Array.isArray(element.geometry)
        ? element.geometry
        : (Array.isArray(element.nodes) ? element.nodes.map(id => nodes.get(id)) : []);
      if (!geography.length || geography.some(p => !p)) continue;
      points = geography.map(p => local(p!, anchor)).filter((p): p is Point2 => p !== null);
      if (points.length !== geography.length) continue;
    }
    if (!points.length) continue;

    if (element.type === 'way' && typeof tags.highway === 'string' && tags.highway) {
      const point = midpointOnLongestSegment(points);
      if (point) streets.push({ id, name, highway: tags.highway, point });
    }
    const kind = kindFrom(tags);
    if (!kind) continue;
    // Centre of the footprint for public map labels; not an entrance location.
    const all = points.length > 2 &&
      Math.hypot(points[0].x - points.at(-1)!.x, points[0].z - points.at(-1)!.z) < 0.5
      ? points.slice(0, -1) : points;
    const centre = all.reduce((p, next) => ({ x: p.x + next.x, z: p.z + next.z }), { x: 0, z: 0 });
    centre.x /= all.length;
    centre.z /= all.length;
    if (inArea(centre)) landmarks.push({ id, name, kind, point: centre });
  }
  streets.sort((a, b) => a.name.localeCompare(b.name, 'bg') || a.id.localeCompare(b.id));
  landmarks.sort((a, b) => a.name.localeCompare(b.name, 'bg') || a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    source: 'OpenStreetMap',
    attribution: '© OpenStreetMap contributors',
    licenseUrl: 'https://www.openstreetmap.org/copyright',
    collectedAt,
    anchor,
    halfSizeMeters: HALFSIZE,
    streets,
    landmarks
  };
}

export function isNavigationData(input: unknown, expectedAnchor?: GeoAnchor): input is NavigationData {
  if (!input || typeof input !== 'object') return false;
  const data = input as Partial<NavigationData>;
  if (data.schemaVersion !== 1 || data.source !== 'OpenStreetMap' ||
      data.halfSizeMeters !== HALFSIZE ||
      !data.anchor || !isValidAnchor(data.anchor) ||
      !Array.isArray(data.streets) || !Array.isArray(data.landmarks)) return false;
  if (expectedAnchor && (
      Math.abs(expectedAnchor.latitude - data.anchor.latitude) > 1e-7 ||
      Math.abs(expectedAnchor.longitude - data.anchor.longitude) > 1e-7 ||
      Math.abs(expectedAnchor.elevationMeters - data.anchor.elevationMeters) > 0.001)) return false;
  const validPoint = (p: unknown): p is Point2 =>
    !!p && typeof p === 'object' && Number.isFinite((p as Point2).x) &&
    Number.isFinite((p as Point2).z) && inArea(p as Point2);
  return data.streets.every(item => item && typeof item.name === 'string' &&
    item.name.length > 0 && item.name.length <= 90 && validPoint(item.point)) &&
    data.landmarks.every(item => item && typeof item.name === 'string' &&
    typeof item.kind === 'string' && item.kind.length > 0 && validPoint(item.point));
}

export function nearestNamedStreet(
  streets: readonly NamedStreet[], position: Point2, maxDistanceMeters = 120
): NamedStreet | null {
  let nearest: NamedStreet | null = null;
  let distance = maxDistanceMeters * maxDistanceMeters;
  for (const street of streets) {
    const delta = (street.point.x - position.x) ** 2 + (street.point.z - position.z) ** 2;
    if (delta < distance) {
      nearest = street;
      distance = delta;
    }
  }
  // Label location is approximate; avoid claiming we're exactly on a street.
  return nearest;
}
