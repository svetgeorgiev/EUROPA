import {
  mkdir, readFile, rename, rm, writeFile
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { buildWorldMap, isWorldMap } from '../src/world/osm.ts';
import { buildNavigationData, isNavigationData } from '../src/world/navigation.ts';
import { splitWorldMap } from '../src/world/chunkGrid.ts';
import { normalizeOsmiumGeoJSON } from '../src/world/recoveryInput.ts';
import { inspectBuildingFootprint } from '../src/world/osmBuildingImports.ts';
import { compareRecovery } from '../src/world/recoveryAudit.ts';
import { normalizeCoreMapJSON } from './osm-core-api.mjs';
import { NOVA_ZAGORA_ANCHOR } from '../src/geo/worldConfig.ts';

export const DEFAULT_WORLD = resolve('public/worlds/nova-zagora');
export const DEFAULT_REPORT = resolve('.europa-recovery/last-preview.json');

async function readJSON(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
function sourceInput(raw, anchor) {
  if (raw && raw.type === 'FeatureCollection') {
    const normalized = normalizeOsmiumGeoJSON(raw, anchor);
    return { data: { elements: normalized.elements }, navigationSource: {
      elements: normalized.elements
    }, sites: normalized.sites, stats: normalized.stats, format: 'osmium-geojson' };
  }
  if (raw && Array.isArray(raw.elements)) {
    const usesNodeReferences = raw.elements.some(item =>
      item.type === 'way' && Array.isArray(item.nodes) && !Array.isArray(item.geometry));
    const converted = usesNodeReferences ? normalizeCoreMapJSON(raw) : raw;
    const coreNodes = usesNodeReferences
      ? raw.elements.filter(item => item.type === 'node')
      : [];
    return {
      data: { elements: [...converted.elements, ...coreNodes], osm3s: raw.osm3s },
      navigationSource: raw,
      sites: [],
      stats: { features: raw.elements.length,
        acceptedElements: converted.elements.length, rejectedUnidentified: 0,
        skippedComplexBuildingAreas: 0, namedSites: 0 },
      format: usesNodeReferences ? 'osm-core-json' : 'overpass-geojson'
    };
  }
  throw new Error('Expected osmium GeoJSON FeatureCollection or raw OSM elements JSON; generated map.json is not an input');
}
function reasonableDate(date) {
  return typeof date === 'string' && /^\d{4}-\d\d-\d\dT/.test(date) &&
    Number.isFinite(Date.parse(date)) ? date : null;
}
function extractSourceDate(raw, specified) {
  if (specified && !reasonableDate(specified)) {
    throw new Error('--source-date must be an explicit ISO UTC date such as 2026-10-10T00:00:00Z');
  }
  return specified || reasonableDate(raw?.osm3s?.timestamp_osm_base) ||
    'unknown (offline OSM extract; check PBF timestamp)';
}
async function writeJSON(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}
async function pathExists(path) {
  try { await readFile(path); return true; }
  catch (error) {
    if (error.code === 'EISDIR') return true;
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
/**
 * Stages ALL three game data products before the first publish operation.
 * Restores the old outputs on any rename/write error in the commit phase.
 * Stop Vite before applying, and keep a filesystem backup for crash recovery.
 */
export async function publishRecoveredWorld(
  worldDir, map, navigation, sites,
  { failAfterSwap = -1, logger = console } = {}
) {
  const stage = worldDir + '.recovery-stage-' + process.pid;
  const backup = worldDir + '.recovery-backup-' + process.pid;
  const items = ['map.json', 'navigation.json', 'sites.json', 'chunks'];
  const { manifest, chunks } = splitWorldMap(map);
  if (chunks.length !== 16 || manifest.chunks.length !== 16) {
    throw new Error('Recovery requires exactly 16 valid 250m chunks');
  }
  await rm(stage, { recursive: true, force: true });
  if (await pathExists(backup)) {
    throw new Error('Recovery backup already exists; inspect it before applying another update: ' + backup);
  }
  const previous = [];
  const published = [];
  let publishedSuccessfully = false;
  try {
    await mkdir(join(stage, 'chunks'), { recursive: true });
    await writeJSON(join(stage, 'map.json'), map);
    await writeJSON(join(stage, 'navigation.json'), navigation);
    await writeJSON(join(stage, 'sites.json'), {
      schemaVersion: 1, source: 'OpenStreetMap',
      collectedAt: map.collectedAt, anchor: map.anchor, sites
    });
    for (const chunk of chunks) {
      await writeJSON(join(stage, 'chunks', chunk.id + '.json'), chunk);
    }
    await writeJSON(join(stage, 'chunks', 'manifest.json'), manifest);
    await mkdir(worldDir, { recursive: true });
    await mkdir(backup, { recursive: true });

    for (const [index, name] of items.entries()) {
      const target = join(worldDir, name);
      if (await pathExists(target)) {
        await rename(target, join(backup, name));
        previous.push(name);
      }
      await rename(join(stage, name), target);
      published.push(name);
      if (index === failAfterSwap) {
        throw new Error('Injected commit-stage failure for rollback test');
      }
    }
    publishedSuccessfully = true;
    logger.info('Installed verified world, navigation, sites and 16 streamed chunks.');
  } catch (error) {
    for (const name of [...published].reverse()) {
      await rm(join(worldDir, name), { recursive: true, force: true });
    }
    for (const name of [...previous].reverse()) {
      try {
        await rename(join(backup, name), join(worldDir, name));
      } catch (restoreError) {
        throw new AggregateError([error, restoreError],
          'RECOVERY ROLLBACK INCOMPLETE: old files remain in ' + backup);
      }
    }
    throw error;
  } finally {
    await rm(stage, { recursive: true, force: true });
    // A successful swap or rollback leaves an empty backup directory.
    // Keep any nonempty backup if restoration was interrupted.
    try {
      const { readdir } = await import('node:fs/promises');
      const contents = await readdir(backup);
      if (contents.length === 0) await rm(backup, { recursive: true, force: true });
      else logger.warn('Recovery backup retained for manual inspection: ' + backup);
    } catch (error) {
      if (error.code !== 'ENOENT') logger.warn('Could not inspect backup: ' + error);
    }
  }
}

/**
 * A source ID is not "lost" if the same actual source polygon intersects
 * the world only as a geometrically unusable, sub-8m² boundary fragment.
 * Discover evidence from THIS import; never infer it from nearest POIs or
 * accept manual IDs supplied by the CLI.
 */
function measureMissingBoundaryFragments(oldMap, newMap, elements, anchor) {
  const current = new Set(newMap.buildings.map(building =>
    building.sourceId ?? 'way/' + building.id));
  const candidates = new Map(elements
    .filter(element => element.tags?.building && element.tags.building !== 'no' &&
      Array.isArray(element.geometry))
    .map(element => [element.type + '/' + element.id, element]));
  const measured = [];
  for (const existing of oldMap.buildings) {
    const sourceId = existing.sourceId ?? 'way/' + existing.id;
    if (current.has(sourceId)) continue;
    const feature = candidates.get(sourceId);
    if (!feature) continue;
    const diagnosis = inspectBuildingFootprint(feature.geometry, anchor);
    if (diagnosis.status !== 'boundary-sliver' ||
        diagnosis.sourceAreaMeters2 === null ||
        diagnosis.importedAreaMeters2 === null || !diagnosis.bounds) continue;
    measured.push({
      sourceId,
      sourceAreaMeters2: diagnosis.sourceAreaMeters2,
      inWorldAreaMeters2: diagnosis.importedAreaMeters2,
      bounds: diagnosis.bounds
    });
  }
  return measured;
}

export async function previewBuildingRecovery({
  inputPath, worldDir = DEFAULT_WORLD, reportPath = DEFAULT_REPORT,
  sourceDate, apply = false, logger = console,
  failAfterSwap
}) {
  if (!inputPath || !resolve(inputPath)) throw new Error('--input path is required');
  const raw = await readJSON(resolve(inputPath));
  const oldMap = await readJSON(join(worldDir, 'map.json'));
  const oldNav = await readJSON(join(worldDir, 'navigation.json'));
  if (!isWorldMap(oldMap) || !isNavigationData(oldNav, oldMap.anchor)) {
    throw new Error('Existing map.json and navigation.json must be valid and use the same anchor');
  }
  const normalized = sourceInput(raw, NOVA_ZAGORA_ANCHOR);
  const collectedAt = extractSourceDate(raw, sourceDate);
  const map = buildWorldMap(normalized.data, NOVA_ZAGORA_ANCHOR, collectedAt);
  const nav = buildNavigationData(normalized.navigationSource, NOVA_ZAGORA_ANCHOR, collectedAt);
  if (!isWorldMap(map) || !isNavigationData(nav, map.anchor)) {
    throw new Error('Recovery candidate failed map/navigation validation');
  }

  const borderEvidence = measureMissingBoundaryFragments(oldMap, map,
    normalized.data.elements, NOVA_ZAGORA_ANCHOR);
  const comparison = compareRecovery(oldMap, oldNav, map, nav,
    normalized.sites, basename(inputPath), borderEvidence);
  const report = {
    schemaVersion: 1,
    sourceType: normalized.format,
    sourceFile: resolve(inputPath),
    sourceTimestamp: collectedAt,
    generatedAt: new Date().toISOString(),
    importStats: normalized.stats,
    ...comparison
  };
  await writeJSON(reportPath, report);
  logger.info('EUROPA building recovery PREVIEW (world data not modified yet).');
  logger.info('Building footprints: ' + report.before.buildingCount + ' → ' +
    report.candidate.buildingCount);
  logger.info('Unique OSM building source IDs: ' + report.before.uniqueBuildingCount +
    ' → ' + report.candidate.uniqueBuildingCount);
  logger.info('Duplicate 3D building IDs remaining: ' +
    report.candidate.duplicateBuildingSources.length);
  logger.info('Osmium duplicated line/area representations removed: ' +
    (report.importStats.duplicateLinearBuildingRepresentations ?? 0));
  logger.info('New actual OSM building IDs (' + report.newBuildingSources.length + '): ' +
    (report.newBuildingSources.join(', ') || 'none'));
  logger.info('Existing building IDs missing (' + report.missingBuildingSources.length + '): ' +
    (report.missingBuildingSources.join(', ') || 'none'));
  for (const fragment of report.boundaryFragmentExclusions) {
    logger.info('DOCUMENTED BOUNDARY EXCLUSION: ' + fragment.sourceId +
      ' — real building area ' + fragment.sourceAreaMeters2.toFixed(2) +
      'm²; inside playable world only ' + fragment.inWorldAreaMeters2.toFixed(2) +
      'm² (<8m² minimum). Physical mesh intentionally skipped.');
  }
  logger.info('Unexplained missing building IDs (' +
    report.unexplainedMissingBuildingSources.length + '): ' +
    (report.unexplainedMissingBuildingSources.join(', ') || 'none'));
  logger.info('Road segments: ' + report.before.roadsCount + ' → ' + report.candidate.roadsCount);
  logger.info('Named POIs: ' + report.before.namedLandmarks + ' → ' + report.candidate.namedLandmarks);
  logger.info('Landmarks inside building: ' + report.before.countByGeometry['inside-imported-building'] +
    ' → ' + report.candidate.countByGeometry['inside-imported-building']);
  logger.info('Unmatched landmarks: ' + report.before.countByGeometry.unmatched +
    ' → ' + report.candidate.countByGeometry.unmatched);
  logger.info('School/civic site polygons from extract: ' + normalized.sites.length);
  for (const poi of report.candidate.landmarks) {
    logger.info(poi.name + ': ' + poi.geometry +
      (poi.nearestBuildingSource ? ', nearest ' + poi.nearestBuildingSource +
        ' (' + poi.distanceMeters + 'm)' : '') +
      (poi.sites.length ? ', site polygons=' + poi.sites.length +
        ', buildings inside mapped site=' + poi.sites.reduce((total, site) =>
          total + site.campusBuildingIds.length, 0) : ''));
  }
  for (const warning of report.reviewWarnings) logger.warn('REVIEW: ' + warning);
  logger.info('Safety gate: ' + (report.passedSafetyGate ? 'PASS' : 'BLOCKED'));
  logger.info('Preview report: ' + resolve(reportPath));
  if (!apply) {
    logger.info('No files were changed. Review first; use --apply only after quality gates pass.');
    return report;
  }
  if (!report.passedSafetyGate) {
    throw new Error('Apply blocked: source reduces coverage, contains duplicate buildings, or has unexplained missing building IDs. Read the preview report; existing files untouched.');
  }
  await publishRecoveredWorld(worldDir, map, nav, normalized.sites,
    { logger, failAfterSwap });
  logger.info('All generated data are ODbL-licensed. © OpenStreetMap contributors');
  return report;
}
