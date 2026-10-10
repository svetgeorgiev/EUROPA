import {
  AbstractMesh, Color3, Mesh, MeshBuilder, Scene, SceneLoader,
  StandardMaterial, TransformNode, Vector3
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

/**
 * EUROPA-002E vehicle prototype.
 * Uses a visible low-poly stand-in until the local Sketchfab GLB has loaded.
 * Not part of the generated OSM geography, and never committed as an asset.
 */
const CAR_URL = '/assets/vehicles/abandoned-car.glb';
const STATE_KEY = 'europa-002e-abandoned-car-searched-v1';
const TARGET_LENGTH_METRES = 4.4;
const INTERACTION_DISTANCE = 4;

export class AbandonedCar {
  private root: TransformNode | null = null;
  private collider: Mesh | null = null;
  private standIn: Mesh[] = [];
  private standInMaterials: StandardMaterial[] = [];
  private searched = false;
  private disposed = false;
  private centre: { x: number; z: number } | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly notify: (message: string) => void,
    private readonly needsGun: () => boolean = () => false,
    private readonly needsAmmo: () => boolean = () => false
  ) {
    try { this.searched = localStorage.getItem(STATE_KEY) === 'true'; }
    catch { /* Private mode may prohibit storage. */ }
  }

  get location(): { x: number; z: number } | null {
    return this.centre ? { ...this.centre } : null;
  }

  private createStandIn(x: number, z: number): void {
    // An obvious car-shaped placeholder is useful while a 66 MB GLB is loading,
    // or when it is missing. It deliberately doesn't pretend to be the real asset.
    const paint = new StandardMaterial('vehicle-placeholder-orange', this.scene);
    paint.diffuseColor = Color3.FromHexString('#d87732');
    const glass = new StandardMaterial('vehicle-placeholder-windows', this.scene);
    glass.diffuseColor = Color3.FromHexString('#273941');
    const tires = new StandardMaterial('vehicle-placeholder-tires', this.scene);
    tires.diffuseColor = Color3.FromHexString('#151b1d');
    this.standInMaterials.push(paint, glass, tires);
    const body = MeshBuilder.CreateBox('vehicle-standin-body', {
      width: 2.05, height: 0.85, depth: 4.4
    }, this.scene);
    body.position.set(x, 0.77, z);
    body.material = paint;
    const roof = MeshBuilder.CreateBox('vehicle-standin-cabin', {
      width: 1.72, height: 0.76, depth: 2.25
    }, this.scene);
    roof.position.set(x, 1.48, z - 0.28);
    roof.material = glass;
    this.standIn.push(body, roof);
    for (const xOffset of [-1.03, 1.03]) {
      for (const zOffset of [-1.43, 1.43]) {
        const tire = MeshBuilder.CreateCylinder('vehicle-standin-wheel', {
          diameter: 0.66, height: 0.22, tessellation: 12
        }, this.scene);
        tire.rotation.z = Math.PI / 2;
        tire.position.set(x + xOffset, 0.42, z + zOffset);
        tire.material = tires;
        this.standIn.push(tire);
      }
    }
    this.standIn.forEach(mesh => {
      mesh.isPickable = false;
      mesh.checkCollisions = false;
    });
  }

  private clearStandIn(): void {
    for (const mesh of this.standIn) mesh.dispose();
    this.standIn = [];
    for (const material of this.standInMaterials) material.dispose();
    this.standInMaterials = [];
  }

  private createCollider(x: number, z: number, width: number, height: number, depth: number): void {
    this.collider?.dispose();
    this.collider = MeshBuilder.CreateBox('abandoned-car-collision', { width, height, depth }, this.scene);
    this.collider.position.set(x, height / 2, z);
    this.collider.isVisible = false;
    this.collider.isPickable = false;
    this.collider.checkCollisions = true;
  }

  async load(x: number, z: number): Promise<void> {
    if (this.disposed) return;
    this.centre = { x, z };
    this.createStandIn(x, z);
    this.createCollider(x, z, 2.25, 1.9, 4.55);
    this.notify('Vehicle at X ' + x.toFixed(0) + ', Z ' + z.toFixed(0) +
      ' · loading Sketchfab GLB (orange placeholder visible)');
    const root = new TransformNode('abandoned-car-root', this.scene);
    this.root = root;
    try {
      let lastProgress = -1;
      const result = await SceneLoader.ImportMeshAsync(
        '', '/assets/vehicles/', 'abandoned-car.glb', this.scene,
        event => {
          if (!event.lengthComputable || !event.total || this.disposed) return;
          const step = Math.min(4, Math.floor((event.loaded / event.total) * 4));
          if (step > lastProgress && step < 4) {
            lastProgress = step;
            this.notify('Vehicle GLB download: ' + step * 25 + '%');
          }
        }
      );
      if (this.disposed) {
        result.meshes.forEach(mesh => mesh.dispose(false, true));
        root.dispose();
        return;
      }

      // Keep the entire imported node hierarchy, including non-mesh glTF nodes.
      const nodes: TransformNode[] = [...result.transformNodes, ...result.meshes];
      const imported = new Set(nodes);
      nodes.filter(node => !node.parent || !imported.has(node.parent as TransformNode))
        .forEach(node => { node.parent = root; });
      root.computeWorldMatrix(true);

      const renderable = result.meshes.filter(
        (mesh): mesh is AbstractMesh => mesh instanceof AbstractMesh && mesh.getTotalVertices() > 0
      );
      if (!renderable.length) throw new Error('GLB contains no renderable meshes');

      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const mesh of renderable) {
        mesh.computeWorldMatrix(true);
        const box = mesh.getBoundingInfo().boundingBox;
        min.minimizeInPlace(box.minimumWorld);
        max.maximizeInPlace(box.maximumWorld);
        mesh.isPickable = false;
        mesh.checkCollisions = false;
      }
      const dimensions = max.subtract(min);
      const footprintLength = Math.max(dimensions.x, dimensions.z);
      if (!Number.isFinite(footprintLength) || footprintLength < 0.001) {
        throw new Error('Invalid GLB bounds');
      }
      const scale = TARGET_LENGTH_METRES / footprintLength;
      root.scaling.setAll(scale);
      root.position.set(
        x - (min.x + max.x) * 0.5 * scale,
        -min.y * scale,
        z - (min.z + max.z) * 0.5 * scale
      );
      root.computeWorldMatrix(true);
      this.createCollider(
        x, z,
        Math.max(1.5, dimensions.x * scale),
        Math.max(1.2, dimensions.y * scale),
        Math.max(1.5, dimensions.z * scale)
      );
      this.clearStandIn();
      this.notify('Sketchfab vehicle loaded at X ' + x.toFixed(0) + ', Z ' + z.toFixed(0) + ' · press V to visit');
    } catch (error) {
      root.dispose(false, true);
      this.root = null;
      // Keep the placeholder in the scene so location and E interaction still work.
      const detail = error instanceof Error ? error.message : String(error);
      this.notify('Sketchfab GLB failed (' + detail + '). Orange placeholder active; check ' + CAR_URL);
      console.error('EUROPA: abandoned car GLB failed', error);
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
    if (this.needsGun()) return this.searched ? 'E — Take gun from car' : 'E — Search car for a gun';
    if (this.needsAmmo()) return 'E — Restock practice ammo (24 rounds)';
    return this.searched ? 'Vehicle already searched' : 'E — Search abandoned car';
  }

  /** A previously searched car still allows the new weapon pickup exactly once. */
  interact(player: Vector3, yaw: number): 'gun' | 'supplies' | 'ammo' | null {
    if (!this.interactionLabel(player, yaw)) return null;
    if (this.needsGun()) {
      this.searched = true;
      try { localStorage.setItem(STATE_KEY, 'true'); } catch { /* Session fallback */ }
      this.notify('Found a firearm in the abandoned car');
      return 'gun';
    }
    if (this.needsAmmo()) {
      this.notify('You found 24 practice rounds in the car (prototype restock)');
      return 'ammo';
    }
    if (this.searched) return null;
    this.searched = true;
    try { localStorage.setItem(STATE_KEY, 'true'); } catch { /* Session fallback */ }
    this.notify('Vehicle searched: water and bandage (inventory not implemented yet)');
    return 'supplies';
  }

  dispose(): void {
    this.disposed = true;
    this.collider?.dispose();
    this.collider = null;
    this.root?.dispose(false, true);
    this.root = null;
    this.clearStandIn();
  }
}
