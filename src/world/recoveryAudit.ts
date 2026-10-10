import type { BuildingFootprint, Point2, WorldMap } from './osm.ts';
import type { Landmark, NavigationData } from './navigation.ts';
import { getCoverageReport, pointInFootprint } from './buildingCoverage.ts';
import type { RecoverySite } from './recoveryInput.ts';

export interface LandmarkSiteEvidence {
  siteId: string;
  siteName: string;
  kind: string;
  campusBuildingIds: string[];
  nameAgrees: boolean;
}
export interface LandmarkAudit {
  id: string;
  name: string;
  kind: string;
  x: number;
  z: number;
  geometry: 'inside-imported-building' | 'near-imported-building' | 'unmatched';
  nearestBuildingSource: string | null;
  distanceMeters: number | null;
  sites: LandmarkSiteEvidence[];
  /** A direct geometric/OSM-id match, never a guessed nearest building. */
  verifiedBuildingSource: string | null;
}
export interface RecoveryAudit {
  buildingCount: number;
  /** A single OSM building source must contribute exactly one footprint. */
  uniqueBuildingCount: number;
  duplicateBuildingSources: string[];
  roadsCount: number;
  namedStreets: number;
  namedLandmarks: number;
  countByGeometry: Record<LandmarkAudit['geometry'], number>;
  landmarks: LandmarkAudit[];
}
export function insideSite(point: Point2, site: RecoverySite): boolean {
  return pointInFootprint(point, site.outline) &&
    !site.holes.some(hole => pointInFootprint(point, hole));
}
function siteMatchesKind(landmark: Landmark, site: RecoverySite): boolean {
  return landmark.kind === site.kind;
}
function nameComparable(name: string): string {
  return name.toLocaleLowerCase('bg').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function buildingSourceId(building: BuildingFootprint): string {
  return building.sourceId ?? 'way/' + building.id;
}
function centre(building: BuildingFootprint): Point2 {
  const x = building.outline.reduce((sum, point) => sum + point.x, 0);
  const z = building.outline.reduce((sum, point) => sum + point.z, 0);
  return { x: x / building.outline.length, z: z / building.outline.length };
}
/**
 * A site polygon is NOT itself a building. Campus membership is geometric
 * evidence only: never change a building's name, physical shape or collider.
 */
export function auditLandmarks(
  map: WorldMap, navigation: NavigationData, sites: readonly RecoverySite[] = []
): RecoveryAudit {
  const coverage = getCoverageReport(map, navigation);
  const landmarks = coverage.map(row => {
    const relevantSites = sites
      .filter(site => siteMatchesKind(row.landmark, site) &&
        insideSite(row.landmark.point, site))
      .map(site => ({
        siteId: site.sourceId,
        siteName: site.name,
        kind: site.kind,
        campusBuildingIds: map.buildings.filter(building =>
          insideSite(centre(building), site)).map(building =>
            building.sourceId ?? 'way/' + building.id),
        nameAgrees: nameComparable(site.name) === nameComparable(row.landmark.name)
      }));
    const exact = map.buildings.find(building =>
      (building.sourceId ?? 'way/' + building.id) === row.landmark.id);
    const verifiedBuilding = exact ??
      (row.status === 'inside-footprint'
        ? map.buildings.find(building =>
          pointInFootprint(row.landmark.point, building.outline)) : null);
    const geometry: LandmarkAudit['geometry'] =
      row.status === 'inside-footprint' ? 'inside-imported-building' :
      row.status === 'near-footprint' ? 'near-imported-building' : 'unmatched';
    return {
      id: row.landmark.id, name: row.landmark.name, kind: row.landmark.kind,
      x: Math.round(row.landmark.point.x * 10) / 10,
      z: Math.round(row.landmark.point.z * 10) / 10,
      geometry,
      nearestBuildingSource: row.nearestBuildingSource,
      distanceMeters: row.distanceMeters,
      sites: relevantSites,
      verifiedBuildingSource: verifiedBuilding?.sourceId ??
        (verifiedBuilding ? 'way/' + verifiedBuilding.id : null)
    };
  });
  const sourceCounts = new Map<string, number>();
  for (const building of map.buildings) {
    const sourceId = buildingSourceId(building);
    sourceCounts.set(sourceId, (sourceCounts.get(sourceId) ?? 0) + 1);
  }
  const duplicateBuildingSources = [...sourceCounts].filter(([, count]) => count > 1)
    .map(([sourceId]) => sourceId).sort();
  const countByGeometry: RecoveryAudit['countByGeometry'] = {
    'inside-imported-building': landmarks.filter(x => x.geometry === 'inside-imported-building').length,
    'near-imported-building': landmarks.filter(x => x.geometry === 'near-imported-building').length,
    unmatched: landmarks.filter(x => x.geometry === 'unmatched').length
  };
  return {
    buildingCount: map.buildings.length,
    uniqueBuildingCount: sourceCounts.size,
    duplicateBuildingSources,
    roadsCount: map.roads.length,
    namedStreets: navigation.streets.length,
    namedLandmarks: navigation.landmarks.length,
    countByGeometry,
    landmarks
  };
}

/** Strictly measured from a real OSM building outline that overlaps the
 * playable square by less than the 8m² collider threshold. */
export interface BoundaryFragmentExclusion {
  sourceId: string;
  sourceAreaMeters2: number;
  inWorldAreaMeters2: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}
export interface RecoveryComparison {
  source: string;
  before: RecoveryAudit;
  candidate: RecoveryAudit;
  newBuildingSources: string[];
  missingBuildingSources: string[];
  boundaryFragmentExclusions: BoundaryFragmentExclusion[];
  unexplainedMissingBuildingSources: string[];
  addedBuildingCount: number;
  addedCampusSites: number;
  reviewWarnings: string[];
  passedSafetyGate: boolean;
}
// Previous 3D representations reaching within 5m of the real world edge
// may have been kept by an older import even if their clipped fragment is tiny.
const LIMIT_BORDER_METRES = 495;

export function compareRecovery(
  oldMap: WorldMap, oldNavigation: NavigationData,
  candidateMap: WorldMap, candidateNavigation: NavigationData,
  sites: readonly RecoverySite[], source: string,
  measuredBorderFragments: readonly BoundaryFragmentExclusion[] = []
): RecoveryComparison {
  const previous = new Set(oldMap.buildings.map(building =>
    building.sourceId ?? 'way/' + building.id));
  const next = new Set(candidateMap.buildings.map(building =>
    building.sourceId ?? 'way/' + building.id));
  const newBuildingSources = [...next].filter(id => !previous.has(id)).sort();
  const missingBuildingSources = [...previous].filter(id => !next.has(id)).sort();
  // Boundary exclusions are accepted ONLY when sourced from a positive,
  // sub-8m² simple clipping result AND the OLD footprint was itself
  // on the game boundary. A missing interior building remains a blocker.
  const boundaryFragmentExclusions: BoundaryFragmentExclusion[] = [];
  const unexplainedMissingBuildingSources: string[] = [];
  for (const id of missingBuildingSources) {
    const legacyFootprint = oldMap.buildings.find(b => buildingSourceId(b) === id);
    const fragment = measuredBorderFragments.find(item => item.sourceId === id);
    const oldAtBorder = legacyFootprint?.outline.some(p =>
      p.x <= -LIMIT_BORDER_METRES || p.x >= LIMIT_BORDER_METRES ||
      p.z <= -LIMIT_BORDER_METRES || p.z >= LIMIT_BORDER_METRES);
    const valid = fragment && oldAtBorder &&
      Number.isFinite(fragment.inWorldAreaMeters2) &&
      fragment.inWorldAreaMeters2 > 0.05 && fragment.inWorldAreaMeters2 < 8 &&
      Number.isFinite(fragment.sourceAreaMeters2) &&
      fragment.sourceAreaMeters2 >= 8 &&
      Object.values(fragment.bounds).every(Number.isFinite) &&
      (fragment.bounds.minX < -500 || fragment.bounds.maxX > 500 ||
       fragment.bounds.minZ < -500 || fragment.bounds.maxZ > 500);
    if (valid) boundaryFragmentExclusions.push(fragment);
    else unexplainedMissingBuildingSources.push(id);
  }
  const before = auditLandmarks(oldMap, oldNavigation);
  const candidate = auditLandmarks(candidateMap, candidateNavigation, sites);
  const reviewWarnings: string[] = [];
  if (candidateMap.buildings.length < oldMap.buildings.length) {
    reviewWarnings.push('Building count decreased: inspect source and geometry gaps.');
  }
  if (candidateMap.roads.length < oldMap.roads.length * 0.9) {
    reviewWarnings.push('Road geometry count dropped more than 10%; likely incomplete source.');
  }
  if (candidateNavigation.streets.length < oldNavigation.streets.length * 0.75) {
    reviewWarnings.push('Named street ways dropped more than 25%.');
  }
  if (candidateNavigation.landmarks.length < oldNavigation.landmarks.length * 0.75) {
    reviewWarnings.push('Named public landmarks dropped more than 25%.');
  }
  if (candidate.duplicateBuildingSources.length > 0) {
    reviewWarnings.push(candidate.duplicateBuildingSources.length +
      ' OSM building IDs generate multiple 3D footprints; apply blocked.');
  }
  if (boundaryFragmentExclusions.length) {
    reviewWarnings.push(boundaryFragmentExclusions.length +
      ' genuine OSM building footprints have only a sub-8m² boundary ' +
      'fragment inside the playable world; excluded from physical geometry ' +
      '(review before explicitly applying).');
  }
  if (unexplainedMissingBuildingSources.length) {
    reviewWarnings.push(unexplainedMissingBuildingSources.length +
      ' previously imported OSM building source IDs are absent without a ' +
      'verified boundary-fragment explanation; apply blocked.');
  }
  return {
    source, before, candidate, newBuildingSources,
    missingBuildingSources,
    boundaryFragmentExclusions,
    unexplainedMissingBuildingSources,
    addedBuildingCount: candidateMap.buildings.length - oldMap.buildings.length,
    addedCampusSites: sites.length,
    reviewWarnings,
    passedSafetyGate: candidate.duplicateBuildingSources.length === 0 &&
      candidateMap.buildings.length === candidate.uniqueBuildingCount &&
      candidateMap.buildings.length >= oldMap.buildings.length &&
      candidateMap.roads.length >= oldMap.roads.length * 0.9 &&
      candidateNavigation.streets.length >= oldNavigation.streets.length * 0.75 &&
      candidateNavigation.landmarks.length >= oldNavigation.landmarks.length * 0.75 &&
      unexplainedMissingBuildingSources.length === 0
  };
}
