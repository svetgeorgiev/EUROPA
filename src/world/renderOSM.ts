import {
  Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3, VertexData
} from '@babylonjs/core';
import earcut from 'earcut';
import type { BuildingFootprint, Point2, RoadSegment, WorldMap } from './osm';

export interface RenderedWorld { solids: Mesh[]; spawn: Point2; }

export function makeMaterial(scene: Scene, name: string, hex: string): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = Color3.FromHexString(hex);
  mat.specularColor = Color3.Black();
  mat.backFaceCulling = false;
  return mat;
}

export function makeRoadSurface(scene: Scene, name: string, roads: RoadSegment[], mat: StandardMaterial): Mesh | null {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const road of roads) {
    const dx = road.b.x - road.a.x;
    const dz = road.b.z - road.a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) continue;
    const halfWidth = road.widthMeters / 2;
    const nx = (-dz / len) * halfWidth;
    const nz = (dx / len) * halfWidth;
    const index = positions.length / 3;
    positions.push(
      road.a.x + nx, 0.035, road.a.z + nz,
      road.a.x - nx, 0.035, road.a.z - nz,
      road.b.x + nx, 0.035, road.b.z + nz,
      road.b.x - nx, 0.035, road.b.z - nz
    );
    indices.push(index, index + 2, index + 1, index + 1, index + 2, index + 3);
  }
  if (!indices.length) return null;
  const mesh = new Mesh(name, scene);
  const vertices = new VertexData();
  vertices.positions = positions;
  vertices.indices = indices;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  vertices.normals = normals;
  vertices.applyToMesh(mesh);
  mesh.material = mat;
  mesh.isPickable = false;
  return mesh;
}

export function makeBuilding(scene: Scene, building: BuildingFootprint, mat: StandardMaterial): Mesh | null {
  const poly = building.outline;
  if (poly.length < 3 || poly.length > 300) return null;
  const coords = poly.flatMap(p => [p.x, p.z]);
  const roofTriangles = earcut(coords);
  if (!roofTriangles.length) return null;
  const height = building.heightMeters;
  const positions: number[] = [];
  const indices: number[] = [];
  // Two vertices per footprint corner: ground, roof.
  for (const p of poly) positions.push(p.x, 0, p.z, p.x, height, p.z);
  for (let i = 0; i < poly.length; i++) {
    const next = (i + 1) % poly.length;
    const a = i * 2, b = next * 2;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  // Winding must face +Y for upward roof normals in Babylon's X/Z plane.
  for (let i = 0; i < roofTriangles.length; i += 3) {
    const ia = roofTriangles[i], ib = roofTriangles[i + 1], ic = roofTriangles[i + 2];
    const a = poly[ia], b = poly[ib], c = poly[ic];
    const yNormal = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    if (yNormal >= 0) indices.push(ia * 2 + 1, ib * 2 + 1, ic * 2 + 1);
    else indices.push(ia * 2 + 1, ic * 2 + 1, ib * 2 + 1);
  }
  const mesh = new Mesh('osm-building-' + building.id, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  vertexData.normals = normals;
  vertexData.applyToMesh(mesh);
  mesh.material = mat;
  mesh.checkCollisions = true;
  return mesh;
}

export function renderOSMWorld(scene: Scene, map: WorldMap): RenderedWorld {
  const solids: Mesh[] = [];
  const grass = makeMaterial(scene, 'osm-grass', '#58735b');
  const road = makeMaterial(scene, 'osm-roads', '#343a40');
  const path = makeMaterial(scene, 'osm-paths', '#998f7b');
  const walls = [
    makeMaterial(scene, 'osm-walls-a', '#9a968a'),
    makeMaterial(scene, 'osm-walls-b', '#c1a68e'),
    makeMaterial(scene, 'osm-walls-c', '#93867b'),
    makeMaterial(scene, 'osm-walls-d', '#b1ada4')
  ];
  const ground = MeshBuilder.CreateGround('osm-flat-ground', {
    width: map.halfSizeMeters * 2 + 30,
    height: map.halfSizeMeters * 2 + 30
  }, scene);
  ground.material = grass;
  ground.checkCollisions = true;
  solids.push(ground);

  const pedestrian = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'track']);
  makeRoadSurface(scene, 'osm-roads', map.roads.filter(x => !pedestrian.has(x.highway)), road);
  makeRoadSurface(scene, 'osm-footpaths', map.roads.filter(x => pedestrian.has(x.highway)), path);

  for (const footprint of map.buildings) {
    const mesh = makeBuilding(scene, footprint, walls[Math.abs(footprint.id) % walls.length]);
    if (mesh) solids.push(mesh);
  }

  // Pick a road near the geographic anchor rather than guessing an OSM spawn position.
  let best = map.roads[0];
  let nearest = Number.POSITIVE_INFINITY;
  for (const segment of map.roads) {
    if (pedestrian.has(segment.highway)) continue;
    const midX = (segment.a.x + segment.b.x) / 2;
    const midZ = (segment.a.z + segment.b.z) / 2;
    const distance = midX * midX + midZ * midZ;
    if (distance < nearest) {
      nearest = distance;
      best = segment;
    }
  }
  return {
    solids,
    spawn: {
      x: (best.a.x + best.b.x) / 2,
      z: (best.a.z + best.b.z) / 2,
    }
  };
}
