import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { getPart } from '../core/parts/catalog';
import { parseDocument } from '../core/io/modelFile';
import { AUTOSAVE_KEY, pauseAutosave, readAutosaveText, resumeAutosave, startAutosave } from './persistence';
import { createEditorStore } from './store';
import { stubGlobal, unstubAllGlobals } from '../testing/helpers';

type Listener = () => void;

function fakeWindow() {
  const storage = new Map<string, string>();
  const listeners = new Map<string, Set<Listener>>();
  return {
    storage,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    },
    addEventListener: (type: string, listener: Listener) => {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: Listener) => void listeners.get(type)?.delete(listener),
    dispatch: (type: string) => listeners.get(type)?.forEach((listener) => listener()),
  };
}

function newStore() {
  let n = 0;
  return createEditorStore({ lookup: getPart, nextId: () => `id${n++}` });
}

let win: ReturnType<typeof fakeWindow>;

beforeEach(() => {
  vi.useFakeTimers();
  win = fakeWindow();
  stubGlobal('window', win);
});

afterEach(() => {
  vi.useRealTimers();
  unstubAllGlobals();
});

describe('autosave', () => {
  it('leaves another tab’s save alone when this tab closes without changes', () => {
    win.storage.set(AUTOSAVE_KEY, 'saved by another tab');
    const stop = startAutosave(newStore());
    win.dispatch('pagehide');
    vi.advanceTimersByTime(5000);
    expect(win.storage.get(AUTOSAVE_KEY)).toBe('saved by another tab');
    stop();
  });

  it('saves shortly after a change', () => {
    const store = newStore();
    const stop = startAutosave(store);
    store.getState().placePayload({ x: 0, y: 0, z: 0 });
    expect(win.storage.has(AUTOSAVE_KEY)).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(JSON.parse(win.storage.get(AUTOSAVE_KEY) ?? '{}').bricks).toHaveLength(1);
    expect(store.getState().lastSavedAt).not.toBeNull();
    stop();
  });

  it('flushes a pending change when the page is hidden', () => {
    const store = newStore();
    const stop = startAutosave(store);
    store.getState().placePayload({ x: 0, y: 0, z: 0 });
    win.dispatch('pagehide');
    expect(JSON.parse(win.storage.get(AUTOSAVE_KEY) ?? '{}').bricks).toHaveLength(1);
    stop();
  });

  it('reads back what it saved', () => {
    expect(readAutosaveText().status).toBe('empty');
    const store = newStore();
    const stop = startAutosave(store);
    store.getState().placePayload({ x: 0, y: 0, z: 0 });
    vi.advanceTimersByTime(1000);
    stop();
    const saved = readAutosaveText();
    if (saved.status !== 'found') throw new Error('nothing was saved');
    const parsed = parseDocument(saved.text, getPart, () => 'x');
    expect(parsed.ok && parsed.value.doc.model.bricks.size).toBe(1);
  });

  it('leaves the stored session alone while paused, then carries on', () => {
    win.storage.set(AUTOSAVE_KEY, 'protected');
    const store = newStore();
    const stop = startAutosave(store);
    pauseAutosave();
    store.getState().placePayload({ x: 0, y: 0, z: 0 });
    vi.advanceTimersByTime(1000);
    win.dispatch('pagehide');
    expect(win.storage.get(AUTOSAVE_KEY)).toBe('protected');
    resumeAutosave();
    store.getState().placePayload({ x: 4, y: 0, z: 0 });
    vi.advanceTimersByTime(1000);
    expect(JSON.parse(win.storage.get(AUTOSAVE_KEY) ?? '{}').bricks).toHaveLength(2);
    stop();
  });

  it('reports storage it cannot read', () => {
    stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('Access denied');
        },
      },
    });
    expect(readAutosaveText()).toEqual({ status: 'failed', reason: 'Access denied' });
  });
});
