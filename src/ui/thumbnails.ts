import { useEffect, useSyncExternalStore } from 'react';
import { isLDrawPartId } from '../core/ldraw/catalogIndex';
import { getPart } from '../core/parts/catalog';
import { GeometryCache } from '../engine/geometryCache';
import { MaterialLibrary } from '../engine/materials';
import { ThumbnailRenderer } from '../engine/thumbnails';
import { partLibrary } from '../state/library';

const BATCH_SIZE = 6;
const MAX_CACHED = 900;

interface Job {
  readonly key: string;
  readonly partId: string;
  readonly colorId: number;
}

const schedule: (callback: () => void) => void =
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? (callback) => window.requestIdleCallback(callback, { timeout: 120 })
    : (callback) => setTimeout(callback, 16);

function trim(map: Map<string, string>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/**
 * Renders part thumbnails lazily in small idle-time batches and caches them
 * per part and colour. While a new colour renders, the part's last
 * thumbnail stands in so tiles never flash empty. Only tiles still on
 * screen get drawn; library parts fetch their mesh (behind the scene's own
 * parts) when their turn comes, and are let go of once drawn.
 */
class ThumbnailService {
  private renderer: ThumbnailRenderer | null = null;
  private geometries: GeometryCache | null = null;
  private unavailable = false;
  private readonly cache = new Map<string, string>();
  private readonly latest = new Map<string, string>();
  private readonly queue: Job[] = [];
  private readonly pending = new Set<string>();
  /** How many mounted tiles show each part and colour. */
  private readonly watchers = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private scheduled = false;
  private version = 0;

  get(partId: string, colorId: number): string | undefined {
    const key = `${partId}|${colorId}`;
    const url = this.cache.get(key);
    if (url) return url;
    if (!this.unavailable && !this.pending.has(key)) {
      this.pending.add(key);
      this.push({ key, partId, colorId });
    }
    return this.latest.get(partId);
  }

  /** Marks a thumbnail as on screen; returns the call that marks it gone. */
  watch(key: string): () => void {
    this.watchers.set(key, (this.watchers.get(key) ?? 0) + 1);
    return () => {
      const count = (this.watchers.get(key) ?? 1) - 1;
      if (count > 0) this.watchers.set(key, count);
      else this.watchers.delete(key);
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): number => this.version;

  private push(job: Job): void {
    this.queue.push(job);
    this.kick();
  }

  private kick(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    schedule(() => this.process());
  }

  private ensureRenderer(): ThumbnailRenderer | null {
    if (this.renderer || this.unavailable) return this.renderer;
    const geometries = new GeometryCache(getPart, partLibrary.meshes);
    try {
      this.renderer = new ThumbnailRenderer(geometries, new MaterialLibrary());
      this.geometries = geometries;
    } catch {
      geometries.dispose();
      // WebGL is unavailable; tiles keep their placeholder shapes.
      this.unavailable = true;
      this.queue.length = 0;
      this.pending.clear();
    }
    return this.renderer;
  }

  /** A library part whose mesh is not here yet: fetch it, then queue the job again. Returns whether it had to wait. */
  private waitForMesh(job: Job): boolean {
    const meshes = partLibrary.meshes;
    if (!isLDrawPartId(job.partId) || meshes.peek(job.partId) || meshes.failure(job.partId)) return false;
    // a box will do as a picture if the mesh never comes
    void meshes.load(job.partId, 'low').catch(() => undefined).then(() => this.push(job));
    return true;
  }

  private draw(renderer: ThumbnailRenderer, job: Job): void {
    const url = renderer.render(job.partId, job.colorId);
    if (isLDrawPartId(job.partId)) {
      const dropped = this.geometries?.isPlaceholder(job.partId) && !partLibrary.meshes.failure(job.partId);
      this.geometries?.release(job.partId);
      // the mesh left memory before its turn came: fetch it again rather than keep a box
      if (dropped && this.waitForMesh(job)) return;
    }
    this.cache.set(job.key, url);
    this.latest.set(job.partId, url);
    this.pending.delete(job.key);
  }

  private process(): void {
    this.scheduled = false;
    const renderer = this.ensureRenderer();
    if (!renderer) return;
    for (const job of this.queue.splice(0, BATCH_SIZE)) {
      if (!this.watchers.has(job.key)) {
        // scrolled away or filtered out: draw it if it comes back
        this.pending.delete(job.key);
        continue;
      }
      if (!this.waitForMesh(job)) this.draw(renderer, job);
    }
    trim(this.cache, MAX_CACHED);
    trim(this.latest, MAX_CACHED);
    this.version += 1;
    for (const listener of this.listeners) listener();
    if (this.queue.length > 0) this.kick();
  }
}

const service = new ThumbnailService();

/** Thumbnail data URL for a part in a colour; undefined until the first render lands. */
export function useThumbnail(partId: string, colorId: number): string | undefined {
  useSyncExternalStore(service.subscribe, service.snapshot);
  const key = `${partId}|${colorId}`;
  useEffect(() => service.watch(key), [key]);
  return service.get(partId, colorId);
}
