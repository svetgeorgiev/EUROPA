import {
  AbstractMesh, Color3, FreeCamera, Mesh, MeshBuilder, Scene, SceneLoader,
  StandardMaterial, TransformNode, Vector3
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import {
  EMPTY_WEAPON, addReserveAmmunition, fireWeapon, pickUpWeapon, reloadWeapon, validWeaponAmmo,
  type WeaponAmmo
} from './weaponState';

/**
 * Simple browser-game-only first-person weapon.
 * Uses a locally supplied Sketchfab GLB and falls back to a lightweight placeholder.
 * Hitscan impacts only: no NPC damage, physical projectiles or combat AI.
 */
export type WeaponId = 'primary' | 'm249';
export interface WeaponConfig {
  id: WeaponId;
  name: string;
  assetFile: string;
  storageKey: string;
  magazineSize: number;
  reserveRounds: number;
  shotCooldown: number;
  automatic: boolean;
  restockAmount: number;
}
export const PRIMARY_WEAPON: Readonly<WeaponConfig> = Object.freeze({
  id: 'primary', name: 'SURVIVOR RIFLE', assetFile: 'gun.glb',
  storageKey: 'europa-002f-weapon-ammo-v1',
  magazineSize: 8, reserveRounds: 24, shotCooldown: 0.22,
  automatic: false, restockAmount: 24
});
export const M249_WEAPON: Readonly<WeaponConfig> = Object.freeze({
  id: 'm249', name: 'M249', assetFile: 'gun2.glb',
  storageKey: 'europa-002i-m249-weapon-v1',
  magazineSize: 60, reserveRounds: 120, shotCooldown: 0.09,
  automatic: true, restockAmount: 60
});
const MAX_RANGE_METRES = 130;

export class FirstPersonGun {
  private readonly pivot: TransformNode;
  private readonly placeholder: Mesh[] = [];
  private readonly placeholderMaterials: StandardMaterial[] = [];
  private readonly handMaterials: StandardMaterial[] = [];
  private readonly hands: Mesh[] = [];
  private modelAlignment: TransformNode | null = null;
  private modelYaw = 0;
  private gunFlipped = false;
  private modelPitch = 0;
  private triggerHeld = false;
  private readonly config: WeaponConfig;
  private readonly impactMaterial: StandardMaterial;
  private readonly impactMarkers: Array<{ mesh: Mesh; ttl: number }> = [];
  private modelRoot: TransformNode | null = null;
  private ammo: WeaponAmmo = { ...EMPTY_WEAPON };
  private loading = false;
  private disposed = false;
  private cooldown = 0;
  private recoil = 0;
  private viewModelVisible = true;
  private walkingSpeed = 0;
  private walkingGrounded = true;
  private bobTime = 0;

  constructor(
    private readonly scene: Scene,
    private readonly camera: FreeCamera,
    private readonly publish: (ammo: WeaponAmmo) => void,
    private readonly notify: (message: string) => void,
    private readonly onWorldImpact?: (mesh: AbstractMesh, position: Vector3, direction: Vector3) => void,
    config: WeaponConfig = PRIMARY_WEAPON
  ) {
    this.config = config;
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(this.config.storageKey) ?? 'null');
      if (validWeaponAmmo(saved, this.config.magazineSize)) this.ammo = { ...saved };
    } catch { /* Storage may be unavailable in private mode. */ }

    this.pivot = new TransformNode('equipped-gun-pivot', scene);
    this.pivot.parent = camera;
    this.pivot.position.set(0.30, -0.30, 0.58);
    this.makePlaceholder();
    this.makeHands();
    this.pivot.setEnabled(this.ammo.owned);
    this.impactMaterial = new StandardMaterial('gun-impact-glow', scene);
    this.impactMaterial.diffuseColor = Color3.FromHexString('#f8b66a');
    this.impactMaterial.emissiveColor = Color3.FromHexString('#a36e36');
    this.impactMaterial.specularColor = Color3.Black();
    this.publish(this.snapshot);
    if (this.ammo.owned) void this.loadModel();
  }

  get hasGun(): boolean { return this.ammo.owned; }
  get snapshot(): WeaponAmmo { return { ...this.ammo }; }
  get id(): WeaponId { return this.config.id; }
  get name(): string { return this.config.name; }
  get restockAmount(): number { return this.config.restockAmount; }
  get needsAmmo(): boolean { return this.hasGun && this.ammo.reserve < this.config.magazineSize; }
  setTriggerHeld(held: boolean): void { this.triggerHeld = held; }

  setLocomotion(speed: number, grounded: boolean): void {
    this.walkingSpeed = Math.min(8, Math.max(0, speed));
    this.walkingGrounded = grounded;
  }

  setViewModelVisible(visible: boolean): void {
    this.viewModelVisible = visible;
    this.pivot.setEnabled(this.ammo.owned && visible);
  }

  private save(): void {
    try { localStorage.setItem(this.config.storageKey, JSON.stringify(this.ammo)); }
    catch { /* This session remains playable without persistent storage. */ }
    this.publish(this.snapshot);
  }

  private makePlaceholder(): void {
    const metal = new StandardMaterial('gun-placeholder-metal', this.scene);
    metal.diffuseColor = Color3.FromHexString('#242e33');
    metal.specularColor = new Color3(0.24, 0.24, 0.24);
    const grip = new StandardMaterial('gun-placeholder-grip', this.scene);
    grip.diffuseColor = Color3.FromHexString('#4a3830');
    this.placeholderMaterials.push(metal, grip);

    const slide = MeshBuilder.CreateBox('gun-placeholder-slide', {
      width: 0.095, height: 0.082, depth: 0.31
    }, this.scene);
    slide.parent = this.pivot;
    slide.position.set(0, 0.025, 0);
    slide.material = metal;
    const handle = MeshBuilder.CreateBox('gun-placeholder-grip', {
      width: 0.087, height: 0.18, depth: 0.115
    }, this.scene);
    handle.parent = this.pivot;
    handle.position.set(0, -0.115, -0.09);
    handle.rotation.x = 0.2;
    handle.material = grip;
    this.placeholder.push(slide, handle);
    for (const mesh of this.placeholder) this.setupViewMesh(mesh);
  }

  /**
   * First-person visual arms are attached to the view gun as a prototype.
   * They are not character bones and do not yet implement true hand IK.
   */
  private makeHands(): void {
    const sleeve = new StandardMaterial('fps-sleeve-olive', this.scene);
    sleeve.diffuseColor = Color3.FromHexString('#53604f');
    const hand = new StandardMaterial('fps-hand-skin', this.scene);
    hand.diffuseColor = Color3.FromHexString('#b89a80');
    this.handMaterials.push(sleeve, hand);
    for (const side of [-1, 1]) {
      const forearm = MeshBuilder.CreateCylinder('fps-arm-' + side, {
        diameter: 0.17, height: 0.47, tessellation: 10
      }, this.scene);
      forearm.parent = this.pivot;
      forearm.rotation.x = -1.1;
      forearm.rotation.z = side * 0.25;
      forearm.position.set(side * 0.20, -0.35, side < 0 ? 0.10 : -0.12);
      forearm.material = sleeve;
      const palm = MeshBuilder.CreateSphere('fps-glove-' + side, {
        diameter: 0.135, segments: 9
      }, this.scene);
      palm.parent = this.pivot;
      palm.position.set(side * 0.15, -0.07, side < 0 ? 0.27 : 0.07);
      palm.material = hand;
      this.hands.push(forearm, palm);
      this.setupViewMesh(forearm);
      this.setupViewMesh(palm);
    }
  }

  /**
   * Most Sketchfab rifles use an X-facing long axis, whereas Babylon's
   * view direction is +Z. Re-orient the imported art, never the raycast.
   * G flips the barrel direction for models with the opposite muzzle axis.
   */
  toggleGunDirection(): void {
    if (!this.ammo.owned || !this.modelAlignment) return;
    this.gunFlipped = !this.gunFlipped;
    this.modelAlignment.rotation.y = this.modelYaw + (this.gunFlipped ? Math.PI : 0);
    this.notify(this.gunFlipped ? 'Weapon facing flipped · G to reverse' : 'Weapon facing restored');
  }

  restock(rounds = this.config.restockAmount): boolean {
    if (!this.ammo.owned || this.disposed) return false;
    const { next, added } = addReserveAmmunition(this.ammo, rounds, 480);
    if (added <= 0) return false;
    this.ammo = next;
    // When completely empty, automatically load the first magazine.
    if (this.ammo.loaded === 0) this.ammo = reloadWeapon(this.ammo, this.config.magazineSize).next;
    this.save();
    this.notify('Recovered ' + added + ' practice rounds · ' +
      this.ammo.loaded + ' loaded / ' + this.ammo.reserve + ' spare');
    return true;
  }

  private setupViewMesh(mesh: AbstractMesh): void {
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.applyFog = false;
    mesh.renderingGroupId = 2; // Draw the player's equipped item above world depth.
    mesh.alwaysSelectAsActiveMesh = true;
  }

  private async loadModel(): Promise<void> {
    if (this.loading || this.disposed || this.modelRoot) return;
    this.loading = true;
    this.notify('Loading ' + this.config.name + ' model /assets/guns/' + this.config.assetFile + ' ...');
    const assetRoot = new TransformNode('equipped-gun-gltf', this.scene);
    try {
      const result = await SceneLoader.ImportMeshAsync(
        '', '/assets/guns/', this.config.assetFile, this.scene
      );
      if (this.disposed) {
        result.meshes.forEach(mesh => mesh.dispose(false, true));
        assetRoot.dispose();
        return;
      }
      const nodes: TransformNode[] = [...result.transformNodes, ...result.meshes];
      const imported = new Set(nodes);
      nodes.filter(node => !node.parent || !imported.has(node.parent as TransformNode))
        .forEach(node => { node.parent = assetRoot; });
      const renderables = result.meshes.filter(
        (mesh): mesh is AbstractMesh => mesh instanceof AbstractMesh && mesh.getTotalVertices() > 0
      );
      if (!renderables.length) throw new Error('Gun GLB contains no visible geometry');
      assetRoot.computeWorldMatrix(true);
      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const mesh of renderables) {
        mesh.computeWorldMatrix(true);
        const bounds = mesh.getBoundingInfo().boundingBox;
        min.minimizeInPlace(bounds.minimumWorld);
        max.maximizeInPlace(bounds.maximumWorld);
        this.setupViewMesh(mesh);
      }
      const dim = max.subtract(min);
      const extent = Math.max(dim.x, dim.y, dim.z);
      if (!Number.isFinite(extent) || extent < 0.0001) throw new Error('Gun GLB bounds invalid');
      const scale = 0.38 / extent;
      assetRoot.scaling.setAll(scale);
      assetRoot.position.set(
        -0.5 * (min.x + max.x) * scale,
        -0.5 * (min.y + max.y) * scale,
        -0.5 * (min.z + max.z) * scale
      );
      const modelAlignment = new TransformNode('gun-orientation-pivot', this.scene);
      modelAlignment.parent = this.pivot;
      assetRoot.parent = modelAlignment;
      // The inspected M249 model has its longest axis along Y.
      // Orient its long axis toward +Z; G reverses the muzzle if needed.
      this.modelYaw = dim.x > dim.z && dim.x >= dim.y ? Math.PI / 2 : 0;
      this.modelPitch = dim.y > dim.x && dim.y > dim.z ? Math.PI / 2 : 0;
      modelAlignment.rotation.y = this.modelYaw + (this.gunFlipped ? Math.PI : 0);
      modelAlignment.rotation.x = this.modelPitch;
      this.modelAlignment = modelAlignment;
      this.modelRoot = modelAlignment;
      this.placeholder.forEach(mesh => mesh.setEnabled(false));
      this.notify(this.config.name + ' model loaded · left click to shoot · F to reload');
    } catch (error) {
      assetRoot.dispose(false, true);
      if (!this.disposed) {
        this.notify(this.config.assetFile + ' unavailable; placeholder is usable. Check /assets/guns/' + this.config.assetFile);
        console.error('EUROPA: gun GLB loading failed', error);
      }
    } finally {
      this.loading = false;
    }
  }

  pickUp(): void {
    if (this.disposed || this.ammo.owned) return;
    this.ammo = pickUpWeapon(this.ammo, this.config.magazineSize, this.config.reserveRounds);
    this.save();
    this.pivot.setEnabled(this.viewModelVisible);
    this.notify(this.config.name + ' recovered from car · left click to shoot · F to reload');
    void this.loadModel();
  }

  fire(): void {
    if (this.disposed || !this.ammo.owned) return;
    if (this.cooldown > 0) return;
    const { next, fired } = fireWeapon(this.ammo);
    if (!fired) {
      this.notify(this.ammo.reserve > 0 ? 'Magazine empty · press F to reload' : 'Out of ammunition');
      this.cooldown = 0.35;
      return;
    }
    this.ammo = next;
    this.save();
    this.cooldown = this.config.shotCooldown;
    this.recoil = 1;
    const direction = this.camera.getForwardRay(MAX_RANGE_METRES);
    const hit = this.scene.pickWithRay(
      direction,
      mesh => mesh.isPickable && mesh.isEnabled()
    );
    if (hit?.hit && hit.pickedPoint) {
      this.makeImpact(hit.pickedPoint);
      if (hit.pickedMesh) this.onWorldImpact?.(hit.pickedMesh, hit.pickedPoint, direction.direction.clone());
    }
    if (this.ammo.loaded === 0) {
      this.notify(this.ammo.reserve > 0 ? 'Magazine empty · press F to reload' : 'Out of ammunition');
    }
  }

  reload(): void {
    if (this.disposed || !this.ammo.owned) return;
    const { next, added } = reloadWeapon(this.ammo, this.config.magazineSize);
    if (!added) {
      this.notify(next.reserve === 0 ? 'No spare ammunition' : 'Magazine already full');
      return;
    }
    this.ammo = next;
    this.save();
    this.notify('Reloaded ' + added + ' rounds');
  }

  private makeImpact(position: Vector3): void {
    if (this.impactMarkers.length >= 16) {
      this.impactMarkers.shift()?.mesh.dispose();
    }
    const marker = MeshBuilder.CreateSphere('gun-test-impact', {
      diameter: 0.095, segments: 6
    }, this.scene);
    marker.position.copyFrom(position);
    marker.material = this.impactMaterial;
    marker.isPickable = false;
    marker.checkCollisions = false;
    this.impactMarkers.push({ mesh: marker, ttl: 2 });
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.config.automatic && this.triggerHeld && this.viewModelVisible && this.ammo.owned) this.fire();
    this.recoil = Math.max(0, this.recoil - dt * 6.5);
    const move = this.walkingGrounded ? Math.min(1, this.walkingSpeed / 5) : 0.2;
    this.bobTime += dt * (this.walkingSpeed > 5 ? 12 : 8);
    this.pivot.position.x = 0.30 + Math.sin(this.bobTime) * 0.012 * move;
    this.pivot.position.y = -0.30 + Math.cos(this.bobTime * 2) * 0.009 * move;
    this.pivot.position.z = 0.58 - 0.09 * this.recoil;
    this.pivot.rotation.x = -0.12 * this.recoil;
    for (let index = this.impactMarkers.length - 1; index >= 0; index--) {
      const impact = this.impactMarkers[index];
      impact.ttl -= dt;
      if (impact.ttl <= 0) {
        impact.mesh.dispose();
        this.impactMarkers.splice(index, 1);
      } else {
        impact.mesh.visibility = Math.min(1, impact.ttl);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const impact of this.impactMarkers) impact.mesh.dispose();
    this.impactMarkers.length = 0;
    this.impactMaterial.dispose();
    this.modelRoot?.dispose(false, true);
    this.modelRoot = null;
    this.modelAlignment = null;
    this.pivot.dispose(false, true);
    for (const material of this.placeholderMaterials) material.dispose();
    for (const material of this.handMaterials) material.dispose();
  }
}
