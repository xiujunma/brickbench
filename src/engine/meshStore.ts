import { LDRAW_PREFIX } from '../core/ldraw/catalogIndex';
import { decodePartMesh, type PartMesh } from '../core/ldraw/format';

/** Scene meshes jump ahead of thumbnails nobody may be looking at. */
export type LoadPriority = 'high' | 'low';

/** Where library meshes come from, as GeometryCache sees it. */
export interface MeshSource {
  /** The part's mesh if it has loaded; otherwise starts loading it and returns null. */
  request(partId: string): PartMesh | null;
  load(partId: string, priority?: LoadPriority): Promise<PartMesh>;
  /** Calls back whenever a mesh finishes loading. */
  subscribe(listener: (partId: string, mesh: PartMesh) => void): () => void;
  /** Calls back when failed parts may be tried again, e.g. after the connection came back. */
  onRetry(listener: () => void): () => void;
}

export type Fetch = (url: string, init?: { readonly signal?: AbortSignal }) => Promise<Response>;

export interface MeshStoreOptions {
  /** Folder holding <id>.bin files, ending in a slash. */
  readonly baseUrl: string;
  readonly fetch?: Fetch;
  readonly maxConcurrent?: number;
  /** Decoded meshes kept for reuse, by count and by size; geometries in use hold their own reference. */
  readonly maxCached?: number;
  readonly maxCachedBytes?: number;
  readonly timeoutMs?: number;
  /** Waits before each retry of a download that failed for a passing reason. */
  readonly retryDelaysMs?: readonly number[];
}

/** No library mesh comes near this once unpacked; anything bigger is not one. */
const MAX_MESH_BYTES = 32 * 1024 * 1024;

/** A failure worth retrying: the network, a timeout or a busy server, unlike a missing or damaged file. */
class PassingError extends Error {}

function isGzip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_MESH_BYTES) {
      await reader.cancel();
      throw new Error('The part mesh is too large.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

function sizeOf(mesh: PartMesh): number {
  return mesh.positions.byteLength + mesh.normals.byteLength + mesh.indices.byteLength;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Calls every listener even if one throws; the error still surfaces, just not here. */
function notifyAll<T extends unknown[]>(listeners: Iterable<(...args: T) => void>, ...args: T): void {
  for (const listener of listeners) {
    try {
      listener(...args);
    } catch (error: unknown) {
      queueMicrotask(() => {
        throw error;
      });
    }
  }
}

/**
 * Fetches library part meshes on demand: a few at a time, scene parts
 * first, each once, retrying passing failures, with recently used meshes
 * kept decoded within a memory budget. Files may be gzip-compressed;
 * servers that already decompressed them are fine too.
 */
export class MeshStore implements MeshSource {
  private readonly ready = new Map<string, PartMesh>();
  private readyBytes = 0;
  private readonly loading = new Map<string, Promise<PartMesh>>();
  private readonly failures = new Map<string, string>();
  private readonly listeners = new Set<(partId: string, mesh: PartMesh) => void>();
  private readonly failureListeners = new Set<(partId: string, message: string) => void>();
  private readonly retryListeners = new Set<() => void>();
  private readonly queues: Record<LoadPriority, (() => void)[]> = { high: [], low: [] };
  private active = 0;
  private readonly options: Required<Omit<MeshStoreOptions, 'fetch'>> & { readonly fetch: Fetch };

  constructor(options: MeshStoreOptions) {
    this.options = {
      maxConcurrent: 6,
      maxCached: 400,
      maxCachedBytes: 96 * 1024 * 1024,
      timeoutMs: 30_000,
      retryDelaysMs: [800, 3000],
      fetch: (url, init) => fetch(url, init),
      ...options,
    };
  }

  /** The part's mesh if it is already here, without loading anything. */
  peek(partId: string): PartMesh | null {
    return this.touch(partId);
  }

  request(partId: string): PartMesh | null {
    const mesh = this.touch(partId);
    if (!mesh && !this.failures.has(partId)) this.load(partId).catch(() => undefined);
    return mesh;
  }

  load(partId: string, priority: LoadPriority = 'high'): Promise<PartMesh> {
    const mesh = this.touch(partId);
    if (mesh) return Promise.resolve(mesh);
    const pending = this.loading.get(partId);
    if (pending) return pending;
    const promise = this.fetchWithRetries(partId, priority).then(
      (loaded) => {
        this.failures.delete(partId);
        this.remember(partId, loaded);
        notifyAll(this.listeners, partId, loaded);
        return loaded;
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.failures.set(partId, message);
        notifyAll(this.failureListeners, partId, message);
        throw new Error(`Could not load ${partId}: ${message}`);
      },
    );
    this.loading.set(partId, promise);
    void promise.catch(() => undefined).finally(() => this.loading.delete(partId));
    return promise;
  }

  /** Why a part's mesh failed to load, if it did. */
  failure(partId: string): string | undefined {
    return this.failures.get(partId);
  }

  /** Lets failed parts try again (the connection came back, or the user asked) and tells whoever draws them. */
  retryFailed(): void {
    if (this.failures.size === 0) return;
    this.failures.clear();
    notifyAll(this.retryListeners);
  }

  subscribe(listener: (partId: string, mesh: PartMesh) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onFailure(listener: (partId: string, message: string) => void): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  onRetry(listener: () => void): () => void {
    this.retryListeners.add(listener);
    return () => this.retryListeners.delete(listener);
  }

  private touch(partId: string): PartMesh | null {
    const mesh = this.ready.get(partId);
    if (!mesh) return null;
    // re-insert so the map's order stays least to most recently used
    this.ready.delete(partId);
    this.ready.set(partId, mesh);
    return mesh;
  }

  private remember(partId: string, mesh: PartMesh): void {
    this.ready.set(partId, mesh);
    this.readyBytes += sizeOf(mesh);
    while (this.ready.size > 1 && (this.ready.size > this.options.maxCached || this.readyBytes > this.options.maxCachedBytes)) {
      const [oldest, dropped] = this.ready.entries().next().value ?? [];
      if (oldest === undefined || dropped === undefined) break;
      this.ready.delete(oldest);
      this.readyBytes -= sizeOf(dropped);
    }
  }

  private async fetchWithRetries(partId: string, priority: LoadPriority): Promise<PartMesh> {
    if (!partId.startsWith(LDRAW_PREFIX)) throw new Error('not a library part');
    const delays = this.options.retryDelaysMs;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.fetchOnce(partId, priority);
      } catch (error: unknown) {
        const delay = delays[attempt];
        if (!(error instanceof PassingError) || delay === undefined) throw error;
        await wait(delay);
      }
    }
  }

  /** Downloads one file; passing troubles (network, timeout, busy server) are marked for retrying. */
  private async download(url: string): Promise<Uint8Array> {
    let response: Response;
    try {
      // the timeout covers the body too, so a stalled transfer cannot hold a slot for ever
      response = await this.options.fetch(url, { signal: AbortSignal.timeout(this.options.timeoutMs) });
      if (response.ok) return new Uint8Array(await response.arrayBuffer());
    } catch (error: unknown) {
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      throw new PassingError(timedOut ? 'the download timed out' : 'the network is unreachable');
    }
    if (response.status >= 500 || response.status === 429) throw new PassingError(`HTTP ${response.status}`);
    throw new Error(`HTTP ${response.status}`);
  }

  private async fetchOnce(partId: string, priority: LoadPriority): Promise<PartMesh> {
    await this.acquire(priority);
    try {
      const bytes = await this.download(`${this.options.baseUrl}${encodeURIComponent(partId.slice(LDRAW_PREFIX.length))}.bin`);
      return decodePartMesh(isGzip(bytes) ? await gunzip(bytes) : bytes);
    } finally {
      this.releaseSlot();
    }
  }

  private acquire(priority: LoadPriority): Promise<void> {
    if (this.active < this.options.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queues[priority].push(resolve));
  }

  private releaseSlot(): void {
    const next = this.queues.high.shift() ?? this.queues.low.shift();
    if (next) next();
    else this.active -= 1;
  }
}
