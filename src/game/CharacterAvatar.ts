import {
  AbstractMesh, AnimationGroup, Color3, Mesh, MeshBuilder, Scene, SceneLoader,
  StandardMaterial, TransformNode, Vector3, Quaternion
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
  weaponId?: 'primary' | 'm249' | null;
  visible: boolean;
}
type AvatarClip = 'idle' | 'walk' | 'run' | 'jump' | 'armed';

type RigJointName = 'leftThigh' | 'rightThigh' | 'leftShin' | 'rightShin' |
  'leftUpperArm' | 'rightUpperArm' | 'leftForearm' | 'rightForearm' |
  'leftShoulder' | 'rightShoulder' | 'spine';
interface RigJoint { node: TransformNode; rest: Quaternion; }

const SKIN_715_BONES: Record<RigJointName, RegExp> = {
  leftThigh: /^thigh_L\.L_\d+$/i,
  rightThigh: /^thigh_L\.R_\d+$/i,
  leftShin: /^shin_L\.L_\d+$/i,
  rightShin: /^shin_L\.R_\d+$/i,
  leftUpperArm: /^arm_L_upper\.L_\d+$/i,
  rightUpperArm: /^arm_L_upper\.R_\d+$/i,
  leftForearm: /^arm_L_lower\.L_\d+$/i,
  rightForearm: /^arm_L_lower\.R_\d+$/i,
  leftShoulder: /^shoulder_L\.L_\d+$/i,
  rightShoulder: /^shoulder_L\.R_\d+$/i,
  spine: /^spine_003_\d+$/i
};

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
  private readonly weaponAttachment: TransformNode;
  private rightHand: TransformNode | null = null;
  private thirdPersonM249: TransformNode | null = null;
  private m249Loading = false;

  private gltfRoot: TransformNode | null = null;
  private animationGroups: AnimationGroup[] = [];
  private clipMap = new Map<AvatarClip, AnimationGroup>();
  private activeClip: AnimationGroup | null = null;
  private usableRig = false;
  private proceduralRig = false;
  private readonly rigJoints = new Map<RigJointName, RigJoint>();
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
    this.weaponAttachment = new TransformNode('avatar-right-hand-weapon-attachment', scene);
    this.weaponAttachment.parent = this.root;
    this.weaponAttachment.position.set(0.28, 1.15, 0.45);
    this.weaponProxy = createBox('avatar-held-weapon-standin', this.weaponAttachment,
      new Vector3(0.12, 0.12, 0.48), new Vector3(0, 0, 0.16), gun);
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
      // Uploaded Partizan 715 has a 90-joint skinned skeleton but no clips.
      // Locate its actual transform-linked bones for runtime procedural posing.
      const linked = imported.skeletons.flatMap(skeleton =>
        skeleton.bones.map(bone => bone.getTransformNode()).filter(
          (node): node is TransformNode => node !== null
        )
      );
      const nodes = [...linked, ...imported.transformNodes];
      this.rightHand = nodes.find(node => /^hand_L\.R_\d+$/i.test(node.name)) ?? null;
      for (const key of Object.keys(SKIN_715_BONES) as RigJointName[]) {
        const node = nodes.find(candidate => SKIN_715_BONES[key].test(candidate.name));
        if (!node) continue;
        const rest = node.rotationQuaternion?.clone() ??
          Quaternion.RotationYawPitchRoll(node.rotation.y, node.rotation.x, node.rotation.z);
        node.rotationQuaternion = rest.clone();
        this.rigJoints.set(key, { node, rest });
      }
      this.proceduralRig = imported.skeletons.length > 0 &&
        ['leftThigh', 'rightThigh', 'leftShin', 'rightShin',
          'leftUpperArm', 'rightUpperArm', 'leftForearm', 'rightForearm']
          .every(name => this.rigJoints.has(name as RigJointName));
      console.info('EUROPA character rig diagnostics', {
        skeletons: imported.skeletons.map(s => s.name),
        animations: imported.animationGroups.map(g => g.name),
        usableLocomotion: this.usableRig,
        proceduralRig: this.proceduralRig,
        mappedJoints: [...this.rigJoints.keys()]
      });

      this.syncPresentation();
      if (this.usableRig) {
        this.notify('Character animations found; actual survivor active');
      } else if (this.proceduralRig) {
        this.notify('Partizan 715: 90-joint skin rig mapped · procedural walking enabled · P shows bind pose');
      } else {
        this.notify('Skeleton could not be mapped for posing; animated mannequin active · P previews skin');
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
    const useGLB = !!this.gltfRoot && (this.usableRig || this.proceduralRig || this.staticPreview);
    this.mannequin.setEnabled(!useGLB);
    this.gltfRoot?.setEnabled(useGLB);
  }

  toggleSkinPreview(): string {
    if (!this.gltfRoot) return 'Skin preview unavailable until skin_1.glb loads';
    if (this.usableRig) return 'Character has authored animation clips; original skin already active';
    this.staticPreview = !this.staticPreview;
    this.activeClip?.pause();
    this.syncPresentation();
    return this.staticPreview
      ? 'Skin bind pose preview · P returns to the animated survivor'
      : this.proceduralRig
        ? 'Procedural skeletal walking restored on actual skin'
        : 'Walking placeholder restored; inspect mesh skeleton to retarget';
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

    if (this.proceduralRig && !this.usableRig) {
      this.applyProceduralSkinPose(motion);
    }
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
    if (motion.holdingGun && motion.weaponId === 'm249' &&
        !this.thirdPersonM249 && !this.m249Loading) void this.loadThirdPersonM249();
    // Follow the real skinned hand after pose update when the asset has one.
    if (this.rightHand && this.gltfRoot && !this.staticPreview) {
      this.root.computeWorldMatrix(true);
      this.rightHand.computeWorldMatrix(true);
      const handWorld = this.rightHand.getAbsolutePosition();
      const transform = this.root.getWorldMatrix().clone().invert();
      const handLocal = Vector3.TransformCoordinates(handWorld, transform);
      if (handLocal.length() < 4) {
        this.weaponAttachment.position.copyFrom(handLocal);
        this.weaponAttachment.position.addInPlace(new Vector3(0.04, -0.09, 0.22));
      }
    } else {
      this.weaponAttachment.position.set(0.28, 1.15, 0.45);
    }
    const showActualM249 = motion.holdingGun && motion.weaponId === 'm249' &&
      this.thirdPersonM249 !== null;
    this.thirdPersonM249?.setEnabled(showActualM249);
    this.weaponProxy.setEnabled(motion.holdingGun && !showActualM249);
    this.mannequin.position.y = Math.abs(gait) * amount * 0.022;
  }

  private async loadThirdPersonM249(): Promise<void> {
    if (this.m249Loading || this.disposed || this.thirdPersonM249) return;
    this.m249Loading = true;
    const root = new TransformNode('third-person-m249-import', this.scene);
    const pivot = new TransformNode('third-person-m249-orientation', this.scene);
    try {
      const result = await SceneLoader.ImportMeshAsync('', '/assets/guns/', 'gun2.glb', this.scene);
      if (this.disposed) {
        result.meshes.forEach(mesh => mesh.dispose(false, true));
        root.dispose();
        pivot.dispose();
        return;
      }
      const nodes: TransformNode[] = [...result.transformNodes, ...result.meshes];
      const imported = new Set(nodes);
      nodes.filter(node => !node.parent || !imported.has(node.parent as TransformNode))
        .forEach(node => { node.parent = root; });
      root.computeWorldMatrix(true);
      const renderables = result.meshes.filter(
        (mesh): mesh is AbstractMesh => mesh instanceof AbstractMesh && mesh.getTotalVertices() > 0
      );
      if (!renderables.length) throw new Error('M249 contains no renderable geometry');
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
      const dim = max.subtract(min);
      const extent = Math.max(dim.x, dim.y, dim.z);
      if (!Number.isFinite(extent) || extent < 0.001) throw new Error('Invalid M249 bounds');
      root.scaling.setAll(0.95 / extent);
      root.position.set(
        -(min.x + max.x) * root.scaling.x / 2,
        -(min.y + max.y) * root.scaling.x / 2,
        -(min.z + max.z) * root.scaling.x / 2
      );
      root.parent = pivot;
      pivot.parent = this.weaponAttachment;
      pivot.rotation.x = dim.y > dim.x && dim.y > dim.z ? Math.PI / 2 : 0;
      pivot.rotation.y = dim.x > dim.y && dim.x > dim.z ? Math.PI / 2 : 0;
      this.thirdPersonM249 = pivot;
      this.notify('Third-person M249 mesh attached near survivor right hand');
    } catch (error) {
      pivot.dispose(false, true);
      root.dispose(false, true);
      if (!this.disposed) {
        console.warn('EUROPA: third-person M249 import failed', error);
        this.notify('Third-person gun2.glb failed to load; showing fallback prop');
      }
    } finally {
      this.m249Loading = false;
    }
  }

  private rotateJoint(name: RigJointName, axis: Vector3, radians: number): void {
    const joint = this.rigJoints.get(name);
    if (!joint) return;
    // Apply delta relative to imported rest orientation (never accumulate drift).
    joint.node.rotationQuaternion = joint.rest.multiply(
      Quaternion.RotationAxis(axis, radians)
    );
  }

  private restoreRigPose(): void {
    for (const joint of this.rigJoints.values()) {
      joint.node.rotationQuaternion = joint.rest.clone();
    }
  }

  private applyProceduralSkinPose(motion: AvatarMotion): void {
    if (this.staticPreview) {
      this.restoreRigPose();
      return;
    }
    const gaitAmount = Math.min(1, motion.speed / 4.5);
    const phase = this.clock * (motion.sprinting ? 12 : 8.5);
    const swing = Math.sin(phase) * gaitAmount;
    const idle = Math.sin(this.clock * 2.2);
    const air = !motion.grounded;
    this.rotateJoint('leftThigh', Vector3.Right(), (air ? -0.22 : swing * 0.53));
    this.rotateJoint('rightThigh', Vector3.Right(), (air ? 0.24 : -swing * 0.53));
    this.rotateJoint('leftShin', Vector3.Right(), air ? 0.35 : Math.max(0, -swing) * 0.46);
    this.rotateJoint('rightShin', Vector3.Right(), air ? 0.35 : Math.max(0, swing) * 0.46);
    // Lower the original arms out of the imported T-pose, and bring them
    // forward for an approximate rifle hold. Fine hand IK is a future milestone.
    const holding = motion.holdingGun;
    this.rotateJoint('leftShoulder', Vector3.Forward(), holding ? 0.36 : 0.30);
    this.rotateJoint('rightShoulder', Vector3.Forward(), holding ? -0.36 : -0.30);
    this.rotateJoint('leftUpperArm', Vector3.Right(), holding ? -0.73 : -swing * 0.35);
    this.rotateJoint('rightUpperArm', Vector3.Right(), holding ? -0.80 : swing * 0.35);
    this.rotateJoint('leftForearm', Vector3.Right(), holding ? 0.78 : 0.10);
    this.rotateJoint('rightForearm', Vector3.Right(), holding ? 0.88 : 0.10);
    this.rotateJoint('spine', Vector3.Forward(), idle * 0.012);
  }

  dispose(): void {
    this.disposed = true;
    this.activeClip?.stop();
    for (const group of this.animationGroups) group.dispose();
    this.animationGroups = [];
    this.thirdPersonM249?.dispose(false, true);
    this.thirdPersonM249 = null;
    this.gltfRoot?.dispose(false, true);
    this.root.dispose(false, true);
    for (const mat of this.mats) mat.dispose();
  }
}
