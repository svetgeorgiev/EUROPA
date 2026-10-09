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
  failedIds: string[];
  lastError: string;
}

export interface ChunkStreamHooks {
  loadChunk: (id: string) => Promise<ChunkFile>;
  onLoad: (chunk: ChunkFile) => void;
  onUnload: (id: string) => void;
  onStatus: (stats: ChunkStreamStats) => void;
  onWarning?: (message: string) => void;
}

/**
 * Pure tile lifecycle: no Babylon, DOM or Vue dependencies.
 * A failed tile is held until the player leaves the neighbourhood or
 * explicitly calls retryFailed(); never spin in a render-loop retry storm.
 */
export class ChunkStreamer {
  private readonly manifest: ChunkManifest;
  private readonly hooks: ChunkStreamHooks;
  private readonly loaded = new Set<string>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly failures = new Map<string, string>();
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
      available: this.manifest.chunks.length,
      failedIds: [...this.failures.keys()],
      lastError: [...this.failures.values()].at(-1) ?? ''
    };
  }

  hasLoaded(id: string): boolean {
    return this.loaded.has(id);
  }

  private queueDesiredTiles(): Promise<void>[] {
    const queued: Promise<void>[] = [];
    for (const id of this.desired) {
      if (this.loaded.has(id) || this.pending.has(id) || this.failures.has(id)) continue;
      // Schedule after recording in pending so a synchronous callback failure
      // cannot leave a completed request stuck as "loading" forever.
      const promise = Promise.resolve().then(() => this.fetchAndActivate(id));
      this.pending.set(id, promise);
      queued.push(promise);
    }
    this.publish();
    return queued;
  }

  /** Load a 3x3 neighbourhood around the player; release distant tiles. */
  async moveTo(point: Point2): Promise<void> {
    if (this.disposed) return;
    const tile = chunkAt(point, this.manifest);
    if (!tile) return;
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
    // Leaving a neighbourhood clears its failure; returning permits a retry.
    for (const id of [...this.failures.keys()]) {
      if (!this.desired.has(id)) this.failures.delete(id);
    }
    await Promise.all(this.queueDesiredTiles());
  }

  /**
   * Manual one-shot retry (T in-game). No automatic repeated network calls.
   * The failure reason remains visible until the tile actually loads.
   */
  async retryFailed(): Promise<void> {
    if (this.disposed) return;
    const ids = [...this.failures.keys()].filter(id => this.desired.has(id));
    if (!ids.length) return;
    for (const id of ids) this.failures.delete(id);
    await Promise.all(this.queueDesiredTiles());
  }

  private async fetchAndActivate(id: string): Promise<void> {
    try {
      const chunk = await this.hooks.loadChunk(id);
      if (!isChunkFile(chunk, id)) throw new Error('Invalid chunk JSON for ' + id);
      if (this.disposed || !this.desired.has(id)) return;
      this.hooks.onLoad(chunk);
      this.loaded.add(id);
      this.failures.delete(id);
    } catch (error) {
      if (this.disposed || !this.desired.has(id)) return;
      const reason = error instanceof Error ? error.message : String(error);
      this.failures.set(id, reason);
      this.hooks.onWarning?.('Chunk ' + id + ' failed: ' + reason);
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
    this.pending.clear(); // Late network replies are ignored by fetchAndActivate.
  }
}
