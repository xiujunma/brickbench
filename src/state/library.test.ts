import { describe, expect, it, spyOn, vi } from 'bun:test';
import { LDRAW_INDEX_VERSION } from '../core/ldraw/format';
import { getPart } from '../core/parts/catalog';
import type { Fetch } from '../engine/meshStore';
import { createPartLibrary, usesLibraryParts } from './library';
import { waitFor } from '../testing/helpers';

const INDEX = {
  version: 1,
  generated: '2026-11-11T00:00:00Z',
  parts: [
    { id: '3003', name: 'Brick 2 × 2', category: 'Brick', w: 2, d: 2, h: 3, origin: [0, 1.2, 0], snug: true },
    { id: '3937', name: 'Hinge 1 × 2 Base', category: 'Hinge', w: 2, d: 1, h: 2, origin: [0, 0.8, 0], snug: false },
  ],
};

function json(body: unknown, status = 200, type = 'application/json'): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });
}

describe('part library', () => {
  it('loads the index once and registers its parts', async () => {
    const fetch = vi.fn(() => Promise.resolve(json(INDEX)));
    const library = createPartLibrary('/base/ldraw/', fetch);
    expect(library.store.getState().status).toBe('idle');

    const [a, b] = await Promise.all([library.load(), library.load()]);
    expect(a).toBe(b);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/base/ldraw/index.json', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(a.status).toBe('ready');
    expect(a.categories).toEqual([{ name: 'Brick', count: 1 }, { name: 'Hinge', count: 1 }]);
    expect(a.entries.map((e) => e.id)).toEqual(['3003', '3937']);
    expect(getPart('ldraw:3003')?.name).toBe('Brick 2 × 2');
    await library.load();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a library that was never built as missing, including SPA fallbacks', async () => {
    const notFound = createPartLibrary('/', () => Promise.resolve(json('nope', 404, 'text/plain')));
    expect((await notFound.load()).status).toBe('missing');
    const fallback = createPartLibrary('/', () => Promise.resolve(json('<!doctype html>', 200, 'text/html')));
    expect((await fallback.load()).status).toBe('missing');
  });

  it('fails readably and tries again on the next load', async () => {
    const fetch = vi
      .fn<Fetch>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(json('{not json'))
      // a library from a later version of the app than this one reads
      .mockResolvedValueOnce(json({ ...INDEX, version: LDRAW_INDEX_VERSION + 1 }))
      .mockResolvedValueOnce(json('', 500))
      .mockResolvedValueOnce(json(INDEX));
    const library = createPartLibrary('/', fetch);
    expect(await library.load()).toMatchObject({ status: 'failed', error: expect.stringMatching(/could not be reached/) });
    expect(await library.load()).toMatchObject({ status: 'failed', error: expect.stringMatching(/damaged \(not valid JSON\)/) });
    expect(await library.load()).toMatchObject({ status: 'failed', error: expect.stringMatching(/damaged/) });
    expect(await library.load()).toMatchObject({ status: 'failed', error: expect.stringMatching(/HTTP 500/) });
    expect((await library.load()).status).toBe('ready');
  });

  it('starts loading when asked, but tries a failure again only when told to', async () => {
    const fetch = vi.fn<Fetch>().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(json(INDEX));
    const library = createPartLibrary('/', fetch);
    const meshesRetried = spyOn(library.meshes, 'retryFailed');
    library.request();
    library.request();
    await waitFor(() => expect(library.store.getState().status).toBe('failed'));
    // focusing the search box again must not refetch behind the user's back
    library.request();
    expect(fetch).toHaveBeenCalledTimes(1);
    library.retry();
    expect(meshesRetried).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(library.store.getState().status).toBe('ready'));
    library.request();
    library.retry();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries meshes without loading a library nobody asked for', () => {
    const fetch = vi.fn<Fetch>(() => Promise.resolve(json(INDEX)));
    const library = createPartLibrary('/', fetch);
    const meshesRetried = spyOn(library.meshes, 'retryFailed');
    library.retry();
    expect(meshesRetried).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(library.store.getState().status).toBe('idle');
  });

  it('gives up on an index that takes too long', async () => {
    const hanging: Fetch = (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    const library = createPartLibrary('/', hanging, 5);
    expect(await library.load()).toMatchObject({ status: 'failed', error: expect.stringMatching(/took too long/) });
  });

  it('serves meshes from the library’s parts folder', () => {
    const fetch = vi.fn(() => new Promise<Response>(() => undefined));
    const library = createPartLibrary('/base/ldraw/', fetch);
    library.meshes.request('ldraw:3003');
    return waitFor(() => expect(fetch).toHaveBeenCalledWith('/base/ldraw/parts/3003.bin', expect.anything()));
  });

  it('spots models that use library parts', () => {
    expect(usesLibraryParts('{"bricks":[{"part":"ldraw:3001"}]}')).toBe(true);
    expect(usesLibraryParts('{"bricks":[{"part":"brick-2x4"}]}')).toBe(false);
  });
});
