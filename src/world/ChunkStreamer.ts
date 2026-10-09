import {
  chunkAt, chunkId, nearbyChunkIds, isChunkFile,
  type ChunkFile, type ChunkManifest
} from './chunkGrid.ts';
import type { Point2 } from './osm.ts';

export interface ChunkStreamStats {
  current: string;
  loaded: number;
  desired: number;
  loading: number;
  failed: number;
  available: number;
}

export interface ChunkStreamHooks {
  loadChunk: (id: string) => Promise<ChunkFile>;
  onLoad: (chunk: ChunkFile) => void;
  onUnload: (id: string) => void;
  onStatus: (stats: ChunkStreamStats) => void;
  onWarning?: (message: string) => void;
}

/**
 * Pure chunk lifecycle manager: no Babylon.js, Vue, DOM or networking.
 * Rendering and fetching are injected, allowing deterministic tests.
 */
export class ChunkStreamer {
  private readonly manifest: ChunkManifest;
  private readonly hooks: ChunkStreamHooks;
  private readonly loaded = new Set<string>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly failures = new Set<string>();
  private desired = new Set<string>();
  private current = '';
  private disposed = false;

  constructor(manifest: ChunkManifest, hooks: ChunkStreamHooks) {
    this.manifest = manifest;
    this.hooks = hooks;
    this.publish();
  }

  get stats(): ChunkStreamStats {
    return {
      current: this.current,
      loaded: this.loaded.size,
      desired: this.desired.size,
      loading: this.pending.size,
      failed: this.failures.size,
      available: this.manifest.chunks.length
    };
  }

  hasLoaded(id: string): boolean {
    return this.loaded.has(id);
  }

  /** Loads a 3x3 neighbourhood, not the whole 1km map. */
  async moveTo(point: Point2): Promise<void> {
    if (this.disposed) return;
    const tile = chunkAt(point, this.manifest);
    if (!tile) return; // World boundary is handled by the game collider.
    const next = chunkId(tile.col, tile.row);
    if (this.current === next) {
      await Promise.all([...this.pending.values()]);
      return;
    }
    this.current = next;
    this.desired = new Set(nearbyChunkIds(tile, this.manifest, 1));

    for (const id of [...this.loaded]) {
      if (!this.desired.has(id)) {
        this.loaded.delete(id);
        this.hooks.onUnload(id);
      }
    }
    // Retry a failed tile only after the player has left its neighbourhood.
    for (const id of [...this.failures]) {
      if (!this.desired.has(id)) this.failures.delete(id);
    }
    const loads: Promise<void>[] = [];
    for (const id of this.desired) {
      if (this.loaded.has(id) || this.pending.has(id) || this.failures.has(id)) continue;
      const loading = Promise.resolve().then(() => this.fetchAndActivate(id));
      this.pending.set(id, loading);
      loads.push(loading);
    }
    this.publish();
    await Promise.all(loads);
  }

  private async fetchAndActivate(id: string): Promise<void> {
    try {
      const chunk = await this.hooks.loadChunk(id);
      if (!isChunkFile(chunk, id)) throw new Error('Invalid chunk JSON for ' + id);
      if (this.disposed || !this.desired.has(id)) return;
      this.hooks.onLoad(chunk);
      this.loaded.add(id);
    } catch (error) {
      if (this.disposed || !this.desired.has(id)) return;
      this.failures.add(id);
      this.hooks.onWarning?.('Chunk ' + id + ' failed: ' + String(error));
    } finally {
      this.pending.delete(id);
      if (!this.disposed) this.publish();
    }
  }

  private publish(): void {
    if (!this.disposed) this.hooks.onStatus(this.stats);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.desired.clear();
    for (const id of this.loaded) this.hooks.onUnload(id);
    this.loaded.clear();
    this.failures.clear();
    // Pending requests can complete later but will not activate geometry.
    this.pending.clear();
  }
}
