import { Mesh, MeshBuilder, Scene, StandardMaterial } from '@babylonjs/core';
import { makeBuilding, makeMaterial, makeRoadSurface } from './renderOSM';
import type { ChunkFile, ChunkManifest } from './chunkGrid';

export interface ChunkGeometry { meshes: Mesh[]; solids: Mesh[]; }
const PEDESTRIAN = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'track']);

/**
 * Render one spatial tile. Meshes own their geometry; materials are shared
 * across all tiles and released only when the entire renderer is disposed.
 */
export class ChunkRenderer {
  private readonly scene: Scene;
  private readonly manifest: ChunkManifest;
  private readonly groundMat: StandardMaterial;
  private readonly roadMat: StandardMaterial;
  private readonly pathMat: StandardMaterial;
  private readonly wallMats: StandardMaterial[];
  private readonly materials: StandardMaterial[];

  constructor(scene: Scene, manifest: ChunkManifest) {
    this.scene = scene;
    this.manifest = manifest;
    this.groundMat = makeMaterial(scene, 'tile-grass', '#58735b');
    this.roadMat = makeMaterial(scene, 'tile-roads', '#343a40');
    this.pathMat = makeMaterial(scene, 'tile-paths', '#998f7b');
    this.wallMats = ['#9a968a', '#c1a68e', '#93867b', '#b1ada4'].map(
      (color, i) => makeMaterial(scene, 'tile-wall-' + i, color)
    );
    this.materials = [this.groundMat, this.roadMat, this.pathMat, ...this.wallMats];
  }

  render(chunk: ChunkFile): ChunkGeometry {
    const { tileSizeMeters: size, origin } = this.manifest;
    const ground = MeshBuilder.CreateGround('chunk-ground-' + chunk.id, { width: size, height: size }, this.scene);
    ground.position.x = origin.x + (chunk.col + 0.5) * size;
    ground.position.z = origin.z + (chunk.row + 0.5) * size;
    ground.material = this.groundMat;
    ground.checkCollisions = true;
    const meshes: Mesh[] = [ground];
    const solids: Mesh[] = [ground];
    const roads = makeRoadSurface(this.scene, 'chunk-roads-' + chunk.id,
      chunk.roads.filter(road => !PEDESTRIAN.has(road.highway)), this.roadMat);
    const paths = makeRoadSurface(this.scene, 'chunk-paths-' + chunk.id,
      chunk.roads.filter(road => PEDESTRIAN.has(road.highway)), this.pathMat);
    if (roads) meshes.push(roads);
    if (paths) meshes.push(paths);
    for (const footprint of chunk.buildings) {
      const building = makeBuilding(this.scene, footprint,
        this.wallMats[Math.abs(footprint.id) % this.wallMats.length]);
      if (!building) continue;
      meshes.push(building);
      solids.push(building);
    }
    return { meshes, solids };
  }

  /** Static invisible walls prevent walking off the finite 1km prototype. */
  createWorldBoundary(): Mesh[] {
    const half = this.manifest.halfSizeMeters;
    const wallLength = half * 2 + 2;
    const specs = [
      { x: -half, z: 0, width: 1, depth: wallLength },
      { x: half, z: 0, width: 1, depth: wallLength },
      { x: 0, z: -half, width: wallLength, depth: 1 },
      { x: 0, z: half, width: wallLength, depth: 1 }
    ];
    return specs.map((spec, i) => {
      const wall = MeshBuilder.CreateBox('world-edge-' + i, {
        width: spec.width, height: 10, depth: spec.depth
      }, this.scene);
      wall.position.set(spec.x, 5, spec.z);
      wall.isVisible = false;
      wall.isPickable = false;
      wall.checkCollisions = true;
      return wall;
    });
  }

  dispose(): void {
    for (const material of this.materials) material.dispose();
  }
}
