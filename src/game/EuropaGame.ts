import {
  Engine, Scene, FreeCamera, Vector3, HemisphericLight, DirectionalLight,
  MeshBuilder, StandardMaterial, Color3, Color4, Mesh, Scalar, Ray
} from '@babylonjs/core';

export interface GameStats { fps: number; x: number; y: number; z: number; grounded: boolean; }
export interface GameCallbacks {
  onStats: (stats: GameStats) => void;
  onLockChange: (locked: boolean) => void;
  onError: (message: string) => void;
}

const WALK_SPEED = 4.5;
const SPRINT_SPEED = 7.5;
const JUMP_SPEED = 6.0;
const GRAVITY = -18;
const EYE_HEIGHT = 1.65;
const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.35;

export class EuropaGame {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: FreeCamera;
  private readonly playerCollider: Mesh;
  private readonly keys = new Set<string>();
  private readonly solids: Mesh[] = [];
  private readonly callbacks: GameCallbacks;
  private verticalVelocity = 0;
  private grounded = false;
  private pitch = 0;
  private yaw = 0;
  private statsElapsed = 0;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement, callbacks: GameCallbacks) {
    this.callbacks = callbacks;
    this.engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.64, 0.78, 0.87, 1);
    this.scene.collisionsEnabled = true;
    this.scene.gravity = new Vector3(0, GRAVITY, 0);
    this.camera = new FreeCamera('player', new Vector3(0, EYE_HEIGHT + 0.03, -7), this.scene);
    this.camera.minZ = 0.05;
    this.camera.fov = 1.15;
    this.camera.inertia = 0;
    this.camera.checkCollisions = false; // Invisible player mesh handles collisions.
    this.camera.applyGravity = false; // Vertical movement is handled explicitly below.
    this.camera.ellipsoid = new Vector3(PLAYER_RADIUS, PLAYER_HEIGHT / 2, PLAYER_RADIUS);
    this.camera.ellipsoidOffset = new Vector3(0, PLAYER_HEIGHT / 2 - EYE_HEIGHT, 0);
    this.camera.rotation = new Vector3(0, 0, 0);
    this.scene.activeCamera = this.camera;
    this.playerCollider = MeshBuilder.CreateBox('player-collider', { size: 1 }, this.scene);
    this.playerCollider.isVisible = false;
    this.playerCollider.isPickable = false;
    this.playerCollider.checkCollisions = false;
    this.playerCollider.ellipsoid = new Vector3(PLAYER_RADIUS, PLAYER_HEIGHT / 2, PLAYER_RADIUS);
    this.playerCollider.ellipsoidOffset = Vector3.Zero();
    this.playerCollider.position.set(0, PLAYER_HEIGHT / 2 + 0.03, -7);
    this.makeTestWorld();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    this.engine.runRenderLoop(this.tick);
    this.publishStats();
  }

  private material(name: string, hex: string): StandardMaterial {
    const mat = new StandardMaterial(name, this.scene);
    mat.diffuseColor = Color3.FromHexString(hex);
    mat.specularColor = new Color3(0.08, 0.08, 0.08);
    return mat;
  }

  private makeTestWorld(): void {
    const groundMat = this.material('ground-mat', '#4c6354');
    const concrete = this.material('concrete-mat', '#92999b');
    const brick = this.material('brick-mat', '#a56b58');
    const roof = this.material('roof-mat', '#4b4e58');
    const marker = this.material('marker-mat', '#e9bd65');
    const ground = MeshBuilder.CreateGround('ground', { width: 90, height: 90 }, this.scene);
    ground.material = groundMat;
    ground.checkCollisions = true;
    this.solids.push(ground);

    const road = MeshBuilder.CreateGround('road', { width: 8, height: 90 }, this.scene);
    road.position.y = 0.015;
    road.material = this.material('asphalt-mat', '#343b42');
    // Road is visual-only; the collidable ground lies directly below it.

    for (let i = -4; i <= 4; i++) {
      const stripe = MeshBuilder.CreateBox('road-stripe-' + i, { width: 0.15, height: 0.025, depth: 3 }, this.scene);
      stripe.position.set(0, 0.035, i * 9);
      stripe.material = marker;
    }

    const buildings = [
      [-12, 7, 9, 5, 8], [12, 7, 8, 7, 9], [-12, -13, 10, 4, 8],
      [13, -13, 8, 6, 10], [-13, 25, 9, 8, 10], [13, 25, 10, 5, 8],
    ];
    buildings.forEach(([x, z, width, height, depth], i) => {
      const building = MeshBuilder.CreateBox('building-' + i, { width, height, depth }, this.scene);
      building.position.set(x, height / 2, z);
      building.material = i % 2 ? concrete : brick;
      building.checkCollisions = true;
      this.solids.push(building);
      const cap = MeshBuilder.CreateBox('roof-' + i, { width: width + 0.5, height: 0.3, depth: depth + 0.5 }, this.scene);
      cap.position.set(x, height + 0.15, z);
      cap.material = roof;
      cap.checkCollisions = true;
      this.solids.push(cap);
    });

    for (let i = 0; i < 8; i++) {
      const crate = MeshBuilder.CreateBox('crate-' + i, { size: 1.3 }, this.scene);
      crate.position.set(i % 2 ? 5.8 : -5.8, 0.65, -25 + i * 7);
      crate.material = i % 2 ? brick : concrete;
      crate.checkCollisions = true;
      this.solids.push(crate);
    }

    const boundary = [
      [0, 45, 90, 2], [0, -45, 90, 2], [45, 0, 2, 90], [-45, 0, 2, 90]
    ];
    boundary.forEach(([x, z, width, depth], i) => {
      const wall = MeshBuilder.CreateBox('boundary-' + i, { width, depth, height: 4 }, this.scene);
      wall.position.set(x, 2, z);
      wall.material = concrete;
      wall.checkCollisions = true;
      this.solids.push(wall);
    });

    const hemi = new HemisphericLight('sky-light', new Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.8;
    const sun = new DirectionalLight('sun', new Vector3(-0.6, -1, 0.4), this.scene);
    sun.intensity = 0.65;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    this.keys.add(event.code);
  };
  private onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };
  private onBlur = (): void => { this.keys.clear(); };
  private onResize = (): void => { this.engine.resize(); };
  private onPointerLockChange = (): void => {
    this.callbacks.onLockChange(document.pointerLockElement === this.canvas);
    if (document.pointerLockElement !== this.canvas) this.keys.clear();
  };
  private onMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;
    const sensitivity = 0.002;
    this.yaw += event.movementX * sensitivity;
    this.pitch = Scalar.Clamp(this.pitch + event.movementY * sensitivity, -1.48, 1.48);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  };

  requestPointerLock(): void {
    if (!this.disposed && document.pointerLockElement !== this.canvas) {
      void this.canvas.requestPointerLock();
    }
  }

  private tick = (): void => {
    if (this.disposed) return;
    try {
      const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
      const playing = document.pointerLockElement === this.canvas;
      if (playing) this.updateMovement(dt);
      this.scene.render();
      this.statsElapsed += dt;
      if (this.statsElapsed >= 0.15) {
        this.statsElapsed = 0;
        this.publishStats();
      }
    } catch (error) {
      const message = error instanceof Error ? error.name + ': ' + error.message : String(error);
      this.callbacks.onError(message);
      console.error('EUROPA render loop error', error);
      this.engine.stopRenderLoop(this.tick);
    }
  };

  private publishStats(): void {
    const p = this.camera.position;
    this.callbacks.onStats({ fps: Math.round(this.engine.getFps()) || 0, x: p.x, y: p.y, z: p.z, grounded: this.grounded });
  }

  private updateMovement(dt: number): void {
    const forward = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    const strafe = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const direction = new Vector3(
      Math.sin(this.yaw) * forward + Math.cos(this.yaw) * strafe,
      0,
      Math.cos(this.yaw) * forward - Math.sin(this.yaw) * strafe
    );
    if (direction.lengthSquared() > 0) direction.normalize();
    const sprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = sprinting ? SPRINT_SPEED : WALK_SPEED;

    const rayOrigin = this.camera.position.add(new Vector3(0, -(EYE_HEIGHT - 0.1), 0));
    const hit = this.scene.pickWithRay(
      new Ray(rayOrigin, new Vector3(0, -1, 0), 0.3),
      mesh => this.solids.includes(mesh as Mesh)
    );
    const nearFloor = Boolean(hit?.hit && hit.distance <= 0.16 && this.verticalVelocity <= 0);
    if (nearFloor) {
      this.grounded = true;
      this.verticalVelocity = 0;
    } else {
      this.grounded = false;
    }
    if (this.grounded && this.keys.has('Space')) {
      this.verticalVelocity = JUMP_SPEED;
      this.grounded = false;
    }
    if (!this.grounded) this.verticalVelocity += GRAVITY * dt;
    this.playerCollider.moveWithCollisions(new Vector3(direction.x * speed * dt, this.verticalVelocity * dt, direction.z * speed * dt));
    this.camera.position.copyFrom(this.playerCollider.position);
    this.camera.position.y += EYE_HEIGHT - PLAYER_HEIGHT / 2;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.engine.stopRenderLoop(this.tick);
    this.scene.dispose();
    this.engine.dispose();
  }
}
