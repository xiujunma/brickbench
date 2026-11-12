import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { parseLDrawIndex, toPartDef } from '../core/ldraw/catalogIndex';
import type { LDrawIndexEntry } from '../core/ldraw/format';
import { categoriesOf, createLibrarySearch, type CategoryCount, type LibrarySearch } from '../core/ldraw/librarySearch';
import { registerLibraryParts } from '../core/parts/catalog';
import { MeshStore, type Fetch } from '../engine/meshStore';

/**
 * idle: not asked for yet · missing: this copy of BrickBench was built
 * without the library · failed: it exists but could not be loaded.
 */
export type LibraryStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'failed';

export interface LibraryState {
  readonly status: LibraryStatus;
  readonly entries: readonly LDrawIndexEntry[];
  readonly categories: readonly CategoryCount[];
  readonly search: LibrarySearch;
  readonly error: string | null;
}

export interface PartLibrary {
  readonly store: StoreApi<LibraryState>;
  readonly meshes: MeshStore;
  /** The library folder, for links to its credits and licence. */
  readonly baseUrl: string;
  /** Loads the index once (again after a failure) and registers its parts with the catalogue. */
  load(): Promise<LibraryState>;
}

/** The index is about 1 MB; give slow connections a while, but not for ever. */
const INDEX_TIMEOUT_MS = 30_000;

const INITIAL: LibraryState = { status: 'idle', entries: [], categories: [], search: () => [], error: null };

/** Static hosts often answer unknown paths with the app's index.html instead of a 404. */
function isMissing(response: Response): boolean {
  return response.status === 404 || (response.headers.get('content-type') ?? '').includes('text/html');
}

function failed(error: string): LibraryState {
  return { ...INITIAL, status: 'failed', error };
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError';
}

async function fetchIndex(baseUrl: string, fetcher: Fetch, timeoutMs: number): Promise<LibraryState> {
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetcher(`${baseUrl}index.json`, { signal });
  } catch (error: unknown) {
    return failed(isTimeout(error) ? 'The parts library took too long to load. Try again.' : 'The parts library could not be reached. Check your connection and try again.');
  }
  if (isMissing(response)) return { ...INITIAL, status: 'missing' };
  if (!response.ok) return failed(`The parts library could not be loaded (HTTP ${response.status}).`);
  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error: unknown) {
    if (isTimeout(error)) return failed('The parts library took too long to load. Try again.');
    return failed('The LDraw library index is damaged (not valid JSON).');
  }
  try {
    const index = parseLDrawIndex(raw);
    registerLibraryParts(index.parts.map(toPartDef));
    return {
      status: 'ready',
      entries: index.parts,
      categories: categoriesOf(index.parts),
      search: createLibrarySearch(index.parts),
      error: null,
    };
  } catch (error: unknown) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}

export function createPartLibrary(
  baseUrl: string,
  fetcher: Fetch = (url, init) => fetch(url, init),
  indexTimeoutMs = INDEX_TIMEOUT_MS,
): PartLibrary {
  const store = createStore<LibraryState>(() => INITIAL);
  const meshes = new MeshStore({ baseUrl: `${baseUrl}parts/`, fetch: fetcher });
  let pending: Promise<LibraryState> | null = null;

  const load = (): Promise<LibraryState> => {
    const current = store.getState();
    if (current.status === 'ready' || current.status === 'missing') return Promise.resolve(current);
    if (!pending) {
      store.setState({ ...INITIAL, status: 'loading' });
      pending = fetchIndex(baseUrl, fetcher, indexTimeoutMs).then((next) => {
        pending = null;
        store.setState(next, true);
        return next;
      });
    }
    return pending;
  };

  return { store, meshes, baseUrl, load };
}

/** The library shipped in public/ldraw, built by `bun run ldraw`. */
export const partLibrary = createPartLibrary(`${import.meta.env.BASE_URL}ldraw/`);

export function useLibrary<T>(selector: (state: LibraryState) => T): T {
  return useStore(partLibrary.store, selector);
}

/** Whether a saved model refers to library parts, which must be known before it is opened. */
export function usesLibraryParts(modelText: string): boolean {
  return modelText.includes('"ldraw:');
}
