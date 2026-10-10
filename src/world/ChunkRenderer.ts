import { Mesh, MeshBuilder, Scene } from '@babylonjs/core';
import { makeBuilding, makeRoadSurface, makeRoof } from './renderOSM';
import {
  createWorldMaterials, renderProceduralFacadeDetails,
  renderProceduralRoadDetails, makeDetailMesh, type WorldMaterials
} from './worldAppearance.ts';
import type { ChunkFile, ChunkManifest } from './chunkGrid';
import type { MapBounds } from './roadJunctions.ts';
import { generateRoadsideTrees, buildTreeGeometry } from './Streetscape.ts';

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
    const meshes: Mesh[] = [];
    const solids: Mesh[] = [];

    const warn = (label: string, error: unknown): void => {
      console.warn('EUROPA tile ' + chunk.id + ': ' + label + ' was skipped: ', error);
    };

    try {
      // Ground and its collision are essential for every loaded chunk.
      const ground = MeshBuilder.CreateGround(
        'chunk-ground-' + chunk.id, { width: size, height: size }, this.scene
      );
      meshes.push(ground);
      ground.position.x = origin.x + (chunk.col + 0.5) * size;
      ground.position.z = origin.z + (chunk.row + 0.5) * size;
      ground.material = this.materials.ground;
      ground.checkCollisions = true;
      solids.push(ground);

      // OSM road surfaces are visual-only. A malformed complex intersection
      // falls back to basic road ribbons rather than losing the entire tile.
      try {
        const roads = makeRoadSurface(this.scene, 'chunk-roads-' + chunk.id,
          chunk.roads.filter(road => !PEDESTRIAN.has(road.highway)), this.materials.road, bounds);
        if (roads) meshes.push(roads);
      } catch (error) { warn('road surface', error); }

      try {
        const paths = makeRoadSurface(this.scene, 'chunk-paths-' + chunk.id,
          chunk.roads.filter(road => PEDESTRIAN.has(road.highway)), this.materials.path, bounds);
        if (paths) meshes.push(paths);
      } catch (error) { warn('footpaths', error); }

      try {
        meshes.push(...renderProceduralRoadDetails(
          this.scene, 'chunk-' + chunk.id, chunk.roads, this.materials, bounds
        ));
      } catch (error) { warn('road markings', error); }

      for (const footprint of chunk.buildings) {
        try {
          const building = makeBuilding(this.scene, footprint,
            this.materials.walls[Math.abs(footprint.id) % this.materials.walls.length]);
          if (!building) continue;
          meshes.push(building);
          // The ground alone handles vertical collision. Footprint collision
          // is registered separately by EuropaGame even if a facade fails.
          solids.push(building);
          try {
            const roof = makeRoof(this.scene, footprint,
              this.materials.roofs[Math.abs(footprint.id) % this.materials.roofs.length]);
            if (roof) meshes.push(roof);
          } catch (error) { warn('roof ' + footprint.id, error); }
        } catch (error) { warn('building ' + footprint.id, error); }
      }

      try {
        const facades = renderProceduralFacadeDetails(
          this.scene, 'chunk-' + chunk.id, chunk.buildings, this.materials
        );
        if (facades) meshes.push(facades);
      } catch (error) { warn('facade details', error); }

      // Procedural vegetation fills some visual emptiness along mapped streets.
      // Trees are not claimed to be actual OSM tree inventory and are not colliders.
      try {
        const placements = generateRoadsideTrees(
          chunk.roads, chunk.buildings, bounds
        );
        const trees = buildTreeGeometry(placements);
        const trunk = makeDetailMesh(
          this.scene, 'chunk-tree-trunks-' + chunk.id,
          trees.trunks, this.materials.treeBark
        );
        const crown = makeDetailMesh(
          this.scene, 'chunk-tree-foliage-' + chunk.id,
          trees.foliage, this.materials.treeFoliage
        );
        if (trunk) meshes.push(trunk);
        if (crown) meshes.push(crown);
      } catch (error) { warn('procedural roadside trees', error); }

      return { meshes, solids };
    } catch (error) {
      // If the essential ground mesh fails, roll back everything created in
      // this render attempt so a later manual retry cannot leak resources.
      for (const mesh of meshes) mesh.dispose();
      throw error;
    }
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
