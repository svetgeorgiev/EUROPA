import { Mesh, MeshBuilder, Scene } from '@babylonjs/core';
import { makeBuilding, makeRoadSurface } from './renderOSM';
import {
  createWorldMaterials, renderProceduralFacadeDetails,
  renderProceduralRoadDetails, type WorldMaterials
} from './worldAppearance.ts';
import type { ChunkFile, ChunkManifest } from './chunkGrid';
import type { MapBounds } from './roadJunctions.ts';

export interface ChunkGeometry { meshes: Mesh[]; solids: Mesh[]; }
const PEDESTRIAN = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'track']);

/**
 * Shared procedural materials and textures for all active tiles. Tile meshes
 * are disposed during unload; textures/materials are released with the renderer.
 */
export class ChunkRenderer {
  private readonly scene: Scene;
  private readonly manifest: ChunkManifest;
  private readonly materials: WorldMaterials;

  constructor(scene: Scene, manifest: ChunkManifest) {
    this.scene = scene;
    this.manifest = manifest;
    this.materials = createWorldMaterials(scene, 'tile', manifest.tileSizeMeters);
  }

  render(chunk: ChunkFile): ChunkGeometry {
    const { tileSizeMeters: size, origin } = this.manifest;
    const bounds: MapBounds = {
      minX: origin.x + chunk.col * size,
      maxX: origin.x + (chunk.col + 1) * size,
      minZ: origin.z + chunk.row * size,
      maxZ: origin.z + (chunk.row + 1) * size
    };
    const ground = MeshBuilder.CreateGround(
      'chunk-ground-' + chunk.id, { width: size, height: size }, this.scene
    );
    ground.position.x = origin.x + (chunk.col + 0.5) * size;
    ground.position.z = origin.z + (chunk.row + 0.5) * size;
    ground.material = this.materials.ground;
    ground.checkCollisions = true;
    const meshes: Mesh[] = [ground];
    const solids: Mesh[] = [ground];

    const roads = makeRoadSurface(this.scene, 'chunk-roads-' + chunk.id,
      chunk.roads.filter(road => !PEDESTRIAN.has(road.highway)), this.materials.road, bounds);
    const paths = makeRoadSurface(this.scene, 'chunk-paths-' + chunk.id,
      chunk.roads.filter(road => PEDESTRIAN.has(road.highway)), this.materials.path, bounds);
    if (roads) meshes.push(roads);
    if (paths) meshes.push(paths);

    meshes.push(...renderProceduralRoadDetails(
      this.scene, 'chunk-' + chunk.id, chunk.roads, this.materials, bounds
    ));

    for (const footprint of chunk.buildings) {
      const building = makeBuilding(this.scene, footprint,
        this.materials.walls[Math.abs(footprint.id) % this.materials.walls.length]);
      if (!building) continue;
      meshes.push(building);
      solids.push(building);
    }

    const facades = renderProceduralFacadeDetails(
      this.scene, 'chunk-' + chunk.id, chunk.buildings, this.materials
    );
    if (facades) meshes.push(facades);
    return { meshes, solids };
  }

  /** Invisible collision walls mark the edge of this finite 1 km prototype. */
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
    this.materials.dispose();
  }
}
