/**
 * Explicit, one-off OSM editing API fallback for bootstrapping a small
 * development region. This is NOT a map service for browsers or players.
 * OSM asks production/read-only consumers to use extracts or Overpass.
 * https://operations.osmfoundation.org/policies/api/
 */
import { worldToGeo } from '../src/geo/coordinates.ts';

const CORE_MAP_URL = 'https://api.openstreetmap.org/api/0.6/map.json';
const APP_URL = 'https://github.com/svetgeorgiev/EUROPA';

export const CORE_API_HEADERS = Object.freeze({
  accept: 'application/json',
  'user-agent': 'EUROPA-Prototype-Importer/0.1 (+https://github.com/svetgeorgiev/EUROPA; contact via GitHub issues)',
  referer: APP_URL
});

export function makeCoreMapUrl(anchor, halfSizeMeters = 500) {
  if (!(Number.isFinite(halfSizeMeters) && halfSizeMeters > 0 && halfSizeMeters <= 500)) {
    throw new RangeError('Core API fallback is limited to a single small area (max 1 km x 1 km)');
  }
  const sw = worldToGeo({ x: -halfSizeMeters, y: 0, z: -halfSizeMeters }, anchor);
  const ne = worldToGeo({ x: halfSizeMeters, y: 0, z: halfSizeMeters }, anchor);
  const area = (ne.longitude - sw.longitude) * (ne.latitude - sw.latitude);
  // Do not turn the one-time bootstrap option into a wide-area extraction tool.
  if (!Number.isFinite(area) || area > 0.002) {
    throw new RangeError('Core API bounding box exceeds EUROPA small-area policy');
  }
  const bbox = [sw.longitude, sw.latitude, ne.longitude, ne.latitude].map(n => n.toFixed(7)).join(',');
  const url = new URL(CORE_MAP_URL);
  url.searchParams.set('bbox', bbox);
  return url.toString();
}

/**
 * OSM /map.json ways refer to node IDs, unlike Overpass's "out geom".
 * Resolve node references and produce exactly the shape expected by
 * EUROPA's existing buildWorldMap, without introducing an XML parser.
 */
export function normalizeCoreMapJSON(data) {
  if (!data || !Array.isArray(data.elements)) {
    throw new Error('Invalid OpenStreetMap map.json: missing elements array');
  }
  const nodes = new Map();
  for (const element of data.elements) {
    if (element.type !== 'node' || !Number.isSafeInteger(element.id)) continue;
    if (!Number.isFinite(element.lat) || !Number.isFinite(element.lon)) continue;
    nodes.set(element.id, { lat: element.lat, lon: element.lon });
  }

  const elements = [];
  let missingNodeWays = 0;
  for (const element of data.elements) {
    if (element.type !== 'way' || !Number.isSafeInteger(element.id)) continue;
    if (!element.tags?.highway && !element.tags?.building) continue;
    if (!Array.isArray(element.nodes) || element.nodes.length < 2) continue;
    const geometry = element.nodes.map(id => nodes.get(id));
    if (geometry.some(point => !point)) {
      missingNodeWays++;
      continue; // Never connect unrelated nodes across missing geometry.
    }
    elements.push({
      type: 'way',
      id: element.id,
      tags: element.tags,
      geometry
    });
  }
  return {
    elements,
    osm3s: { timestamp_osm_base: new Date().toISOString() },
    missingNodeWays
  };
}

export async function requestCoreMap(anchor, {
  fetchImpl = fetch,
  timeoutMs = 90000,
  logger = console
} = {}) {
  const url = makeCoreMapUrl(anchor);
  logger.info('Requesting one small OpenStreetMap /map.json extract (1 km²).');
  logger.info('OSM core API is for one-time development bootstrap only; do not use as a bulk data source.');
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: CORE_API_HEADERS,
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    throw new Error('OSM map.json HTTP ' + response.status + (detail ? ': ' + detail : ''));
  }
  const size = Number(response.headers.get('content-length'));
  if (size > 25_000_000) throw new Error('OSM API response too large for EUROPA prototype');
  const raw = await response.json();
  const normalized = normalizeCoreMapJSON(raw);
  logger.info('Resolved ' + normalized.elements.length + ' OSM road/building ways.');
  if (normalized.missingNodeWays) {
    logger.warn('Skipped ' + normalized.missingNodeWays + ' incomplete ways missing node coordinates.');
  }
  return normalized;
}
