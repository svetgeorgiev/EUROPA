import polygonClipping from 'polygon-clipping';
import { geoToWorld, type GeoAnchor } from '../geo/coordinates.ts';
import type { BuildingFootprint, Point2 } from './osm.ts';

interface NodePosition { lat: number; lon: number }
interface Member {
  type: string;
  ref: number;
  role: string;
  geometry?: NodePosition[];
}
export interface SourceFeature {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: NodePosition[];
  members?: Member[];
}
const LIMIT = 500;
const RECT: [number, number][] = [[-LIMIT, -LIMIT], [LIMIT, -LIMIT],
  [LIMIT, LIMIT], [-LIMIT, LIMIT], [-LIMIT, -LIMIT]];

function validCoords(list: NodePosition[] | undefined, minPoints = 3): list is NodePosition[] {
  return Array.isArray(list) && list.length >= minPoints &&
    list.every(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
      Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);
}
function toLocal(points: NodePosition[], anchor: GeoAnchor): Point2[] {
  return points.map(p => {
    const world = geoToWorld(
      { latitude: p.lat, longitude: p.lon, elevationMeters: anchor.elevationMeters }, anchor);
    return { x: world.x, z: world.z };
  });
}
function area(poly: Point2[]): number {
  return Math.abs(poly.reduce((n, p, i) => {
    const q = poly[(i + 1) % poly.length];
    return n + p.x * q.z - q.x * p.z;
  }, 0) / 2);
}
function equal(a: NodePosition, b: NodePosition): boolean {
  return Math.abs(a.lat - b.lat) < 1e-8 && Math.abs(a.lon - b.lon) < 1e-8;
}
function closed(points: NodePosition[]): boolean {
  return points.length >= 4 && equal(points[0], points.at(-1)!);
}
function normalizeTags(tags: Record<string, string> | undefined): {
  buildingType?: string; roofShape?: string; roofMaterial?: string; roofHeightMeters?: number
} {
  const data: { buildingType?: string; roofShape?: string; roofMaterial?: string; roofHeightMeters?: number } = {};
  const type = tags?.building;
  if (type && type !== 'no' && type.length <= 35) data.buildingType = type;
  const roof = tags?.['roof:shape'];
  if (roof && ['flat', 'gabled', 'hipped'].includes(roof)) data.roofShape = roof;
  const material = tags?.['roof:material'];
  if (material && material.length <= 35) data.roofMaterial = material;
  const height = tags?.['roof:height']?.replace(',', '.').match(/^([0-9]+(?:\.[0-9]+)?)\s*(m)?$/i);
  if (height) data.roofHeightMeters = Math.min(4, Math.max(0.4, Number(height[1])));
  return data;
}
function heightOf(tags: Record<string, string> | undefined): number {
  const height = tags?.height?.replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(m)?$/i);
  const levels = tags?.['building:levels']?.replace(',', '.').match(/^(\d+(?:\.\d+)?)$/);
  const value = height ? Number(height[1]) : levels ? Number(levels[1]) * 3 :
    6 + (Number(tags?.building === 'apartments') * 6);
  return Number.isFinite(value) ? Math.max(2.5, Math.min(60, value)) : 6;
}
function clipToWorld(outline: Point2[]): Point2[] | null {
  const ring = outline.map(point => [point.x, point.z] as [number, number]);
  if (!ring.length) return null;
  const first = ring[0], last = ring.at(-1)!;
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-5) ring.push([...first]);
  try {
    const result = polygonClipping.intersection([ring], [RECT]);
    // Current collision/renderer format supports only one outer ring without
    // inner courtyards; never silently fill a hole or invent an extra building.
    const candidates = result.filter(poly => poly.length === 1)
      .map(poly => poly[0].slice(0, -1).map(([x, z]) => ({ x, z })))
      .filter(points => points.length >= 3 && points.length <= 300 &&
        area(points) >= 8 && area(points) <= 150000);
    candidates.sort((a, b) => area(b) - area(a));
    return candidates[0] ?? null;
  } catch {
    // A malformed self-intersecting source polygon must not crash the import.
    return null;
  }
}
function joinOuters(parts: NodePosition[][]): NodePosition[] | null {
  if (!parts.length || parts.length > 30) return null;
  const remaining = parts.map(p => [...p]);
  const path = remaining.shift()!;
  if (closed(path)) return remaining.length ? null : path;
  while (remaining.length) {
    let didJoin = false;
    for (let i = 0; i < remaining.length; i++) {
      const next = remaining[i];
      if (equal(path.at(-1)!, next[0])) path.push(...next.slice(1));
      else if (equal(path.at(-1)!, next.at(-1)!)) path.push(...next.slice(0, -1).reverse());
      else if (equal(path[0], next.at(-1)!)) path.unshift(...next.slice(0, -1));
      else if (equal(path[0], next[0])) path.unshift(...next.slice(1).reverse());
      else continue;
      remaining.splice(i, 1);
      didJoin = true;
      break;
    }
    if (!didJoin) return null;
  }
  return closed(path) ? path : null;
}

export interface BuildingImportResult {
  buildings: BuildingFootprint[];
  clippedCount: number;
  relationCount: number;
  unsupportedRelations: number;
}
/**
 * Buildings must have actual OSM outlines. Never make a physical structure
 * from a tagged POI node. Building relations with holes are not supported by
 * the v1 sealed-footprint schema and are explicitly skipped.
 */
export function extractBuildings(
  elements: readonly SourceFeature[], anchor: GeoAnchor
): BuildingImportResult {
  const wayMap = new Map<number, SourceFeature>();
  const relationOuters = new Set<number>();
  const buildings: BuildingFootprint[] = [];
  let clippedCount = 0, relationCount = 0, unsupportedRelations = 0;
  for (const element of elements) {
    if (element.type === 'way' && Number.isSafeInteger(element.id)) wayMap.set(element.id, element);
  }

  const make = (sourceId: string, id: number, tags: Record<string, string> | undefined,
    geography: NodePosition[], isRelation = false): boolean => {
    if (!validCoords(geography) || !closed(geography)) return false;
    const world = toLocal(geography.slice(0, -1), anchor);
    const alreadyInside = world.every(p => Math.abs(p.x) <= LIMIT && Math.abs(p.z) <= LIMIT);
    const outline = clipToWorld(world);
    if (!outline) return false;
    if (!alreadyInside) clippedCount++;
    buildings.push({
      id, sourceId, heightMeters: heightOf(tags), outline,
      ...normalizeTags(tags)
    });
    if (isRelation) relationCount++;
    return true;
  };

  for (const item of elements) {
    if (item.type !== 'relation' || !item.tags?.building ||
        item.tags.building === 'no' || !Number.isSafeInteger(item.id) ||
        item.tags.type !== 'multipolygon') continue;
    const members = item.members ?? [];
    if (members.some(m => m.role === 'inner')) {
      unsupportedRelations++;
      continue;
    }
    const outers = members.filter(m => m.type === 'way' && m.role === 'outer');
    const rings = outers.map(m => m.geometry ?? wayMap.get(m.ref)?.geometry);
    if (!outers.length || rings.some(p => !p || !validCoords(p, 2))) {
      unsupportedRelations++;
      continue;
    }
    const combined = joinOuters(rings as NodePosition[][]);
    if (!combined || !make('relation/' + item.id, -item.id, item.tags, combined, true)) {
      unsupportedRelations++;
      continue;
    }
    for (const member of outers) relationOuters.add(member.ref);
  }
  for (const way of elements) {
    if (way.type !== 'way' || !Number.isSafeInteger(way.id) ||
        !way.tags?.building || way.tags.building === 'no' ||
        relationOuters.has(way.id) || !way.geometry) continue;
    make('way/' + way.id, way.id, way.tags, way.geometry);
  }
  return { buildings, clippedCount, relationCount, unsupportedRelations };
}
