import { worldToGeo } from '../src/geo/coordinates.ts';
import { NOVA_ZAGORA_ANCHOR } from '../src/geo/worldConfig.ts';

// Slightly buffered around the 1km-square gameplay world to keep complete
// OSM buildings and relation members across the map's outer edges.
const southWest = worldToGeo({x:-580,y:0,z:-580},NOVA_ZAGORA_ANCHOR);
const northEast = worldToGeo({x:580,y:0,z:580},NOVA_ZAGORA_ANCHOR);
const box = [
  southWest.longitude, southWest.latitude,
  northEast.longitude, northEast.latitude
].map(n=>n.toFixed(7)).join(',');
process.stdout.write(box + '\n');
