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
  const countByGeometry: RecoveryAudit['countByGeometry'] = {
    'inside-imported-building': landmarks.filter(x => x.geometry === 'inside-imported-building').length,
    'near-imported-building': landmarks.filter(x => x.geometry === 'near-imported-building').length,
    unmatched: landmarks.filter(x => x.geometry === 'unmatched').length
  };
  return {
    buildingCount: map.buildings.length,
    roadsCount: map.roads.length,
    namedStreets: navigation.streets.length,
    namedLandmarks: navigation.landmarks.length,
    countByGeometry,
    landmarks
  };
}

export interface RecoveryComparison {
  source: string;
  before: RecoveryAudit;
  candidate: RecoveryAudit;
  newBuildingSources: string[];
  missingBuildingSources: string[];
  addedBuildingCount: number;
  addedCampusSites: number;
  reviewWarnings: string[];
  passedSafetyGate: boolean;
}
export function compareRecovery(
  oldMap: WorldMap, oldNavigation: NavigationData,
  candidateMap: WorldMap, candidateNavigation: NavigationData,
  sites: readonly RecoverySite[], source: string
): RecoveryComparison {
  const previous = new Set(oldMap.buildings.map(building =>
    building.sourceId ?? 'way/' + building.id));
  const next = new Set(candidateMap.buildings.map(building =>
    building.sourceId ?? 'way/' + building.id));
  const newBuildingSources = [...next].filter(id => !previous.has(id)).sort();
  const missingBuildingSources = [...previous].filter(id => !next.has(id)).sort();
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
  if (missingBuildingSources.length > 0) {
    reviewWarnings.push(missingBuildingSources.length +
      ' previously imported OSM building source IDs are no longer in candidate data.');
  }
  return {
    source, before, candidate, newBuildingSources,
    missingBuildingSources,
    addedBuildingCount: candidateMap.buildings.length - oldMap.buildings.length,
    addedCampusSites: sites.length,
    reviewWarnings,
    passedSafetyGate: candidateMap.buildings.length >= oldMap.buildings.length &&
      candidateMap.roads.length >= oldMap.roads.length * 0.9 &&
      candidateNavigation.streets.length >= oldNavigation.streets.length * 0.75 &&
      candidateNavigation.landmarks.length >= oldNavigation.landmarks.length * 0.75 &&
      missingBuildingSources.length === 0
  };
}
