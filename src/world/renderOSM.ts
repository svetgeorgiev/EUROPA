import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, VertexData } from '@babylonjs/core';
import { buildBuildingGeometry, buildRoadGeometry } from './meshGeometry.ts';
import type { BuildingFootprint, Point2, RoadSegment, WorldMap } from './osm.ts';

export interface RenderedWorld { solids: Mesh[]; spawn: Point2; }

/**
 * EUROPA-002C.2: daylight-readable prototype palette.
 * These are intentionally stylised materials, not surveyed facade textures.
 */
export const WORLD_COLORS = {
  grass: '#74876b',
  roads: '#798387',
  paths: '#afa58d',
  walls: ['#c7b9a3', '#c0aa96', '#adb8b2', '#d1bcad'],
} as const;

export function makeMaterial(
  scene: Scene,
  name: string,
  hex: string,
  emissiveStrength = 0.2
): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  const color = Color3.FromHexString(hex);
  mat.diffuseColor = color;
  mat.ambientColor = color.scale(0.65);
  // Low, controlled self-illumination stops north-facing walls and roads
  // going completely black without flattening their normal-based lighting.
  mat.emissiveColor = color.scale(emissiveStrength);
  mat.specularColor = new Color3(0.04, 0.04, 0.04);
  mat.specularPower = 24;
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;
  return mat;
}

export function makeRoadSurface(
  scene: Scene, name: string, roads: RoadSegment[], mat: StandardMaterial
): Mesh | null {
  const data = buildRoadGeometry(roads);
  if (!data.indices.length) return null;
  const mesh = new Mesh(name, scene);
  const vertices = new VertexData();
  vertices.positions = data.positions;
  vertices.indices = data.indices;
  vertices.normals = data.normals;
  vertices.applyToMesh(mesh);
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  return mesh;
}

export function makeBuilding(
  scene: Scene, building: BuildingFootprint, mat: StandardMaterial
): Mesh | null {
  const data = buildBuildingGeometry(building);
  if (!data) return null;
  const mesh = new Mesh('osm-building-' + building.id, scene);
  const vertices = new VertexData();
  vertices.positions = data.positions;
  vertices.indices = data.indices;
  vertices.normals = data.normals;
  vertices.colors = data.colors;
  vertices.applyToMesh(mesh);
  mesh.useVertexColors = true;
  mesh.material = mat;
  // Walls are render-only. Sealed footprint collision belongs to
  // BuildingCollisionField; don't re-enable Babylon visual-mesh collision.
  mesh.checkCollisions = false;
  mesh.isPickable = false;
  return mesh;
}

export function renderOSMWorld(scene: Scene, map: WorldMap): RenderedWorld {
  const solids: Mesh[] = [];
  const grass = makeMaterial(scene, 'osm-grass', WORLD_COLORS.grass, 0.12);
  const asphalt = makeMaterial(scene, 'osm-roads', WORLD_COLORS.roads, 0.35);
  const path = makeMaterial(scene, 'osm-paths', WORLD_COLORS.paths, 0.24);
  const walls = WORLD_COLORS.walls.map((hex, index) =>
    makeMaterial(scene, 'osm-walls-' + index, hex, 0.22)
  );

  const ground = MeshBuilder.CreateGround('osm-flat-ground', {
    width: map.halfSizeMeters * 2 + 30,
    height: map.halfSizeMeters * 2 + 30
  }, scene);
  ground.material = grass;
  ground.checkCollisions = true;
  solids.push(ground);

  const pedestrian = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'track']);
  makeRoadSurface(scene, 'osm-roads',
    map.roads.filter(road => !pedestrian.has(road.highway)), asphalt);
  makeRoadSurface(scene, 'osm-footpaths',
    map.roads.filter(road => pedestrian.has(road.highway)), path);

  for (const footprint of map.buildings) {
    const mesh = makeBuilding(scene, footprint, walls[Math.abs(footprint.id) % walls.length]);
    if (mesh) solids.push(mesh);
  }

  // A road nearest the geographic anchor is the starting position.
  // The game's independent footprint checks choose a safe spawn if necessary.
  let best = map.roads[0];
  let nearest = Number.POSITIVE_INFINITY;
  for (const segment of map.roads) {
    if (pedestrian.has(segment.highway)) continue;
    const x = (segment.a.x + segment.b.x) / 2;
    const z = (segment.a.z + segment.b.z) / 2;
    const dist = x * x + z * z;
    if (dist < nearest) {
      nearest = dist;
      best = segment;
    }
  }

  return {
    solids,
    spawn: {
      x: (best.a.x + best.b.x) / 2,
      z: (best.a.z + best.b.z) / 2,
    },
  };
}
