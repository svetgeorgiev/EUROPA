import type { GeoAnchor } from './coordinates';

/**
 * Temporary, configurable project reference near Nova Zagora.
 * Not a surveyed location or terrain elevation. Replace with verified
 * coordinates and a georeferenced height datum before importing terrain.
 */
export const NOVA_ZAGORA_ANCHOR: Readonly<GeoAnchor> = Object.freeze({
  latitude: 42.4930,
  longitude: 26.0110,
  elevationMeters: 0,
});
