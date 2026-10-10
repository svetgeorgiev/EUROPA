import type { BuildingFootprint, Point2, WorldMap } from './osm.ts';
import type { Landmark, NavigationData } from './navigation.ts';

export type CoverageStatus = 'inside-footprint' | 'near-footprint' | 'no-nearby-footprint';
export interface LandmarkCoverage {
  landmark: Landmark;
  status: CoverageStatus;
  nearestBuildingId: number | null;
  nearestBuildingSource: string | null;
  distanceMeters: number | null;
}
function distToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq > 1e-12 ? Math.max(0, Math.min(1,
    ((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
export function pointInFootprint(p: Point2, outline: readonly Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i], b = outline[j];
    if ((a.z > p.z) !== (b.z > p.z)) {
      const intersect = (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x;
      if (p.x < intersect) inside = !inside;
    }
  }
  return inside;
}
export function footprintDistance(point: Point2, building: BuildingFootprint): number {
  const outline = building.outline;
  if (!Array.isArray(outline) || outline.length < 3) return Infinity;
  if (pointInFootprint(point, outline)) return 0;
  let minimum = Infinity;
  for (let i = 0; i < outline.length; i++) {
    minimum = Math.min(minimum, distToSegment(point, outline[i],
      outline[(i + 1) % outline.length]));
  }
  return minimum;
}
export function evaluateLandmarkCoverage(
  landmark: Landmark, buildings: readonly BuildingFootprint[], thresholdMeters = 12
): LandmarkCoverage {
  let best: BuildingFootprint | null = null;
  let nearest = Infinity;
  for (const building of buildings) {
    const distance = footprintDistance(landmark.point, building);
    if (distance < nearest) { nearest = distance; best = building; }
  }
  const status: CoverageStatus = nearest === 0 ? 'inside-footprint'
    : nearest <= thresholdMeters ? 'near-footprint' : 'no-nearby-footprint';
  return {
    landmark, status,
    nearestBuildingId: best?.id ?? null,
    nearestBuildingSource: best?.sourceId ?? (best ? 'way/' + best.id : null),
    distanceMeters: Number.isFinite(nearest) ? Math.round(nearest * 10) / 10 : null
  };
}
export function getCoverageReport(
  map: WorldMap, navigation: NavigationData, thresholdMeters = 12
): LandmarkCoverage[] {
  if (Math.abs(map.anchor.latitude - navigation.anchor.latitude) > 1e-7 ||
      Math.abs(map.anchor.longitude - navigation.anchor.longitude) > 1e-7) {
    throw new Error('Map and navigation have different geographic anchors');
  }
  return navigation.landmarks.map(point =>
    evaluateLandmarkCoverage(point, map.buildings, thresholdMeters));
}
