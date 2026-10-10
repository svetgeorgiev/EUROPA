import {
  AbstractMesh, AnimationGroup, Color3, Mesh, MeshBuilder, Scene, SceneLoader,
  StandardMaterial, TransformNode, Vector3
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

/**
 * Optional player avatar, visible for third-person inspection.
 *
 * Animation notes: a static GLB is not automatically a rigged character.
 * If the GLB contains relevant animation groups, play them.
 * Otherwise an animated primitive body remains available as a fallback.
 * The hand-held weapon proxy is approximate until skin_1.glb is inspected
 * and its rig / hand attachment is mapped.
 */
interface AvatarMotion {
  x: number;
  feetY: number;
  z: number;
  yaw: number;
  speed: number;
  sprinting: boolean;
  grounded: boolean;
  holdingGun: boolean;
  visible: boolean;
}
type AvatarClip = 'idle' | 'walk' | 'run' | 'jump' | 'armed';

export class CharacterAvatar {
  private readonly root: TransformNode;
  private readonly fallback: Mesh[] = [];
  private readonly limbs: { leftLeg: Mesh; rightLeg: Mesh; leftArm: Mesh; rightArm: Mesh };
  private readonly materials: StandardMaterial[] = [];
  private readonly gunProxy: Mesh[] = [];
  private gltfRoot: TransformNode | null = null;
  private animationGroups: AnimationGroup[] = [];
  private clipMap = new Map<AvatarClip, AnimationGroup>();
  private activeClip: AnimationGroup | null = null;
  private disposed = false;
  private visible = false;
  private wasVisible = false;
  private time = 0;
  private animStatus = 'procedural placeholder';

  constructor(private readonly scene: Scene, private readonly notify: (message: string) => void) {
    this.root = new TransformNode('player-visual-root', scene);
    const clothing = this.mat('player-jacket', '#445447');
    const trousers = this.mat('player-trousers', '#333e43');
    const skin = this.mat('player-skin', '#c1a28a');
    const weapon = this.mat('player-weapon-proxy', '#232c30');

    const box = (name: string, w: number, h: number, d: number,
      px: number, py: number, pz: number, mat: StandardMaterial): Mesh => {
      const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
      mesh.parent = this.root;
      mesh.position.set(px, py, pz);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      this.fallback.push(mesh);
      return mesh;
    };
    box('player-placeholder-torso', 0.46, 0.61, 0.24, 0, 1.12, 0, clothing);
    const head = MeshBuilder.CreateSphere('player-placeholder-head', {
      diameter: 0.27, segments: 10
    }, scene);
    head.parent = this.root;
    head.position.set(0, 1.61, 0);
    head.material = skin;
    head.isPickable = false;
    head.checkCollisions = false;
    this.fallback.push(head);
    const leftLeg = box('player-placeholder-left-leg', 0.18, 0.74, 0.19, -0.13, 0.42, 0, trousers);
    const rightLeg = box('player-placeholder-right-leg', 0.18, 0.74, 0.19, 0.13, 0.42, 0, trousers);
    const leftArm = box('player-placeholder-left-arm', 0.16, 0.60, 0.17, -0.34, 1.16, 0.03, clothing);
    const rightArm = box('player-placeholder-right-arm', 0.16, 0.60, 0.17, 0.34, 1.16, 0.03, clothing);
    this.limbs = { leftLeg, rightLeg, leftArm, rightArm };

    // This intentionally uses a lightweight proxy rather than loading a
    // second 3D weapon model when switching to third-person.
    const body = MeshBuilder.CreateBox('avatar-held-gun-proxy', {
      width: 0.12, height: 0.13, depth: 0.44
    }, scene);
    body.parent = this.root;
    body.position.set(0.26, 1.17, 0.32);
    body.material = weapon;
    body.isPickable = false;
    body.checkCollisions = false;
    this.gunProxy.push(body);
    this.root.setEnabled(false);
    void this.loadSkin();
  }

  private mat(name: string, hex: string): StandardMaterial {
    const result = new StandardMaterial(name, this.scene);
    result.diffuseColor = Color3.FromHexString(hex);
    result.specularColor = Color3.Black();
    this.materials.push(result);
    return result;
  }

  private chooseClip(name: AvatarClip): AnimationGroup | null {
    const patterns: Record<AvatarClip, RegExp> = {
      idle: /idle|breath|stand/i,
      walk: /walk|locomotion|stride/i,
      run: /run|sprint|jog/i,
      jump: /jump|fall|airborne/i,
      armed: /aim|rifle|weapon|hold|gun/i
    };
    return this.animationGroups.find(g => patterns[name].test(g.name)) ?? null;
  }

  private async loadSkin(): Promise<void> {
    const importRoot = new TransformNode('player-skin-glb-root', this.scene);
    try {
      const result = await SceneLoader.ImportMeshAsync(
        '', '/assets/skins/', 'skin_1.glb', this.scene
      );
      if (this.disposed) {
        result.meshes.forEach(mesh => mesh.dispose(false, true));
        importRoot.dispose();
        return;
      }
      const nodes: TransformNode[] = [...result.transformNodes, ...result.meshes];
      const imported = new Set(nodes);
      nodes.filter(node => !node.parent || !imported.has(node.parent as TransformNode))
        .forEach(node => { node.parent = importRoot; });
      importRoot.computeWorldMatrix(true);
      const renderables = result.meshes.filter(
        (mesh): mesh is AbstractMesh => mesh instanceof AbstractMesh && mesh.getTotalVertices() > 0
      );
      if (!renderables.length) throw new Error('skin_1.glb has no renderable meshes');
      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const mesh of renderables) {
        mesh.computeWorldMatrix(true);
        const box = mesh.getBoundingInfo().boundingBox;
        min.minimizeInPlace(box.minimumWorld);
        max.maximizeInPlace(box.maximumWorld);
        mesh.isPickable = false;
        mesh.checkCollisions = false;
      }
      const height = max.y - min.y;
      if (!Number.isFinite(height) || height <= 0.001) throw new Error('Character has invalid height');
      const scale = 1.75 / height;
      importRoot.scaling.setAll(scale);
      importRoot.position.set(
        -(min.x + max.x) * 0.5 * scale,
        -min.y * scale,
        -(min.z + max.z) * 0.5 * scale
      );
      importRoot.parent = this.root;
      this.gltfRoot = importRoot;
      this.animationGroups = result.animationGroups;
      for (const group of this.animationGroups) group.stop();
      for (const clip of ['idle', 'walk', 'run', 'jump', 'armed'] as const) {
        const group = this.chooseClip(clip);
        if (group) this.clipMap.set(clip, group);
      }
      this.animStatus = this.animationGroups.length > 0
        ? 'GLB with ' + this.animationGroups.length + ' animation clips'
        : 'GLB without animation clips (static skin)';
      this.fallback.forEach(mesh => mesh.setEnabled(false));
      this.notify('Character loaded: ' + this.animStatus + ' · C toggles camera');
      this.root.setEnabled(this.visible);
    } catch (error) {
      importRoot.dispose(false, true);
      if (!this.disposed) {
        this.notify('Character GLB not usable. Procedural avatar active; check /assets/skins/skin_1.glb');
        console.warn('EUROPA: skin_1.glb import failed', error);
      }
    }
  }

  private chooseActiveClip(m: AvatarMotion): AnimationGroup | null {
    if (!m.grounded) return this.clipMap.get('jump') ?? this.clipMap.get('idle') ?? null;
    if (m.speed > 0.5) {
      const desired = m.sprinting ? 'run' : 'walk';
      return this.clipMap.get(desired) ?? this.clipMap.get('walk') ?? this.clipMap.get('idle') ?? null;
    }
    return (m.holdingGun ? this.clipMap.get('armed') : null) ??
      this.clipMap.get('idle') ?? null;
  }

  update(dt: number, motion: AvatarMotion): void {
    if (this.disposed) return;
    this.visible = motion.visible;
    this.root.setEnabled(motion.visible);
    // Do not update bone/mesh animation unnecessarily when not rendering avatar.
    if (!motion.visible) {
      if (this.wasVisible) this.activeClip?.pause();
      this.wasVisible = false;
      return;
    }
    const resumed = !this.wasVisible;
    this.wasVisible = true;
    this.root.position.set(motion.x, motion.feetY, motion.z);
    this.root.rotation.y = motion.yaw;
    this.time += dt;

    if (this.gltfRoot) {
      const next = this.chooseActiveClip(motion);
      if (next !== this.activeClip) {
        this.activeClip?.stop();
        this.activeClip = next;
        if (next) next.start(true, motion.sprinting ? 1.25 : 1);
      } else if (resumed) {
        this.activeClip?.play(true);
      }
    }
    const motionAmount = Math.min(1, motion.speed / 5);
    const cycle = Math.sin(this.time * (motion.sprinting ? 13 : 8));
    const swing = cycle * motionAmount * 0.48;
    this.root.position.y += Math.abs(cycle) * motionAmount * 0.025;
    // Fallback articulated limbs, independent of the imported model.
    this.limbs.leftLeg.rotation.x = swing;
    this.limbs.rightLeg.rotation.x = -swing;
    this.limbs.leftArm.rotation.x = motion.holdingGun ? -0.9 : -swing * 0.7;
    this.limbs.rightArm.rotation.x = motion.holdingGun ? -0.9 : swing * 0.7;
    for (const mesh of this.gunProxy) mesh.setEnabled(motion.holdingGun);
  }

  dispose(): void {
    this.disposed = true;
    this.activeClip?.stop();
    for (const group of this.animationGroups) group.dispose();
    this.animationGroups = [];
    this.gltfRoot?.dispose(false, true);
    this.gltfRoot = null;
    this.root.dispose(false, true);
    for (const mat of this.materials) mat.dispose();
  }
}
