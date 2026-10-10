import {
  AbstractMesh, Color3, FreeCamera, Mesh, MeshBuilder, Scene, SceneLoader,
  StandardMaterial, TransformNode, Vector3
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import {
  EMPTY_WEAPON, fireWeapon, pickUpWeapon, reloadWeapon, validWeaponAmmo,
  type WeaponAmmo
} from './weaponState';

/**
 * Simple browser-game-only first-person weapon.
 * Uses a locally supplied Sketchfab GLB and falls back to a lightweight placeholder.
 * Hitscan impacts only: no NPC damage, physical projectiles or combat AI.
 */
const STORAGE_KEY = 'europa-002f-weapon-ammo-v1';
const SHOT_COOLDOWN_SECONDS = 0.22;
const MAX_RANGE_METRES = 130;

export class FirstPersonGun {
  private readonly pivot: TransformNode;
  private readonly placeholder: Mesh[] = [];
  private readonly placeholderMaterials: StandardMaterial[] = [];
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
    private readonly onWorldImpact?: (mesh: AbstractMesh, position: Vector3, direction: Vector3) => void
  ) {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (validWeaponAmmo(saved)) this.ammo = { ...saved };
    } catch { /* Storage may be unavailable in private mode. */ }

    this.pivot = new TransformNode('equipped-gun-pivot', scene);
    this.pivot.parent = camera;
    this.pivot.position.set(0.30, -0.30, 0.58);
    this.makePlaceholder();
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

  setLocomotion(speed: number, grounded: boolean): void {
    this.walkingSpeed = Math.min(8, Math.max(0, speed));
    this.walkingGrounded = grounded;
  }

  setViewModelVisible(visible: boolean): void {
    this.viewModelVisible = visible;
    this.pivot.setEnabled(this.ammo.owned && visible);
  }

  private save(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.ammo)); }
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
    this.notify('Loading firearm model /assets/guns/gun.glb ...');
    const assetRoot = new TransformNode('equipped-gun-gltf', this.scene);
    try {
      const result = await SceneLoader.ImportMeshAsync(
        '', '/assets/guns/', 'gun.glb', this.scene
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
      assetRoot.parent = this.pivot;
      this.modelRoot = assetRoot;
      this.placeholder.forEach(mesh => mesh.setEnabled(false));
      this.notify('Gun model loaded · left click to shoot · F to reload');
    } catch (error) {
      assetRoot.dispose(false, true);
      if (!this.disposed) {
        this.notify('Gun GLB unavailable; placeholder is usable. Check /assets/guns/gun.glb and Console.');
        console.error('EUROPA: gun GLB loading failed', error);
      }
    } finally {
      this.loading = false;
    }
  }

  pickUp(): void {
    if (this.disposed || this.ammo.owned) return;
    this.ammo = pickUpWeapon(this.ammo);
    this.save();
    this.pivot.setEnabled(this.viewModelVisible);
    this.notify('Firearm recovered from vehicle · left mouse button to fire · F to reload');
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
    this.cooldown = SHOT_COOLDOWN_SECONDS;
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
    const { next, added } = reloadWeapon(this.ammo);
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
    this.pivot.dispose(false, true);
    for (const material of this.placeholderMaterials) material.dispose();
  }
}
