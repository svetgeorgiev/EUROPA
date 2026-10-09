/**
 * Local tangent-plane approximation for small geographic regions (e.g. one town).
 * X points east, Z points north, and Y is elevation relative to the anchor.
 * Coordinates and heights are in metres, angles are in WGS84 degrees.
 *
 * Do not use a single anchor for all of Europe: switch anchors / use a
 * suitable projection and floating origin when streaming distant regions.
 */
export interface GeoAnchor {
  latitude: number;
  longitude: number;
  elevationMeters: number;
}

export interface GeoPosition {
  latitude: number;
  longitude: number;
  elevationMeters: number;
}

export interface WorldPosition { x: number; y: number; z: number; }

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const WGS84_A = 6378137;
const WGS84_E2 = 6.69437999014e-3;

function assertGeographic(latitude: number, longitude: number): void {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new RangeError('Invalid WGS84 latitude/longitude');
  }
}

function assertAnchor(anchor: GeoAnchor): void {
  assertGeographic(anchor.latitude, anchor.longitude);
  if (!Number.isFinite(anchor.elevationMeters) || Math.abs(anchor.latitude) >= 89.9) {
    throw new RangeError('Invalid local world anchor (pole or elevation)');
  }
}

function localScales(latitudeDegrees: number): { northMetresPerRadian: number; eastMetresPerRadian: number } {
  const lat = latitudeDegrees * DEG_TO_RAD;
  const sin = Math.sin(lat);
  const factor = 1 - WGS84_E2 * sin * sin;
  return {
    northMetresPerRadian: WGS84_A * (1 - WGS84_E2) / Math.pow(factor, 1.5),
    eastMetresPerRadian: WGS84_A * Math.cos(lat) / Math.sqrt(factor),
  };
}

export function geoToWorld(point: GeoPosition, anchor: GeoAnchor): WorldPosition {
  assertAnchor(anchor);
  assertGeographic(point.latitude, point.longitude);
  if (!Number.isFinite(point.elevationMeters)) throw new RangeError('Invalid elevation');
  const scales = localScales(anchor.latitude);
  return {
    x: (point.longitude - anchor.longitude) * DEG_TO_RAD * scales.eastMetresPerRadian,
    y: point.elevationMeters - anchor.elevationMeters,
    z: (point.latitude - anchor.latitude) * DEG_TO_RAD * scales.northMetresPerRadian,
  };
}

export function worldToGeo(position: WorldPosition, anchor: GeoAnchor): GeoPosition {
  assertAnchor(anchor);
  if (![position.x, position.y, position.z].every(Number.isFinite)) {
    throw new RangeError('Invalid world position');
  }
  const scales = localScales(anchor.latitude);
  const point = {
    latitude: anchor.latitude + (position.z / scales.northMetresPerRadian) * RAD_TO_DEG,
    longitude: anchor.longitude + (position.x / scales.eastMetresPerRadian) * RAD_TO_DEG,
    elevationMeters: anchor.elevationMeters + position.y,
  };
  assertGeographic(point.latitude, point.longitude);
  return point;
}
