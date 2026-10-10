import { Scene, Mesh, MeshBuilder, StandardMaterial, VertexData } from '@babylonjs/core';
import { buildBuildingGeometry } from './meshGeometry.ts';
import { buildRoofGeometry } from './roofGeometry.ts';
import { mergeRoadSurfaceSafely, type MapBounds } from './roadJunctions.ts';
import {
  createWorldMaterials, renderProceduralFacadeDetails, renderProceduralRoadDetails
} from './worldAppearance.ts';
import type { BuildingFootprint, Point2, RoadSegment, WorldMap } from './osm.ts';

export interface RenderedWorld { solids: Mesh[]; spawn: Point2; }

/** A road's visible geometry; flat, non-collidable ground below handles physics. */
export function makeRoadSurface(
  scene: Scene, name: string, roads: RoadSegment[], mat: StandardMaterial,
  tileBounds?: MapBounds
): Mesh | null {
  const data = mergeRoadSurfaceSafely(roads, tileBounds,
    warning => console.warn('EUROPA ' + name + ': ' + warning));
  if (!data.indices.length) return null;
  const mesh = new Mesh(name, scene);
  const vertices = new VertexData();
  vertices.positions = data.positions;
  vertices.indices = data.indices;
  vertices.normals = data.normals;
  vertices.uvs = data.uvs;
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
  // The sealed footprint collision system remains authoritative for buildings.
  mesh.checkCollisions = false;
  mesh.isPickable = false;
  return mesh;
}

/** Procedural roof is a render-only overlay above the legacy flat slab. */
export function makeRoof(
  scene: Scene, footprint: BuildingFootprint, material: StandardMaterial
): Mesh | null {
  const geometry = buildRoofGeometry(footprint);
  if (!geometry) return null;
  const mesh = new Mesh('roof-' + footprint.id, scene);
  const vertexData = new VertexData();
  vertexData.positions = geometry.positions;
  vertexData.normals = geometry.normals;
  vertexData.indices = geometry.indices;
  vertexData.uvs = geometry.uvs;
  vertexData.applyToMesh(mesh);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  return mesh;
}

const PEDESTRIAN = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'track']);

/** Static 002B fallback also receives the same procedural appearance as 002C. */
export function renderOSMWorld(scene: Scene, map: WorldMap): RenderedWorld {
  const materials = createWorldMaterials(scene, 'osm', map.halfSizeMeters * 2 + 30);
  const solids: Mesh[] = [];
  const ground = MeshBuilder.CreateGround('osm-flat-ground', {
    width: map.halfSizeMeters * 2 + 30,
    height: map.halfSizeMeters * 2 + 30
  }, scene);
  ground.material = materials.ground;
  ground.checkCollisions = true;
  solids.push(ground);

  makeRoadSurface(scene, 'osm-roads',
    map.roads.filter(road => !PEDESTRIAN.has(road.highway)), materials.road);
  makeRoadSurface(scene, 'osm-footpaths',
    map.roads.filter(road => PEDESTRIAN.has(road.highway)), materials.path);
  renderProceduralRoadDetails(scene, 'osm', map.roads, materials);

  for (const footprint of map.buildings) {
    const mesh = makeBuilding(scene, footprint,
      materials.walls[Math.abs(footprint.id) % materials.walls.length]);
    if (mesh) solids.push(mesh);
    makeRoof(scene, footprint,
      materials.roofs[Math.abs(footprint.id) % materials.roofs.length]);
  }
  renderProceduralFacadeDetails(scene, 'osm', map.buildings, materials);

  // Select a road midpoint nearest the anchor, with collision-safe final spawn
  // checked later by EuropaGame's BuildingCollisionField.
  let best = map.roads[0];
  let nearest = Number.POSITIVE_INFINITY;
  for (const segment of map.roads) {
    if (PEDESTRIAN.has(segment.highway)) continue;
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
    spawn: { x: (best.a.x + best.b.x) / 2, z: (best.a.z + best.b.z) / 2 }
  };
}
