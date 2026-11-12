import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { toPartDef } from '../core/ldraw/catalogIndex';
import { DEFAULT_SCENE, serializeDocument } from '../core/io/modelFile';
import { modelFromBricks } from '../core/model/model';
import type { Brick } from '../core/model/types';
import { getPart } from '../core/parts/catalog';
import type { PartDef, PartLookup } from '../core/parts/types';
import { AUTOSAVE_BACKUP_KEY, AUTOSAVE_KEY, isAutosavePaused } from './persistence';
import { restoreSession } from './session';
import { backupStore, discardBackup, keepBackup, readBackup } from './sessionBackup';
import { createEditorStore } from './store';
import { stubGlobal, unstubAllGlobals } from '../testing/helpers';

const LIBRARY_BRICK = toPartDef({ id: '3001', name: 'Brick 2 × 4', category: 'Brick', w: 4, d: 2, h: 3, origin: [0, 1.2, 0], snug: true });

function savedModel(bricks: readonly Omit<Brick, 'id'>[]): string {
  const model = modelFromBricks(bricks.map((b, i) => ({ ...b, id: `b${i}` })));
  return serializeDocument({ name: 'Saved', model, settings: DEFAULT_SCENE });
}

const BUILT_IN = { partId: 'brick-2x4', colorId: 4, x: 0, y: 0, z: 0, r: 0 } as const;
const FROM_LIBRARY = { partId: 'ldraw:3001', colorId: 1, x: 0, y: 3, z: 0, r: 0 } as const;

let storage: Map<string, string>;
/** Most characters storage will hold, like a browser quota. */
let quota = Infinity;

beforeEach(() => {
  storage = new Map();
  quota = Infinity;
  backupStore.setState({ available: false });
  stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        const used = [...storage].reduce((sum, [k, v]) => sum + (k === key ? 0 : v.length), 0);
        if (used + value.length > quota) throw new DOMException('full', 'QuotaExceededError');
        storage.set(key, value);
      },
      removeItem: (key: string) => void storage.delete(key),
    },
  });
});

afterEach(() => {
  unstubAllGlobals();
});

/** A lookup that only knows the library brick once `known` is set, like the real catalogue. */
function setup(libraryPart: PartDef = LIBRARY_BRICK) {
  const known = { library: false };
  const lookup: PartLookup = (id) => (id === libraryPart.id ? (known.library ? libraryPart : undefined) : getPart(id));
  let n = 0;
  const store = createEditorStore({ lookup, nextId: () => `id${n++}` });
  const loadLibrary = vi.fn(async () => {
    known.library = true;
  });
  const deps = { store, lookup, nextId: () => `r${n++}`, loadLibrary, usesLibrary: (t: string) => t.includes('"ldraw:') };
  return { store, deps, loadLibrary, known };
}

function partsOf(store: ReturnType<typeof setup>['store']): string[] {
  return [...store.getState().history.present.bricks.values()].map((b) => b.partId).sort();
}

const lastToast = (store: ReturnType<typeof setup>['store']) => store.getState().toasts.at(-1);

describe('restoring the last session', () => {
  it('does nothing without a save', async () => {
    const { store, deps, loadLibrary } = setup();
    await restoreSession(deps);
    expect(store.getState().history.present.bricks.size).toBe(0);
    expect(loadLibrary).not.toHaveBeenCalled();
  });

  it('opens a model of built-in parts without waiting for the library', async () => {
    const { store, deps, loadLibrary } = setup();
    storage.set(AUTOSAVE_KEY, savedModel([BUILT_IN]));
    await restoreSession(deps);
    expect(partsOf(store)).toEqual(['brick-2x4']);
    expect(loadLibrary).not.toHaveBeenCalled();
  });

  it('loads the library before opening a model that uses it', async () => {
    const { store, deps, loadLibrary } = setup();
    storage.set(AUTOSAVE_KEY, savedModel([BUILT_IN, FROM_LIBRARY]));
    await restoreSession(deps);
    expect(loadLibrary).toHaveBeenCalledTimes(1);
    expect(partsOf(store)).toEqual(['brick-2x4', 'ldraw:3001']);
    expect(storage.has(AUTOSAVE_BACKUP_KEY)).toBe(false);
    expect(backupStore.getState().available).toBe(false);
  });

  it('keeps a full copy to recover when library parts could not be loaded', async () => {
    const { store, deps } = setup();
    const text = savedModel([BUILT_IN, FROM_LIBRARY]);
    storage.set(AUTOSAVE_KEY, text);
    await restoreSession({ ...deps, loadLibrary: () => Promise.reject(new Error('offline')) });
    expect(partsOf(store)).toEqual(['brick-2x4']);
    expect(storage.get(AUTOSAVE_BACKUP_KEY)).toBe(text);
    expect(backupStore.getState().available).toBe(true);
    expect(store.getState().toasts.map((t) => t.message).join(' ')).toMatch(/1 brick from your last session could not be restored.*Recover earlier session/);
  });

  it('keeps a copy when a library part changed size and now overlaps', async () => {
    // saved when the part was 2 × 2; the library now makes it 4 × 2, so it runs into its neighbour
    const grown = { ...LIBRARY_BRICK, w: 4, solids: [{ x0: 0, y0: 0, z0: 0, x1: 4, y1: 3, z1: 2 }] };
    const { store, deps } = setup(grown);
    const text = savedModel([{ ...FROM_LIBRARY, y: 0 }, { ...BUILT_IN, x: 2 }]);
    storage.set(AUTOSAVE_KEY, text);
    await restoreSession(deps);
    expect(store.getState().history.present.bricks.size).toBe(1);
    expect(storage.get(AUTOSAVE_BACKUP_KEY)).toBe(text);
  });

  it('holds the copy and pauses autosave when storage has no room for it', async () => {
    const { store, deps } = setup();
    const text = savedModel([BUILT_IN, FROM_LIBRARY]);
    storage.set(AUTOSAVE_KEY, text);
    quota = text.length + 10;
    await restoreSession({ ...deps, loadLibrary: () => Promise.reject(new Error('offline')) });
    // the stored session is untouched and nothing will overwrite it
    expect(storage.get(AUTOSAVE_KEY)).toBe(text);
    expect(storage.has(AUTOSAVE_BACKUP_KEY)).toBe(false);
    expect(isAutosavePaused()).toBe(true);
    expect(readBackup()).toBe(text);
    expect(store.getState().toasts.map((t) => t.message).join(' ')).toMatch(/autosave is paused/);
    discardBackup();
    expect(isAutosavePaused()).toBe(false);
    expect(readBackup()).toBeNull();
  });

  it('stops waiting for a library that never answers', async () => {
    vi.useFakeTimers();
    try {
      const { store, deps } = setup();
      storage.set(AUTOSAVE_KEY, savedModel([BUILT_IN, FROM_LIBRARY]));
      const restoring = restoreSession({ ...deps, loadLibrary: () => new Promise<void>(() => undefined), waitMs: 1000 });
      vi.advanceTimersByTime(1000);
      await restoring;
      expect(partsOf(store)).toEqual(['brick-2x4']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts fresh from a save it cannot read', async () => {
    const { store, deps } = setup();
    storage.set(AUTOSAVE_KEY, '{broken');
    await restoreSession(deps);
    expect(store.getState().history.present.bricks.size).toBe(0);
    expect(lastToast(store)?.tone).toBe('error');
  });

  it('keeps a copy if opening the model fails unexpectedly', async () => {
    const { store, deps } = setup();
    const text = savedModel([BUILT_IN]);
    storage.set(AUTOSAVE_KEY, text);
    store.setState({
      loadDocument: () => {
        throw new Error('boom');
      },
    });
    await restoreSession(deps);
    expect(storage.get(AUTOSAVE_BACKUP_KEY)).toBe(text);
  });

  it('notices a copy kept by an earlier visit, and forgets it once discarded', async () => {
    const { deps } = setup();
    storage.set(AUTOSAVE_BACKUP_KEY, 'earlier');
    await restoreSession(deps);
    expect(backupStore.getState().available).toBe(true);
    expect(readBackup()).toBe('earlier');
    discardBackup();
    expect(backupStore.getState().available).toBe(false);
    expect(keepBackup('again')).toBe('stored');
    expect(backupStore.getState().available).toBe(true);
  });
});
