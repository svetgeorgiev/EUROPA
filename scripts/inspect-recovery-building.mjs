import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NOVA_ZAGORA_ANCHOR } from '../src/geo/worldConfig.ts';
import { normalizeOsmiumGeoJSON } from '../src/world/recoveryInput.ts';
import { extractBuildings, inspectBuildingFootprint } from '../src/world/osmBuildingImports.ts';

/**
 * Trace an actual OSM way/relation through GeoJSON conversion, into the
 * exact same 1 km² clipped geometry importer as EUROPA's game renderer.
 * Read-only; no local map, navigation, chunk or repo data are mutated.
 */
export function inspectRecoveryBuilding(raw, sourceId, logger = console) {
  const match = /^(way|relation)\/(\d+)$/.exec(sourceId);
  if (!match || !Number.isSafeInteger(Number(match[2]))) {
    throw new Error('--id must be an OSM way/123 or relation/123 source ID');
  }
  const [ , type, rawId ] = match;
  const id = Number(rawId);
  if (!raw || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) {
    throw new Error('Inspection requires an osmium GeoJSON FeatureCollection');
  }
  const matched = raw.features.filter(feature =>
    feature?.properties?.['@type'] === type &&
    Number(feature.properties['@id']) === id);
  logger.info('EUROPA-002D.3 — read-only building trace for ' + sourceId);
  logger.info('Raw GeoJSON records: ' + matched.length);
  for (const feature of matched) {
    const shape = feature.geometry;
    if (!shape) {
      logger.info(' - Null geometry');
      continue;
    }
    const polygons = shape.type === 'Polygon'
      ? [shape.coordinates]
      : shape.type === 'MultiPolygon'
        ? shape.coordinates : [];
    const ringSizes = polygons.map(poly =>
      Array.isArray(poly) ? poly.map(ring =>
        Array.isArray(ring) ? ring.length : -1) : []);
    logger.info(' - ' + shape.type +
      (polygons.length ? ', polygons=' + polygons.length +
      ', ring vertex counts=' + JSON.stringify(ringSizes) : ''));
  }
  const normalized = normalizeOsmiumGeoJSON(raw, NOVA_ZAGORA_ANCHOR);
  const candidates = normalized.elements.filter(feature =>
    feature.type === type && feature.id === id &&
    feature.tags?.building && feature.tags.building !== 'no');
  logger.info('Recognised building elements after GeoJSON conversion: ' + candidates.length);
  const buildings = extractBuildings(normalized.elements, NOVA_ZAGORA_ANCHOR).buildings
    .filter(building => building.sourceId === sourceId);
  logger.info('Accepted physical building footprints in world: ' + buildings.length);
  for (const element of candidates) {
    const result = inspectBuildingFootprint(element.geometry, NOVA_ZAGORA_ANCHOR);
    logger.info(' - Clipping status: ' + result.status);
    logger.info(' - Original polygon area: ' +
      (result.sourceAreaMeters2 === null ? 'unknown' : result.sourceAreaMeters2.toFixed(2) + ' m²'));
    logger.info(' - Area inside world: ' +
      (result.importedAreaMeters2 === null ? 'unavailable' : result.importedAreaMeters2.toFixed(2) + ' m²'));
    if (result.bounds) {
      const b = result.bounds;
      logger.info(' - Bounds in game metres: ' +
        'X=' + b.minX.toFixed(1) + '…' + b.maxX.toFixed(1) +
        ', Z=' + b.minZ.toFixed(1) + '…' + b.maxZ.toFixed(1));
      logger.info(' - Gameplay bounds: X=-500…500, Z=-500…500');
    }
    if (result.status === 'clip-rejected') {
      logger.info(' - Geometry intersects the world bounding rectangle but ' +
        'could not produce an allowed simple clipped footprint. Current constraints: ' +
        'one valid outer ring, area >=8m², <=150000m², <=300 vertices.');
    } else if (result.status === 'outside-world') {
      logger.info(' - Building lies beyond the active 1 km² gameplay boundary; ' +
        'the larger PBF extraction area intentionally includes surrounding data.');
    }
  }
  if (!candidates.length && matched.length) {
    logger.info('No building element survived conversion: check ring closure, ' +
      'polygon complexity, OSM tags, or duplicate representation filtering.');
  }
  logger.info('No files modified. Do not bypass the recovery --apply safety gate.');
  return { sourceId, rawCount: matched.length,
    normalizedCount: candidates.length, importedCount: buildings.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const get = key => {
    const i = args.indexOf(key);
    return i < 0 ? undefined : args[i + 1];
  };
  const file = get('--input');
  const id = get('--id');
  if (!file || !id) {
    throw new Error('Usage: pnpm map:inspect --input path/to/area.geojson --id way/1016083252');
  }
  const raw = JSON.parse(await readFile(resolve(file), 'utf8'));
  inspectRecoveryBuilding(raw, id);
}
