import { describe, expect, it, vi } from 'bun:test';
import { encodePartMesh, type PartMesh } from '../core/ldraw/format';
import { MeshStore, type Fetch } from './meshStore';
import { waitFor } from '../testing/helpers';

const TRIANGLE: PartMesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint16Array([0, 1, 2]),
};
/** Decoded size of TRIANGLE: 36 + 36 + 6 bytes. */
const TRIANGLE_BYTES = 78;

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function binary(bytes: Uint8Array = encodePartMesh(TRIANGLE), status = 200): Response {
  return new Response(bytes as Uint8Array<ArrayBuffer>, { status });
}

/** A fetch whose responses resolve only when the test says so. */
function controlledFetch() {
  const calls: { url: string; resolve: (response: Response) => void }[] = [];
  const fetch: Fetch = (url) => new Promise<Response>((resolve) => calls.push({ url, resolve }));
  return { calls, fetch };
}

const NO_WAIT = { retryDelaysMs: [0, 0] };

describe('MeshStore', () => {
  it('loads gzip-compressed and plain meshes from the library folder', async () => {
    const plain = encodePartMesh(TRIANGLE);
    const packed = await gzip(plain);
    const fetch = vi.fn<Fetch>((url) => Promise.resolve(binary(url.includes('3001') ? packed : plain)));
    const store = new MeshStore({ baseUrl: '/ldraw/parts/', fetch });

    const a = await store.load('ldraw:3001');
    const b = await store.load('ldraw:3003');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/ldraw/parts/3001.bin', '/ldraw/parts/3003.bin']);
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(a.indices).toEqual(new Uint16Array([0, 1, 2]));
    expect(b.positions[3]).toBeCloseTo(1, 3);
    expect(store.peek('ldraw:3001')).toBe(a);
    expect(store.peek('ldraw:9999')).toBeNull();
  });

  it('fetches each part once and tells subscribers when it lands', async () => {
    const { calls, fetch } = controlledFetch();
    const store = new MeshStore({ baseUrl: '/', fetch });
    const heard = vi.fn();
    store.subscribe(heard);

    expect(store.request('ldraw:3001')).toBeNull();
    const loads = [store.load('ldraw:3001'), store.load('ldraw:3001')];
    expect(store.request('ldraw:3001')).toBeNull();
    await waitFor(() => expect(calls).toHaveLength(1));
    calls[0]?.resolve(binary());
    const [first, second] = await Promise.all(loads);
    expect(calls).toHaveLength(1);
    expect(first).toBe(second);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith('ldraw:3001', first);
    expect(store.request('ldraw:3001')).toBe(first ?? null);
  });

  it('keeps only a few downloads going at once, scene parts before thumbnails', async () => {
    const { calls, fetch } = controlledFetch();
    const store = new MeshStore({ baseUrl: '/', fetch, maxConcurrent: 1 });
    const first = store.load('ldraw:a');
    await waitFor(() => expect(calls).toHaveLength(1));
    const thumbnail = store.load('ldraw:thumb', 'low');
    const scene = store.load('ldraw:scene', 'high');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toHaveLength(1);
    calls[0]?.resolve(binary());
    await first;
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.url).toBe('/scene.bin');
    calls[1]?.resolve(binary());
    await scene;
    await waitFor(() => expect(calls).toHaveLength(3));
    calls[2]?.resolve(binary());
    await thumbnail;
  });

  it('retries network trouble, timeouts and busy servers, but not missing files', async () => {
    const responses: (() => Promise<Response>)[] = [
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Promise.resolve(binary(new Uint8Array(), 503)),
      () => Promise.resolve(binary()),
    ];
    const fetch = vi.fn<Fetch>(() => (responses.shift() ?? (() => Promise.resolve(binary(new Uint8Array(), 404))))());
    const store = new MeshStore({ baseUrl: '/', fetch, ...NO_WAIT });
    await expect(store.load('ldraw:flaky')).resolves.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(3);

    await expect(store.load('ldraw:gone')).rejects.toThrow(/ldraw:gone.*HTTP 404/);
    expect(fetch).toHaveBeenCalledTimes(4);

    const hanging: Fetch = (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    const slow = new MeshStore({ baseUrl: '/', fetch: hanging, timeoutMs: 5, retryDelaysMs: [] });
    await expect(slow.load('ldraw:slow')).rejects.toThrow(/timed out/);
  });

  it('remembers failures until they may be retried', async () => {
    let status = 404;
    const fetch = vi.fn<Fetch>(() => Promise.resolve(binary(encodePartMesh(TRIANGLE), status)));
    const store = new MeshStore({ baseUrl: '/', fetch });
    const failed = vi.fn();
    const retried = vi.fn();
    store.onFailure(failed);
    store.onRetry(retried);

    await expect(store.load('ldraw:9999')).rejects.toThrow(/ldraw:9999.*HTTP 404/);
    expect(failed).toHaveBeenCalledWith('ldraw:9999', 'HTTP 404');
    expect(store.failure('ldraw:9999')).toBe('HTTP 404');
    expect(store.request('ldraw:9999')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);

    status = 200;
    store.retryFailed();
    expect(retried).toHaveBeenCalledTimes(1);
    expect(store.failure('ldraw:9999')).toBeUndefined();
    store.request('ldraw:9999');
    await waitFor(() => expect(store.peek('ldraw:9999')).not.toBeNull());
    store.retryFailed();
    expect(retried).toHaveBeenCalledTimes(1);
  });

  it('keeps calling listeners and resolving loads when one listener throws', async () => {
    const store = new MeshStore({ baseUrl: '/', fetch: () => Promise.resolve(binary()) });
    const later = vi.fn();
    store.subscribe(() => {
      throw new Error('listener bug');
    });
    store.subscribe(later);
    const errors: unknown[] = [];
    // the listener's error is rethrown on a later microtask; catch it there
    const spy = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
      try {
        callback();
      } catch (error: unknown) {
        errors.push(error);
      }
    });
    try {
      await expect(store.load('ldraw:3001')).resolves.toBeDefined();
      expect(later).toHaveBeenCalled();
      expect(errors).toEqual([expect.objectContaining({ message: 'listener bug' })]);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects damaged files and ids outside the library', async () => {
    const store = new MeshStore({ baseUrl: '/', fetch: () => Promise.resolve(binary(new Uint8Array([1, 2, 3]))) });
    await expect(store.load('ldraw:3001')).rejects.toThrow(/not a BrickBench part mesh/);
    await expect(store.load('brick-2x4')).rejects.toThrow(/not a library part/);
  });

  it('forgets the least recently used meshes beyond its limits', async () => {
    const fetch = vi.fn<Fetch>(() => Promise.resolve(binary()));
    const store = new MeshStore({ baseUrl: '/', fetch, maxCached: 2 });
    await store.load('ldraw:a');
    await store.load('ldraw:b');
    store.request('ldraw:a');
    await store.load('ldraw:c');
    expect(store.peek('ldraw:a')).not.toBeNull();
    expect(store.peek('ldraw:c')).not.toBeNull();
    expect(store.peek('ldraw:b')).toBeNull();

    const small = new MeshStore({ baseUrl: '/', fetch, maxCachedBytes: TRIANGLE_BYTES * 2 });
    for (const id of ['a', 'b', 'c']) await small.load(`ldraw:${id}`);
    expect(['a', 'b', 'c'].map((id) => small.peek(`ldraw:${id}`) !== null)).toEqual([false, true, true]);
  });
});
