import { geoToWorld, type GeoAnchor } from '../geo/coordinates.ts';
import type { Point2 } from './osm.ts';
import type { SourceFeature } from './osmBuildingImports.ts';

type LonLat = [number, number];
type Tags = Record<string, string>;
interface GeoFeature {
  type: 'Feature';
  id?: string | number;
  properties: Record<string, unknown> | null;
  geometry: { type: string; coordinates: unknown } | null;
}
interface FeatureCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}
export interface RecoverySite {
  sourceId: string;
  kind: string;
  name: string;
  outline: Point2[];
  holes: Point2[][];
}
export interface RecoveryInputStats {
  features: number;
  acceptedElements: number;
  rejectedUnidentified: number;
  skippedComplexBuildingAreas: number;
  namedSites: number;
  /** Osmium normally emits both a line and an area for a closed tagged way. */
  duplicateLinearBuildingRepresentations: number;
}
export interface RecoveryInput {
  elements: SourceFeature[];
  sites: RecoverySite[];
  stats: RecoveryInputStats;
}
const SITE_TAGS: Record<string, Set<string>> = {
  amenity: new Set(['school', 'college', 'university', 'kindergarten',
    'hospital', 'townhall', 'place_of_worship', 'library']),
  leisure: new Set(['park', 'stadium']),
  historic: new Set(['monument', 'memorial']),
  tourism: new Set(['museum'])
};
function relevant(tags: Tags): boolean {
  return Boolean(tags.highway || (tags.building && tags.building !== 'no') ||
    Object.keys(SITE_TAGS).some(key => SITE_TAGS[key].has(tags[key])) ||
    tags.shop || tags.name);
}
function sourceTags(properties: GeoFeature['properties']): Tags {
  const tags: Tags = {};
  if (!properties) return tags;
  for (const [key, value] of Object.entries(properties)) {
    if (key.startsWith('@') || key === 'id' || key === 'type') continue;
    if (typeof value === 'string' && value.length <= 300) tags[key] = value;
  }
  return tags;
}
function position(value: unknown): LonLat | null {
  if (!Array.isArray(value) || value.length < 2 ||
      !Number.isFinite(value[0]) || !Number.isFinite(value[1]) ||
      Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) return null;
  return [value[0], value[1]];
}
function line(value: unknown): LonLat[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 15000) return null;
  const points = value.map(position);
  return points.every(p => p !== null) ? points as LonLat[] : null;
}
function latlon(coordinates: LonLat[]): Array<{ lat: number; lon: number }> {
  return coordinates.map(([lon, lat]) => ({ lat, lon }));
}
function closed(coordinates: LonLat[]): boolean {
  const a = coordinates[0], b = coordinates.at(-1)!;
  return coordinates.length >= 4 &&
    Math.abs(a[0] - b[0]) < 1e-8 && Math.abs(a[1] - b[1]) < 1e-8;
}
function siteKind(tags: Tags): string {
  for (const [key, values] of Object.entries(SITE_TAGS)) {
    if (values.has(tags[key])) return key + ':' + tags[key];
  }
  return '';
}
function areaInWorld(ring: LonLat[], anchor: GeoAnchor): Point2[] {
  const coords = closed(ring) ? ring.slice(0, -1) : ring;
  return coords.map(([lon, lat]) => {
    const point = geoToWorld({ latitude: lat, longitude: lon,
      elevationMeters: anchor.elevationMeters }, anchor);
    return { x: point.x, z: point.z };
  });
}
function intersectsRegion(points: Point2[]): boolean {
  const xs = points.map(p => p.x), zs = points.map(p => p.z);
  return Math.min(...xs) <= 500 && Math.max(...xs) >= -500 &&
    Math.min(...zs) <= 500 && Math.max(...zs) >= -500;
}
function nameOf(tags: Tags): string {
  return (tags['name:bg'] || tags.name || '').trim().slice(0, 90);
}
function parseOsmIdentity(feature: GeoFeature): { type: 'node' | 'way' | 'relation'; id: number } | null {
  const p = feature.properties ?? {};
  const type = p['@type'] ?? p.osm_type;
  const id = p['@id'] ?? p.osm_id;
  if (!['node', 'way', 'relation'].includes(String(type)) ||
      !Number.isSafeInteger(Number(id)) || Number(id) <= 0) return null;
  return { type: type as 'node' | 'way' | 'relation', id: Number(id) };
}
/**
 * Strict conversion of **osmium export -a type,id** GeoJSON to our existing
 * Overpass-compatible structures. No made-up OSM IDs or manufactured buildings.
 * Discontiguous multipolygons and holes cannot yet be made sealed colliders,
 * so they are reported and deliberately left out of the 3D building dataset.
 */
export function normalizeOsmiumGeoJSON(input: unknown, anchor: GeoAnchor): RecoveryInput {
  const raw = input as Partial<FeatureCollection> | null;
  if (!raw || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features) ||
      raw.features.length > 100000) {
    throw new Error('Expected a small, local osmium GeoJSON FeatureCollection (maximum 100,000 features)');
  }
  const elements: SourceFeature[] = [];
  const sites: RecoverySite[] = [];
  const stats: RecoveryInputStats = {
    features: raw.features.length, acceptedElements: 0,
    rejectedUnidentified: 0, skippedComplexBuildingAreas: 0, namedSites: 0,
    duplicateLinearBuildingRepresentations: 0
  };
  // Osmium defaults to area_tags=true AND linear_tags=true and exports
  // closed ways twice, including named school/civic polygons without a
  // building tag. Prefer every Polygon over the redundant LineString by
  // stable original OSM ID. Scan before processing: order is not guaranteed.
  const polygonAreaWayIds = new Set<string>();
  for (const feature of raw.features) {
    if (!feature || feature.type !== 'Feature' ||
        !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type ?? '')) continue;
    const identity = parseOsmIdentity(feature);
    if (identity?.type === 'way') {
      polygonAreaWayIds.add('way/' + identity.id);
    }
  }
  const known = new Set<string>();
  for (const feature of raw.features) {
    if (!feature || feature.type !== 'Feature' || !feature.geometry) continue;
    const tags = sourceTags(feature.properties);
    if (!relevant(tags)) continue;
    const identity = parseOsmIdentity(feature);
    if (!identity) { stats.rejectedUnidentified++; continue; }
    const { type, id } = identity;
    const sourceId = type + '/' + id;
    const { geometry } = feature;
    const add = (element: SourceFeature): void => {
      const key = sourceId + ':' + geometry.type;
      if (known.has(key)) return;
      known.add(key);
      elements.push(element);
    };
    if (geometry.type === 'Point' && type === 'node') {
      const p = position(geometry.coordinates);
      if (p) add({ type, id, lat: p[1], lon: p[0], tags });
      continue;
    }
    if (geometry.type === 'LineString' && type === 'way') {
      const coords = line(geometry.coordinates);
      if (coords) {
        // A closed way is BOTH an area and a line in default osmium output.
        // The polygon owns building geometry AND polygon POI label position.
        // Keep the linear counterpart only if it also carries an actual
        // highway: otherwise it duplicates the same OSM feature and risks
        // generating an incorrect POI label from the outline's first edge.
        if (polygonAreaWayIds.has(sourceId)) {
          if (tags.building && tags.building !== 'no') {
            stats.duplicateLinearBuildingRepresentations++;
          }
          if (!tags.highway) continue;
          const linearTags: Tags = { highway: tags.highway };
          for (const nameTag of ['name', 'name:bg', 'name:en']) {
            if (tags[nameTag]) linearTags[nameTag] = tags[nameTag];
          }
          add({ type, id, tags: linearTags, geometry: latlon(coords) });
        } else {
          add({ type, id, tags, geometry: latlon(coords) });
        }
      }
      continue;
    }
    if (!['Polygon', 'MultiPolygon'].includes(geometry.type) ||
        !['way', 'relation'].includes(type)) continue;
    const polygons = geometry.type === 'Polygon'
      ? [geometry.coordinates] : geometry.coordinates;
    if (!Array.isArray(polygons)) continue;
    const validPolygons: LonLat[][][] = [];
    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || !polygon.length) continue;
      const rings = polygon.map(line);
      if (rings.some(r => r === null || !closed(r!))) continue;
      validPolygons.push(rings as LonLat[][]);
    }
    const category = siteKind(tags);
    if (category && nameOf(tags)) {
      for (const polygon of validPolygons) {
        const outline = areaInWorld(polygon[0], anchor);
        if (!intersectsRegion(outline)) continue;
        sites.push({
          sourceId, kind: category, name: nameOf(tags), outline,
          holes: polygon.slice(1).map(ring => areaInWorld(ring, anchor))
        });
      }
    }
    if (tags.building && tags.building !== 'no') {
      if (validPolygons.length !== 1 || validPolygons[0].length !== 1) {
        stats.skippedComplexBuildingAreas++;
        continue;
      }
      const geography = latlon(validPolygons[0][0]);
      add({
        type, id,
        tags: type === 'relation' ? { ...tags, type: 'multipolygon' } : tags,
        geometry: geography
      });
    } else if (validPolygons.length === 1 && validPolygons[0].length === 1 &&
      type === 'way') {
      // Named sites without buildings still supply navigation landmarks.
      add({ type, id, tags, geometry: latlon(validPolygons[0][0]) });
    }
  }
  stats.acceptedElements = elements.length;
  stats.namedSites = sites.length;
  if (stats.rejectedUnidentified > 0) {
    throw new Error(stats.rejectedUnidentified +
      ' relevant GeoJSON features lack genuine OSM @type/@id; export using osmium -a type,id');
  }
  return { elements, sites, stats };
}
