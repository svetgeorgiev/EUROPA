import { AbandonedCar } from './AbandonedCar';
import { FirstPersonGun } from './FirstPersonGun';
import { CharacterAvatar } from './CharacterAvatar';
import { DamageableTargets } from './DamageableTargets';
import { stepPlanarMotion, type PlanarMotion } from './motionPhysics';
import type { WeaponAmmo } from './weaponState';
import { renderOSMWorld } from '../world/renderOSM';
import { ChunkRenderer, type ChunkGeometry } from '../world/ChunkRenderer';
import { ChunkStreamer, type ChunkStreamStats } from '../world/ChunkStreamer';
import { chunkAt, chunkId, isChunkManifest, type ChunkManifest, type ChunkFile } from '../world/chunkGrid';
import { isWorldMap, type Point2 } from '../world/osm';
import { BuildingCollisionField } from '../world/buildingCollisions';
import { PoiMarkers } from '../world/PoiMarkers';
import { CampusGrounds } from '../world/CampusGrounds';
import type { CampusSiteData } from '../world/CampusSites';
import type { WorldMap } from '../world/osm';
import type { NavigationData } from '../world/navigation';
import {
  Engine, Scene, FreeCamera, Vector3, HemisphericLight, DirectionalLight,
  MeshBuilder, StandardMaterial, Color3, Color4, Mesh, Scalar, Ray
} from '@babylonjs/core';

export interface GameStats { fps: number; x: number; y: number; z: number; yaw: number; grounded: boolean; }
export interface GameCallbacks {
  onStats: (stats: GameStats) => void;
  onLockChange: (locked: boolean) => void;
  onError: (message: string) => void;
  onWorldChange: (mode: 'test' | 'osm' | 'stream') => void;
  onStreamStats: (stats: ChunkStreamStats) => void;
  onVehicleStatus: (message: string) => void;
  onVehicleLocation: (position: Point2 | null) => void;
  onInteractionHint: (hint: string) => void;
  onWeaponState: (state: WeaponAmmo) => void;
  onCameraMode: (mode: 'first' | 'third') => void;
}

const WALK_SPEED = 4.5;
const JUMP_SPEED = 6.0;
const GRAVITY = -18;
const EYE_HEIGHT = 1.65;
const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.35;
// Keep a small clearance from OSM footprint boundaries.
const BUILDING_CLEARANCE = PLAYER_RADIUS + 0.10;

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
  private readonly streamAbort = new AbortController();
  private chunkManifest: ChunkManifest | null = null;
  private chunkRenderer: ChunkRenderer | null = null;
  private streamer: ChunkStreamer | null = null;
  private streamActive = false;
  private lastStreamTile = '';
  private readonly streamedGeometry = new Map<string, ChunkGeometry>();
  private boundaryMeshes: Mesh[] = [];
  private readonly buildingCollisions = new BuildingCollisionField();
  // Last known non-overlapping ground position. Also powers the R unstuck key.
  private lastSafePosition: Point2 = { x: 0, z: -7 };
  private poiMarkers: PoiMarkers | null = null;
  private campusGrounds: CampusGrounds | null = null;
  private poiFrameSeconds = 0;
  private worldReady = false;
  private abandonedCar: AbandonedCar | null = null;
  private weapon: FirstPersonGun | null = null;
  private avatar: CharacterAvatar | null = null;
  private damageable: DamageableTargets | null = null;
  private cameraMode: 'first' | 'third' = 'first';
  private planarVelocity: PlanarMotion = { x: 0, z: 0 };
  private movingSpeed = 0;
  private sprinting = false;
  private lastInteractionHint = '';

  constructor(private readonly canvas: HTMLCanvasElement, callbacks: GameCallbacks) {
    this.callbacks = callbacks;
    this.engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.53, 0.63, 0.66, 1);
    // Gentle daylight, ambient fill and distant atmospheric haze.
    // We intentionally avoid dynamic shadows until 002D performance profiling.
    this.scene.ambientColor = new Color3(0.13, 0.14, 0.15);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.00042;
    this.scene.fogColor = new Color3(0.53, 0.63, 0.66);
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
    this.callbacks.onWorldChange('test');
    void this.tryLoadWorld();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
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
    hemi.intensity = 0.78;
    hemi.diffuse = new Color3(0.88, 0.90, 0.92);
    hemi.groundColor = new Color3(0.30, 0.33, 0.32);
    const sun = new DirectionalLight('sun', new Vector3(-0.6, -1, 0.4), this.scene);
    sun.intensity = 0.62;
    sun.diffuse = new Color3(0.98, 0.92, 0.84);
  }



  /**
   * 002C: try a versioned, generated chunk manifest first. If it is missing
   * (or the spawn tile could not be loaded), retain the 002B whole-map path.
   */
  private async tryLoadWorld(): Promise<void> {
    try {
      const response = await fetch('/worlds/nova-zagora/chunks/manifest.json', {
        cache: 'no-store', signal: this.streamAbort.signal
      });
      if (!response.ok) {
        await this.tryLoadOSMWorld();
        return;
      }
      const manifestData: unknown = await response.json();
      if (!isChunkManifest(manifestData)) {
        console.warn('EUROPA: invalid chunk manifest. Falling back to 002B map.json.');
        await this.tryLoadOSMWorld();
        return;
      }
      if (this.disposed) return;
      const manifest = manifestData;
      this.chunkManifest = manifest;
      this.chunkRenderer = new ChunkRenderer(this.scene, manifest);
      // Remember the existing test scene until a valid spawn tile has loaded.
      const oldMeshes = this.scene.meshes.filter(mesh => mesh !== this.playerCollider);
      const streamer = new ChunkStreamer(manifest, {
        loadChunk: async id => {
          const path = '/worlds/nova-zagora/chunks/' + id + '.json';
          const reply = await fetch(path, { cache: 'no-store', signal: this.streamAbort.signal });
          if (!reply.ok) throw new Error('HTTP ' + reply.status + ' at ' + path);
          return await reply.json() as ChunkFile;
        },
        onLoad: chunk => {
          if (this.disposed || !this.chunkRenderer) return;
          const geometry = this.chunkRenderer.render(chunk);
          this.streamedGeometry.set(chunk.id, geometry);
          this.buildingCollisions.setGroup('tile:' + chunk.id, chunk.buildings);
          if (this.streamActive) {
            this.syncStreamSolids();
            // Late arriving OSM data can surround the player. Never trap them.
            if (this.buildingCollisions.isBlocked({
              x: this.playerCollider.position.x, z: this.playerCollider.position.z
            }, BUILDING_CLEARANCE)) this.respawnPlayer();
          }
        },
        onUnload: id => {
          this.buildingCollisions.removeGroup('tile:' + id);
          const geometry = this.streamedGeometry.get(id);
          if (!geometry) return;
          for (const mesh of geometry.meshes) mesh.dispose();
          this.streamedGeometry.delete(id);
          if (this.streamActive) this.syncStreamSolids();
        },
        onStatus: status => { this.callbacks.onStreamStats(status); },
        onWarning: warning => { console.warn('EUROPA:', warning); }
      });
      this.streamer = streamer;
      await streamer.moveTo(manifest.spawn);
      if (this.disposed) return;
      const center = chunkAt(manifest.spawn, manifest);
      const id = center ? chunkId(center.col, center.row) : '';
      if (!id || !streamer.hasLoaded(id)) {
        console.warn('EUROPA: spawn chunk failed; reverting to complete 002B map.');
        streamer.dispose();
        this.streamer = null;
        this.chunkRenderer.dispose();
        this.chunkRenderer = null;
        this.chunkManifest = null;
        await this.tryLoadOSMWorld();
        return;
      }

      const safeSpawn = this.buildingCollisions.findSafePosition(
        manifest.spawn, BUILDING_CLEARANCE, manifest.halfSizeMeters, 150
      );
      if (!safeSpawn) {
        console.warn('EUROPA: no clear streaming spawn found; reverting to 002B map.');
        streamer.dispose();
        this.streamer = null;
        this.chunkRenderer.dispose();
        this.chunkRenderer = null;
        this.chunkManifest = null;
        await this.tryLoadOSMWorld();
        return;
      }

      // The OSM world is ready: remove only the pre-existing test scene.
      oldMeshes.forEach(mesh => mesh.dispose());
      this.boundaryMeshes = this.chunkRenderer.createWorldBoundary();
      this.streamActive = true;
      this.worldReady = true;
      this.syncStreamSolids();
      this.initVehicle();
      this.teleportPlayer(safeSpawn);
      this.lastStreamTile = id;
      this.callbacks.onWorldChange('stream');
      this.callbacks.onStreamStats(streamer.stats);
      this.publishStats();
      console.info('EUROPA: 002C streaming enabled; active tiles:', streamer.stats.loaded);
    } catch (error) {
      if (this.disposed || this.streamAbort.signal.aborted) return;
      console.warn('EUROPA: chunk streaming could not start; loading 002B world.', error);
      this.streamer?.dispose();
      this.streamer = null;
      this.chunkRenderer?.dispose();
      this.chunkRenderer = null;
      this.chunkManifest = null;
      await this.tryLoadOSMWorld();
    }
  }

  private syncStreamSolids(): void {
    if (!this.streamActive) return;
    this.solids.length = 0;
    this.solids.push(...this.boundaryMeshes);
    for (const geometry of this.streamedGeometry.values()) {
      this.solids.push(...geometry.solids);
    }
  }

  private updateChunkStreaming(): void {
    if (!this.streamActive || !this.streamer || !this.chunkManifest) return;
    const tile = chunkAt({ x: this.playerCollider.position.x, z: this.playerCollider.position.z }, this.chunkManifest);
    const id = tile ? chunkId(tile.col, tile.row) : '';
    if (!id || id === this.lastStreamTile) return;
    this.lastStreamTile = id;
    void this.streamer.moveTo({ x: this.playerCollider.position.x, z: this.playerCollider.position.z });
  }

  /**
   * Optional 002B map. Missing data leaves the proven synthetic 001 scene intact.
   * Generated map is supplied by pnpm map:fetch and served from Vite's public dir.
   */
  private async tryLoadOSMWorld(): Promise<void> {
    try {
      const response = await fetch('/worlds/nova-zagora/map.json', { cache: 'no-store' });
      if (!response.ok) {
        console.info('EUROPA: no imported OSM map yet; run pnpm map:fetch. Using test environment.');
        return;
      }
      const map: unknown = await response.json();
      if (!isWorldMap(map) || map.buildings.length < 1) {
        console.warn('EUROPA: OSM map is empty or invalid. Keeping test environment.');
        return;
      }
      if (this.disposed) return;
      // Preserve the player collider, camera and lights; replace only scene geometry.
      const meshes = this.scene.meshes.filter(mesh => mesh !== this.playerCollider);
      meshes.forEach(mesh => mesh.dispose());
      this.solids.length = 0;
      const world = renderOSMWorld(this.scene, map);
      this.solids.push(...world.solids);
      this.buildingCollisions.clear();
      this.buildingCollisions.setGroup('static', map.buildings);
      const safe = this.buildingCollisions.findSafePosition(
        world.spawn, BUILDING_CLEARANCE, map.halfSizeMeters, 150
      );
      if (!safe) {
        console.warn('EUROPA: could not find a clear static OSM spawn; use R if trapped.');
      }
      this.teleportPlayer(safe ?? world.spawn);
      this.worldReady = true;
      this.initVehicle();
      this.callbacks.onWorldChange('osm');
      this.publishStats();
      console.info('EUROPA: loaded OpenStreetMap world:', map.roads.length, 'road segments,', map.buildings.length, 'buildings');
    } catch (error) {
      console.warn('EUROPA: could not load optional OSM world; using test environment.', error);
    }
  }

  private initVehicle(): void {
    if (this.disposed || this.abandonedCar) return;
    // Visual character is optional; existing invisible physics collider remains authoritative.
    this.avatar ??= new CharacterAvatar(this.scene, this.callbacks.onVehicleStatus);
    this.damageable ??= new DamageableTargets(this.scene, this.callbacks.onVehicleStatus);
    // Create the gun only after test-world meshes have been replaced by the OSM world.
    // This also restores a previously recovered weapon from localStorage.
    this.weapon ??= new FirstPersonGun(
      this.scene, this.camera, this.callbacks.onWeaponState, this.callbacks.onVehicleStatus,
      (mesh, point, direction) => { this.damageable?.hit(mesh, point, direction); }
    );
    // Initial placement near СУ Иван Вазов, not a surveyed parking bay.
    // Avoid OSM building footprint collisions before spawning.
    const safe = this.buildingCollisions.findSafePosition(
      { x: -65, z: -12 }, 3.0, this.chunkManifest?.halfSizeMeters ?? 500, 80
    );
    if (!safe) {
      this.callbacks.onVehicleStatus('No safe location for prototype vehicle');
      return;
    }
    const vehicle = new AbandonedCar(
      this.scene, this.callbacks.onVehicleStatus, () => !this.weapon?.hasGun
    );
    this.abandonedCar = vehicle;
    this.callbacks.onVehicleLocation(safe);
    // Non-geographic wooden test targets deliberately live outside OSM source tiles.
    this.damageable.spawnNear(safe, point => this.buildingCollisions.isBlocked(point, 2));
    void vehicle.load(safe.x, safe.z);
  }

  /** Debug only: place the player outside the car and face its centre. */
  private visitVehicle(): void {
    const position = this.abandonedCar?.location;
    if (!position) {
      this.callbacks.onVehicleStatus('No vehicle position yet — wait for the streamed map');
      return;
    }
    const offsets = [
      { x: 0, z: 8 }, { x: 8, z: 0 },
      { x: -8, z: 0 }, { x: 0, z: -8 },
      { x: 10, z: 10 }, { x: -10, z: -10 },
      { x: 15, z: 0 }, { x: 0, z: 15 }
    ];
    const candidate = offsets.map(offset => ({
      x: position.x + offset.x, z: position.z + offset.z
    })).find(point => !this.buildingCollisions.isBlocked(point, BUILDING_CLEARANCE));
    if (!candidate) {
      this.callbacks.onVehicleStatus('Cannot find a safe vehicle visit point');
      return;
    }
    this.teleportPlayer(candidate);
    this.pitch = 0;
    this.yaw = Math.atan2(position.x - candidate.x, position.z - candidate.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.callbacks.onVehicleStatus('Arrived near vehicle · walk towards it and press E to search');
    this.publishStats();
  }

  private updateViewCamera(): void {
    const p = this.playerCollider.position;
    const eye = p.y + EYE_HEIGHT - PLAYER_HEIGHT / 2;
    if (this.cameraMode === 'first') {
      this.camera.position.set(p.x, eye, p.z);
    } else {
      const back = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const from = new Vector3(p.x, eye, p.z);
      // Third-person inspection camera; stop in front of mapped collision meshes.
      const desiredDistance = 4.0;
      const ray = new Ray(from, back, desiredDistance);
      const obstruction = this.scene.pickWithRay(ray,
        mesh => mesh.checkCollisions && mesh.isVisible && mesh !== this.playerCollider
      );
      const distance = obstruction?.hit ? Math.max(0.5, (obstruction.distance ?? desiredDistance) - 0.2) : desiredDistance;
      this.camera.position.copyFrom(from.add(back.scale(distance)));
      this.camera.position.y += 1.15;
    }
    this.camera.rotation.set(this.pitch * (this.cameraMode === 'third' ? 0.6 : 1), this.yaw, 0);
  }

  private teleportPlayer(position: Point2): void {
    this.playerCollider.position.set(position.x, PLAYER_HEIGHT / 2 + 0.03, position.z);
    this.updateViewCamera();
    this.verticalVelocity = 0;
    this.planarVelocity = { x: 0, z: 0 };
    this.grounded = false;
    this.lastSafePosition = { ...position };
    this.publishStats();
  }

  private respawnPlayer(): void {
    // Prefer the last safe position; search outward if newly streamed
    // buildings obstruct it. Reset height too, for falls below missing ground.
    const halfSize = this.chunkManifest?.halfSizeMeters ?? 500;
    const position = this.buildingCollisions.findSafePosition(
      this.lastSafePosition, BUILDING_CLEARANCE, halfSize, 150
    );
    if (!position) {
      console.warn('EUROPA: could not find an unblocked respawn position.');
      return;
    }
    this.teleportPlayer(position);
    console.info('EUROPA: player repositioned at safe coordinates', position);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'KeyC' && !event.repeat && document.pointerLockElement === this.canvas) {
      event.preventDefault();
      this.cameraMode = this.cameraMode === 'first' ? 'third' : 'first';
      this.weapon?.setViewModelVisible(this.cameraMode === 'first');
      this.callbacks.onCameraMode(this.cameraMode);
      this.updateViewCamera();
      return;
    }
    if (event.code === 'KeyV' && !event.repeat && document.pointerLockElement === this.canvas) {
      event.preventDefault();
      this.visitVehicle();
      return;
    }
    if (event.code === 'KeyE' && !event.repeat && document.pointerLockElement === this.canvas) {
      event.preventDefault();
      const p = this.playerCollider.position;
      const result = this.abandonedCar?.interact(new Vector3(p.x, p.y + 0.75, p.z), this.yaw);
      if (result === 'gun') this.weapon?.pickUp();
      return;
    }
    if (event.code === 'KeyF' && !event.repeat && document.pointerLockElement === this.canvas) {
      event.preventDefault();
      this.weapon?.reload();
      return;
    }
    if (event.code === 'KeyR' && !event.repeat) {
      event.preventDefault();
      this.respawnPlayer();
      return;
    }
    if (event.code === 'KeyT' && !event.repeat && this.streamActive) {
      event.preventDefault();
      void this.streamer?.retryFailed();
      return;
    }
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
  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || document.pointerLockElement !== this.canvas) return;
    event.preventDefault();
    if (this.cameraMode === 'first') this.weapon?.fire();
  };
  private onMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;
    const sensitivity = 0.002;
    this.yaw += event.movementX * sensitivity;
    this.pitch = Scalar.Clamp(this.pitch + event.movementY * sensitivity, -1.48, 1.48);
    this.updateViewCamera();
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
      this.updateChunkStreaming();
      this.weapon?.update(dt);
      this.damageable?.update(dt);
      const p = this.playerCollider.position;
      this.avatar?.update(dt, {
        x: p.x, feetY: p.y - PLAYER_HEIGHT / 2, z: p.z,
        yaw: this.yaw, speed: this.movingSpeed, sprinting: this.sprinting,
        grounded: this.grounded, holdingGun: this.weapon?.hasGun ?? false,
        visible: this.cameraMode === 'third'
      });
      const hint = playing ? (this.abandonedCar?.interactionLabel(
        new Vector3(p.x, p.y + 0.75, p.z), this.yaw
      ) ?? '') : '';
      if (hint !== this.lastInteractionHint) {
        this.lastInteractionHint = hint;
        this.callbacks.onInteractionHint(hint);
      }
      this.scene.render();
      this.poiFrameSeconds += dt;
      if (this.poiFrameSeconds >= 0.033) {
        this.poiFrameSeconds = 0;
        this.poiMarkers?.update({
          x: this.playerCollider.position.x, z: this.playerCollider.position.z
        });
      }
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

  /** Labels are advisory metadata; OSM building footprints remain authoritative. */
  setPoiData(worldMap: WorldMap, nav: NavigationData, sites: CampusSiteData | null = null): void {
    if (this.disposed || !this.worldReady) return;
    try {
      this.poiMarkers?.dispose();
      this.poiMarkers = null;
      this.campusGrounds?.dispose();
      this.campusGrounds = null;
      if (sites) this.campusGrounds = new CampusGrounds(this.scene, sites);
      this.poiMarkers = new PoiMarkers(this.scene, this.canvas, worldMap, nav, sites);
      this.poiMarkers.update({ x: this.playerCollider.position.x, z: this.playerCollider.position.z });
    } catch (error) {
      console.warn('EUROPA: optional landmark labels unavailable', error);
    }
  }

  private publishStats(): void {
    const p = this.playerCollider.position;
    this.poiMarkers?.update({ x: p.x, z: p.z });
    this.callbacks.onStats({
      fps: Math.round(this.engine.getFps()) || 0,
      x: p.x, y: p.y + EYE_HEIGHT - PLAYER_HEIGHT / 2, z: p.z,
      yaw: this.yaw, grounded: this.grounded
    });
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

    const rayOrigin = this.playerCollider.position.add(new Vector3(0, -PLAYER_HEIGHT / 2 + 0.1, 0));
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
    const before: Point2 = {
      x: this.playerCollider.position.x, z: this.playerCollider.position.z
    };
    if (this.buildingCollisions.isBlocked(before, BUILDING_CLEARANCE)) {
      this.respawnPlayer();
      return;
    }
    // OSM footprints, not visual triangle faces, are authoritative for walls.
    // The short swept movement cannot cross building outlines, even at sprint
    // speed or when mesh winding makes a facade appear one-sided.
    this.planarVelocity = stepPlanarMotion(
      this.planarVelocity, { x: direction.x, z: direction.z }, dt, this.grounded, sprinting
    );
    const permitted = this.buildingCollisions.move(before, {
      x: this.planarVelocity.x * dt, z: this.planarVelocity.z * dt
    }, BUILDING_CLEARANCE);
    this.playerCollider.moveWithCollisions(new Vector3(
      permitted.x - before.x, this.verticalVelocity * dt, permitted.z - before.z
    ));
    const after: Point2 = {
      x: this.playerCollider.position.x, z: this.playerCollider.position.z
    };
    if (this.buildingCollisions.isBlocked(after, BUILDING_CLEARANCE)) {
      // Collision engine can still nudge the collider on its own axes.
      this.playerCollider.position.x = before.x;
      this.playerCollider.position.z = before.z;
    } else {
      this.lastSafePosition = after;
    }
    // Reject velocity against a blocked axis, keeping motion responsive near walls.
    if (Math.abs(this.playerCollider.position.x - before.x) < Math.abs(this.planarVelocity.x * dt) * 0.35) this.planarVelocity.x = 0;
    if (Math.abs(this.playerCollider.position.z - before.z) < Math.abs(this.planarVelocity.z * dt) * 0.35) this.planarVelocity.z = 0;
    this.movingSpeed = Math.hypot(this.planarVelocity.x, this.planarVelocity.z);
    this.sprinting = sprinting && this.movingSpeed > WALK_SPEED + 0.5;
    this.updateViewCamera();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.streamAbort.abort();
    this.abandonedCar?.dispose();
    this.abandonedCar = null;
    this.weapon?.dispose();
    this.weapon = null;
    this.avatar?.dispose();
    this.avatar = null;
    this.damageable?.dispose();
    this.damageable = null;
    this.poiMarkers?.dispose();
    this.poiMarkers = null;
    this.campusGrounds?.dispose();
    this.campusGrounds = null;
    this.buildingCollisions.clear();
    this.streamer?.dispose();
    this.streamer = null;
    this.chunkRenderer?.dispose();
    this.chunkRenderer = null;
    for (const mesh of this.boundaryMeshes) mesh.dispose();
    this.boundaryMeshes = [];
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.engine.stopRenderLoop(this.tick);
    this.scene.dispose();
    this.engine.dispose();
  }
}
