import {
  AbstractMesh, AnimationGroup, Color3, Mesh, MeshBuilder, Scene, SceneLoader,
  StandardMaterial, TransformNode, Vector3
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

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

/**
 * Browser-friendly visual avatar. Physics lives in EuropaGame's collider.
 *
 * IMPORTANT: An unrigged, unanimated GLB cannot be made to walk by adding
 * physics to its root transform. Use the jointed procedural stand-in until
 * a skeleton AND usable locomotion clips are provided.
 * P permits inspecting the uploaded static skin in the debug camera.
 */
export class CharacterAvatar {
  private readonly root: TransformNode;
  private readonly mannequin: TransformNode;
  private readonly mats: StandardMaterial[] = [];
  private readonly parts: Mesh[] = [];
  private readonly leftHip: TransformNode;
  private readonly rightHip: TransformNode;
  private readonly leftShoulder: TransformNode;
  private readonly rightShoulder: TransformNode;
  private readonly leftElbow: TransformNode;
  private readonly rightElbow: TransformNode;
  private readonly weaponProxy: Mesh;

  private gltfRoot: TransformNode | null = null;
  private animationGroups: AnimationGroup[] = [];
  private clipMap = new Map<AvatarClip, AnimationGroup>();
  private activeClip: AnimationGroup | null = null;
  private usableRig = false;
  private staticPreview = false;
  private disposed = false;
  private wasVisible = false;
  private clock = 0;

  constructor(private readonly scene: Scene, private readonly notify: (message: string) => void) {
    this.root = new TransformNode('avatar-root', scene);
    this.mannequin = new TransformNode('avatar-jointed-standin', scene);
    this.mannequin.parent = this.root;

    const jacket = this.mat('avatar-jacket', '#566654');
    const trousers = this.mat('avatar-trousers', '#333e43');
    const skin = this.mat('avatar-skin', '#c1a28a');
    const boots = this.mat('avatar-boots', '#342e2b');
    const gun = this.mat('avatar-weapon', '#253038');

    const createBox = (name: string, parent: TransformNode, size: Vector3,
      position: Vector3, material: StandardMaterial): Mesh => {
      const mesh = MeshBuilder.CreateBox(name, {
        width: size.x, height: size.y, depth: size.z
      }, scene);
      mesh.parent = parent;
      mesh.position.copyFrom(position);
      mesh.material = material;
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      this.parts.push(mesh);
      return mesh;
    };
    createBox('avatar-chest', this.mannequin, new Vector3(0.48, 0.57, 0.26),
      new Vector3(0, 1.15, 0), jacket);
    createBox('avatar-hips', this.mannequin, new Vector3(0.39, 0.20, 0.25),
      new Vector3(0, 0.80, 0), trousers);
    const head = MeshBuilder.CreateSphere('avatar-head', { diameter: 0.25, segments: 12 }, scene);
    head.parent = this.mannequin;
    head.position.set(0, 1.62, 0.025);
    head.material = skin;
    head.isPickable = false;
    head.checkCollisions = false;
    this.parts.push(head);

    const joint = (name: string, parent: TransformNode, x: number, y: number, z: number) => {
      const node = new TransformNode(name, scene);
      node.parent = parent;
      node.position.set(x, y, z);
      return node;
    };
    this.leftHip = joint('avatar-left-hip', this.mannequin, -0.14, 0.77, 0);
    this.rightHip = joint('avatar-right-hip', this.mannequin, 0.14, 0.77, 0);
    for (const [name, hip] of [['left', this.leftHip], ['right', this.rightHip]] as const) {
      createBox('avatar-' + name + '-leg', hip, new Vector3(0.18, 0.69, 0.19),
        new Vector3(0, -0.35, 0), trousers);
      createBox('avatar-' + name + '-boot', hip, new Vector3(0.20, 0.15, 0.27),
        new Vector3(0, -0.70, 0.055), boots);
    }
    this.leftShoulder = joint('avatar-left-shoulder', this.mannequin, -0.34, 1.39, 0);
    this.rightShoulder = joint('avatar-right-shoulder', this.mannequin, 0.34, 1.39, 0);
    this.leftElbow = joint('avatar-left-elbow', this.leftShoulder, 0, -0.27, 0);
    this.rightElbow = joint('avatar-right-elbow', this.rightShoulder, 0, -0.27, 0);
    for (const [name, shoulder, elbow] of [
      ['left', this.leftShoulder, this.leftElbow],
      ['right', this.rightShoulder, this.rightElbow]
    ] as const) {
      createBox('avatar-' + name + '-upper-arm', shoulder,
        new Vector3(0.16, 0.31, 0.17), new Vector3(0, -0.15, 0), jacket);
      createBox('avatar-' + name + '-forearm', elbow,
        new Vector3(0.14, 0.26, 0.15), new Vector3(0, -0.14, 0), jacket);
      createBox('avatar-' + name + '-hand', elbow,
        new Vector3(0.13, 0.12, 0.12), new Vector3(0, -0.29, 0), skin);
    }
    this.weaponProxy = createBox('avatar-held-weapon-standin', this.mannequin,
      new Vector3(0.12, 0.12, 0.48), new Vector3(0.21, 1.11, 0.49), gun);
    this.weaponProxy.setEnabled(false);

    this.root.setEnabled(false);
    void this.loadSkin();
  }

  private mat(name: string, color: string): StandardMaterial {
    const mat = new StandardMaterial(name, this.scene);
    mat.diffuseColor = Color3.FromHexString(color);
    mat.specularColor = Color3.Black();
    this.mats.push(mat);
    return mat;
  }

  private findClip(clip: AvatarClip): AnimationGroup | undefined {
    const patterns: Record<AvatarClip, RegExp> = {
      idle: /idle|breath|stand/i,
      walk: /walk|locomotion|stride/i,
      run: /run|sprint|jog/i,
      jump: /jump|fall|airborne/i,
      armed: /aim|rifle|weapon|hold|gun/i
    };
    return this.animationGroups.find(group => patterns[clip].test(group.name));
  }

  private async loadSkin(): Promise<void> {
    const root = new TransformNode('avatar-sketchfab-glb', this.scene);
    try {
      const imported = await SceneLoader.ImportMeshAsync('', '/assets/skins/', 'skin_1.glb', this.scene);
      if (this.disposed) {
        imported.meshes.forEach(mesh => mesh.dispose(false, true));
        root.dispose();
        return;
      }

      const allNodes: TransformNode[] = [...imported.transformNodes, ...imported.meshes];
      const known = new Set(allNodes);
      allNodes.filter(node => !node.parent || !known.has(node.parent as TransformNode))
        .forEach(node => { node.parent = root; });

      const renderables = imported.meshes.filter(
        (mesh): mesh is AbstractMesh => mesh instanceof AbstractMesh && mesh.getTotalVertices() > 0
      );
      if (!renderables.length) throw new Error('skin_1.glb contains no meshes');
      root.computeWorldMatrix(true);
      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const mesh of renderables) {
        mesh.computeWorldMatrix(true);
        const bounds = mesh.getBoundingInfo().boundingBox;
        min.minimizeInPlace(bounds.minimumWorld);
        max.maximizeInPlace(bounds.maximumWorld);
        mesh.isPickable = false;
        mesh.checkCollisions = false;
      }
      const height = max.y - min.y;
      if (!Number.isFinite(height) || height < 0.001) throw new Error('Character height is invalid');
      const scale = 1.75 / height;
      root.scaling.setAll(scale);
      root.position.set(
        -(min.x + max.x) * scale / 2,
        -min.y * scale,
        -(min.z + max.z) * scale / 2
      );
      root.parent = this.root;

      this.gltfRoot = root;
      this.animationGroups = imported.animationGroups;
      for (const group of this.animationGroups) group.stop();
      for (const clip of ['idle', 'walk', 'run', 'jump', 'armed'] as const) {
        const group = this.findClip(clip);
        if (group) this.clipMap.set(clip, group);
      }

      this.usableRig = imported.skeletons.length > 0 &&
        (this.clipMap.has('walk') || this.clipMap.has('run'));
      console.info('EUROPA character rig diagnostics', {
        skeletons: imported.skeletons.map(s => s.name),
        animations: imported.animationGroups.map(g => g.name),
        usableLocomotion: this.usableRig
      });

      this.syncPresentation();
      if (this.usableRig) {
        this.notify('Animated GLB ready: skeleton and walk/run clips detected');
      } else {
        this.notify('skin_1.glb loaded without playable walk/run rig. Animated mannequin active · P previews original skin');
      }
    } catch (error) {
      root.dispose(false, true);
      if (!this.disposed) {
        console.warn('EUROPA character GLB not usable:', error);
        this.notify('skin_1.glb could not load · animated mannequin remains active');
      }
    }
  }

  private syncPresentation(): void {
    const useGLB = !!this.gltfRoot && (this.usableRig || this.staticPreview);
    this.mannequin.setEnabled(!useGLB);
    this.gltfRoot?.setEnabled(useGLB);
  }

  toggleSkinPreview(): string {
    if (!this.gltfRoot) return 'Skin preview unavailable until skin_1.glb loads';
    if (this.usableRig) return 'Animated character is already active';
    this.staticPreview = !this.staticPreview;
    this.activeClip?.pause();
    this.syncPresentation();
    return this.staticPreview
      ? 'Original static skin (T-pose) · P returns to walking mannequin'
      : 'Walking mannequin restored · rig the original skin to animate it';
  }

  private chooseClip(motion: AvatarMotion): AnimationGroup | null {
    if (!motion.grounded) return this.clipMap.get('jump') ?? this.clipMap.get('idle') ?? null;
    if (motion.speed > 0.5) {
      if (motion.sprinting) return this.clipMap.get('run') ?? this.clipMap.get('walk') ?? null;
      return this.clipMap.get('walk') ?? this.clipMap.get('run') ?? null;
    }
    return (motion.holdingGun ? this.clipMap.get('armed') : null) ??
      this.clipMap.get('idle') ?? null;
  }

  update(dt: number, motion: AvatarMotion): void {
    if (this.disposed) return;
    this.root.setEnabled(motion.visible);
    if (!motion.visible) {
      if (this.wasVisible) this.activeClip?.pause();
      this.wasVisible = false;
      return;
    }
    const resumed = !this.wasVisible;
    this.wasVisible = true;
    this.root.position.set(motion.x, motion.feetY, motion.z);
    this.root.rotation.y = motion.yaw;
    this.clock += Math.max(0, Math.min(0.05, dt));
    this.syncPresentation();

    if (this.usableRig) {
      const next = this.chooseClip(motion);
      if (next !== this.activeClip) {
        this.activeClip?.stop();
        this.activeClip = next;
        if (next) next.start(true, motion.sprinting ? 1.3 : 1);
      } else if (resumed) {
        this.activeClip?.play(true);
      }
    }

    // Animated joint transforms, not spinning disconnected limb meshes.
    // The GLB itself is not deformed when it lacks a skeleton/animations.
    const amount = Math.min(1, motion.speed / 4.5);
    const gait = Math.sin(this.clock * (motion.sprinting ? 12 : 8.5));
    const legs = gait * amount * 0.52;
    this.leftHip.rotation.x = legs;
    this.rightHip.rotation.x = -legs;
    if (motion.holdingGun) {
      // Reach both hands forward towards the approximated long gun.
      this.leftShoulder.rotation.x = -1.08 + gait * amount * 0.035;
      this.rightShoulder.rotation.x = -1.05 - gait * amount * 0.035;
      this.leftShoulder.rotation.z = -0.18;
      this.rightShoulder.rotation.z = 0.10;
      this.leftElbow.rotation.x = -0.35;
      this.rightElbow.rotation.x = -0.50;
    } else {
      this.leftShoulder.rotation.x = -legs * 0.8;
      this.rightShoulder.rotation.x = legs * 0.8;
      this.leftShoulder.rotation.z = 0.08;
      this.rightShoulder.rotation.z = -0.08;
      this.leftElbow.rotation.x = 0;
      this.rightElbow.rotation.x = 0;
    }
    this.weaponProxy.setEnabled(motion.holdingGun);
    this.mannequin.position.y = Math.abs(gait) * amount * 0.022;
  }

  dispose(): void {
    this.disposed = true;
    this.activeClip?.stop();
    for (const group of this.animationGroups) group.dispose();
    this.animationGroups = [];
    this.gltfRoot?.dispose(false, true);
    this.root.dispose(false, true);
    for (const mat of this.mats) mat.dispose();
  }
}
