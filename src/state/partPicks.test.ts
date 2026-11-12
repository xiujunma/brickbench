import { describe, expect, it } from 'bun:test';
import { getPart } from '../core/parts/catalog';
import {
  createPartPicks,
  FAVOURITES_LIMIT,
  PICKS_KEY,
  RECENT_LIMIT,
  startPartPicks,
  toggledFavourite,
  withRecent,
  type PartPicks,
} from './partPicks';
import { createEditorStore } from './store';

function memoryStorage(initial?: string) {
  const data = new Map<string, string>(initial ? [[PICKS_KEY, initial]] : []);
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('part picks', () => {
  it('keeps recent parts newest first, without repeats, up to a limit', () => {
    const none: PartPicks = { recent: [], favourites: [] };
    const picks = ['a', 'b', 'a', 'c'].reduce(withRecent, none);
    expect(picks.recent).toEqual(['c', 'a', 'b']);
    const many = Array.from({ length: RECENT_LIMIT + 5 }, (_, i) => `p${i}`).reduce(withRecent, picks);
    expect(many.recent).toHaveLength(RECENT_LIMIT);
    expect(many.recent[0]).toBe(`p${RECENT_LIMIT + 4}`);
    expect(withRecent(many, many.recent[0] ?? '')).toBe(many);
  });

  it('stars and unstars favourites', () => {
    const starred = toggledFavourite({ recent: [], favourites: ['a'] }, 'b');
    expect(starred.favourites).toEqual(['a', 'b']);
    expect(toggledFavourite(starred, 'a').favourites).toEqual(['b']);
  });

  it('remembers picks in storage and reads them back', () => {
    const storage = memoryStorage();
    const picks = createPartPicks(storage);
    picks.notePicked('brick-2x4');
    picks.toggleFavourite('ldraw:3937');
    const again = createPartPicks(storage);
    expect(again.store.getState()).toEqual({ recent: ['brick-2x4'], favourites: ['ldraw:3937'] });
  });

  it('keeps what it can from damaged lists: valid ids, once each, within the limits', () => {
    const stored = {
      recent: ['brick-1x1', 42, '', 'brick-1x1', 'x'.repeat(65), ...Array.from({ length: 40 }, (_, i) => `p${i}`)],
      favourites: [null, 'plate-2x2', 'plate-2x2', ...Array.from({ length: FAVOURITES_LIMIT + 5 }, (_, i) => `f${i}`)],
    };
    const picks = createPartPicks(memoryStorage(JSON.stringify(stored))).store.getState();
    expect(picks.recent).toHaveLength(RECENT_LIMIT);
    expect(picks.recent.slice(0, 2)).toEqual(['brick-1x1', 'p0']);
    expect(picks.favourites).toHaveLength(FAVOURITES_LIMIT);
    expect(picks.favourites.slice(0, 2)).toEqual(['plate-2x2', 'f0']);
    // one bad list leaves the other alone
    expect(createPartPicks(memoryStorage(JSON.stringify({ recent: 'oops', favourites: ['a'] }))).store.getState()).toEqual({ recent: [], favourites: ['a'] });
  });

  it('keeps the newest favourites when there are too many', () => {
    const full: PartPicks = { recent: [], favourites: Array.from({ length: FAVOURITES_LIMIT }, (_, i) => `f${i}`) };
    const more = toggledFavourite(full, 'new');
    expect(more.favourites).toHaveLength(FAVOURITES_LIMIT);
    expect(more.favourites.at(-1)).toBe('new');
    expect(more.favourites[0]).toBe('f1');
  });

  it('follows changes made in another tab', () => {
    const storage = memoryStorage();
    const events = new EventTarget();
    const picks = createPartPicks(storage, events);
    storage.data.set(PICKS_KEY, JSON.stringify({ recent: ['tile-1x2'], favourites: ['plate-2x2'] }));
    events.dispatchEvent(Object.assign(new Event('storage'), { key: 'something-else' }));
    expect(picks.store.getState().recent).toEqual([]);
    events.dispatchEvent(Object.assign(new Event('storage'), { key: PICKS_KEY }));
    expect(picks.store.getState()).toEqual({ recent: ['tile-1x2'], favourites: ['plate-2x2'] });
    // the other tab cleared all storage
    storage.data.clear();
    events.dispatchEvent(Object.assign(new Event('storage'), { key: null }));
    expect(picks.store.getState()).toEqual({ recent: [], favourites: [] });
  });

  it('starts empty from damaged, oversized or unreadable storage, and still works', () => {
    expect(createPartPicks(memoryStorage('{oops')).store.getState()).toEqual({ recent: [], favourites: [] });
    expect(createPartPicks(memoryStorage('null')).store.getState()).toEqual({ recent: [], favourites: [] });
    expect(createPartPicks(memoryStorage(JSON.stringify({ recent: [42], favourites: [] }))).store.getState().recent).toEqual([]);
    const blocked = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('blocked');
      },
    };
    const picks = createPartPicks(blocked);
    picks.notePicked('brick-1x1');
    expect(picks.store.getState().recent).toEqual(['brick-1x1']);
    expect(createPartPicks(null).store.getState().favourites).toEqual([]);
  });

  it('records the parts the editor builds with', () => {
    const editor = createEditorStore({ lookup: getPart, nextId: () => 'x' });
    const noted: string[] = [];
    const stop = startPartPicks(editor, { notePicked: (id) => void noted.push(id) });
    editor.getState().setActivePart('plate-2x2');
    editor.getState().setTool('select');
    editor.getState().setActivePart('plate-2x2');
    editor.getState().setActivePart('tile-1x2');
    stop();
    editor.getState().setActivePart('brick-1x1');
    expect(noted).toEqual(['plate-2x2', 'tile-1x2']);
  });
});
