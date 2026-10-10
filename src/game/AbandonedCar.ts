import {
  AbstractMesh, Mesh, MeshBuilder, Scene, SceneLoader, TransformNode, Vector3
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

/**
 * One local, manually placed prototype asset. No OSM data is modified.
 * The GLB is deliberately not stored in Git while its size/licence are reviewed.
 */
const CAR_URL = '/assets/vehicles/abandoned-car.glb';
const STATE_KEY = 'europa-002e-abandoned-car-searched-v1';
const TARGET_LENGTH_METRES = 4.4;
const INTERACTION_DISTANCE = 4;

export class AbandonedCar {
  private root: TransformNode | null = null;
  private collider: Mesh | null = null;
  private searched = false;
  private disposed = false;

  constructor(private readonly scene: Scene, private readonly notify: (message: string) => void) {
    try { this.searched = localStorage.getItem(STATE_KEY) === 'true'; }
    catch { /* Private browsing or blocked storage: session-only state. */ }
  }

  async load(x: number, z: number): Promise<void> {
    const root = new TransformNode('abandoned-car-root', this.scene);
    this.root = root;
    try {
      // Load into the game scene; Babylon loader is registered by the side-effect import.
      const result = await SceneLoader.ImportMeshAsync('', '/assets/vehicles/', 'abandoned-car.glb', this.scene);
      if (this.disposed) {
        result.meshes.forEach(mesh => mesh.dispose());
        root.dispose();
        return;
      }
      const meshes = result.meshes.filter((mesh): mesh is AbstractMesh => mesh instanceof AbstractMesh);
      const topLevel = meshes.filter(mesh => !mesh.parent || !meshes.includes(mesh.parent as AbstractMesh));
      topLevel.forEach(mesh => { mesh.parent = root; });
      root.computeWorldMatrix(true);
      meshes.forEach(mesh => mesh.computeWorldMatrix(true));
      const bounds = meshes.filter(mesh => mesh.getTotalVertices() > 0);
      if (!bounds.length) throw new Error('GLB has no renderable geometry');
      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const mesh of bounds) {
        const box = mesh.getBoundingInfo().boundingBox;
        min.minimizeInPlace(box.minimumWorld);
        max.maximizeInPlace(box.maximumWorld);
        mesh.isPickable = false;
        mesh.checkCollisions = false;
      }
      const dimensions = max.subtract(min);
      const longest = Math.max(dimensions.x, dimensions.z);
      if (!(longest > 0.001) || !Number.isFinite(longest)) throw new Error('Invalid GLB dimensions');
      const scale = TARGET_LENGTH_METRES / longest;
      // Move geometry so ground-contact is y=0; GLB orientation should be checked in game.
      root.scaling.setAll(scale);
      root.position.set(
        x - ((min.x + max.x) / 2) * scale,
        -min.y * scale,
        z - ((min.z + max.z) / 2) * scale
      );
      // Simple box collider, rather than 3D mesh-by-mesh physics.
      this.collider = MeshBuilder.CreateBox('abandoned-car-collision', {
        width: Math.max(1.5, dimensions.x * scale),
        height: Math.max(1.2, dimensions.y * scale),
        depth: Math.max(1.5, dimensions.z * scale)
      }, this.scene);
      this.collider.position.set(x, Math.max(1.2, dimensions.y * scale) / 2, z);
      this.collider.isVisible = false;
      this.collider.isPickable = false;
      this.collider.checkCollisions = true;
      this.notify('Abandoned vehicle loaded · E to search when nearby');
    } catch (error) {
      root.dispose(false, true);
      this.root = null;
      this.notify('Vehicle unavailable: verify ' + CAR_URL + ' (' +
        (error instanceof Error ? error.message : String(error)) + ')');
    }
  }

  interactionLabel(player: Vector3, yaw: number): string {
    if (!this.collider || this.disposed) return '';
    const delta = this.collider.position.subtract(player);
    delta.y = 0;
    const distance = delta.length();
    if (distance > INTERACTION_DISTANCE || distance < 0.001) return '';
    const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    if (Vector3.Dot(forward, delta.normalize()) < 0.15) return '';
    return this.searched ? 'Vehicle already searched' : 'E — Search abandoned car';
  }

  interact(player: Vector3, yaw: number): boolean {
    const label = this.interactionLabel(player, yaw);
    if (!label || this.searched) return false;
    this.searched = true;
    try { localStorage.setItem(STATE_KEY, 'true'); } catch { /* Session-only fallback */ }
    this.notify('Vehicle searched: found 1 bottled water and a bandage (inventory coming later)');
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.collider?.dispose();
    this.collider = null;
    this.root?.dispose(false, true);
    this.root = null;
  }
}
