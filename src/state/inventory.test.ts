import { describe, expect, it } from 'bun:test';
import { partNumbersOf } from '../core/inventory/match';
import type { OwnedList } from '../core/inventory/stock';
import { PARTS } from '../core/parts/catalog';
import { createStore } from 'zustand/vanilla';
import { cleanName, createInventory, INVENTORY_KEY, isStorable, listSize, MAX_COPIES, MAX_LISTS, nameFromFile, ownedListFrom, parseInventory, startInventoryMatching } from './inventory';
import type { LibraryState } from './library';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const SET: OwnedList = {
  id: 'a',
  name: 'Creative Flower Shop',
  catalogue: 'rebrickable',
  copies: 1,
  lots: [{ part: '3001', colour: 4, quantity: 2 }],
  unmatched: [{ part: '5903', colour: 85, quantity: 3, reason: 'part' }],
};

describe('keeping the parts lists', () => {
  it('stores lists and reads them back in a new session', () => {
    const storage = memoryStorage();
    const first = createInventory(storage);
    expect(first.addList(SET)).toBe(true);
    expect(first.setCopies('a', 4)).toBe(true);
    expect(createInventory(storage).store.getState().lists).toEqual([{ ...SET, copies: 4 }]);
  });

  it('removes and renames lists, and keeps copies between 1 and the most allowed', () => {
    const shop = createInventory(memoryStorage());
    shop.addList(SET);
    shop.addList({ ...SET, id: 'b', name: 'Other' });
    shop.setCopies('a', 0);
    expect(shop.store.getState().lists[0]?.copies).toBe(1);
    shop.setCopies('a', 500);
    expect(shop.store.getState().lists[0]?.copies).toBe(MAX_COPIES);
    shop.setCopies('a', Number.NaN);
    expect(shop.store.getState().lists[0]?.copies).toBe(1);
    shop.renameList('b', '  Flower   shop\n');
    expect(shop.store.getState().lists[1]?.name).toBe('Flower shop');
    shop.removeList('a');
    expect(shop.store.getState().lists.map((l) => l.id)).toEqual(['b']);
  });

  it('keeps working for this visit when storage is full or blocked, and says so', () => {
    const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
    const shop = createInventory(full);
    expect(shop.addList(SET)).toBe(false);
    expect(shop.store.getState().lists).toHaveLength(1);
    expect(createInventory(null).addList(SET)).toBe(false);
    const blocked = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => undefined };
    expect(createInventory(blocked).store.getState().lists).toEqual([]);
  });

  it('picks up lists another tab changed', () => {
    const storage = memoryStorage();
    const listeners: ((event: Event) => void)[] = [];
    const events = { addEventListener: (_: string, listener: (event: Event) => void) => void listeners.push(listener) };
    const here = createInventory(storage, events as unknown as EventTarget);
    createInventory(storage).addList(SET);
    for (const listener of listeners) listener({ key: INVENTORY_KEY } as unknown as Event);
    expect(here.store.getState().lists).toHaveLength(1);
    storage.data.clear();
    for (const listener of listeners) listener({ key: null } as unknown as Event);
    expect(here.store.getState().lists).toEqual([]);
  });
});

describe('limits on what is kept', () => {
  it('adds no list past the most it keeps, or one it could not read back', () => {
    const shop = createInventory(memoryStorage());
    for (let i = 0; i < MAX_LISTS; i++) expect(shop.addList({ ...SET, id: `s${i}` })).toBe(true);
    expect(shop.addList({ ...SET, id: 'one-too-many' })).toBe(false);
    expect(shop.store.getState().lists).toHaveLength(MAX_LISTS);
    const empty = createInventory(memoryStorage());
    const tooMany = { ...SET, lots: [{ part: '3001', colour: 4, quantity: 1_000_000 }] };
    expect(isStorable(tooMany)).toBe(false);
    expect(empty.addList(tooMany)).toBe(false);
    expect(empty.store.getState().lists).toEqual([]);
  });
});

describe('matching kept lists again', () => {
  const unmatchedSet: OwnedList = { ...SET, lots: [], unmatched: [{ part: '3001', colour: 4, quantity: 2, reason: 'part' }] };

  it('moves parts it can now build with into the lists, and keeps them', () => {
    const storage = memoryStorage();
    const shop = createInventory(storage);
    shop.addList(unmatchedSet);
    expect(shop.rematch(partNumbersOf([], [], new Map()))).toBe(false);
    expect(shop.rematch(partNumbersOf(PARTS, [], new Map()))).toBe(true);
    expect(createInventory(storage).store.getState().lists[0]?.lots).toEqual([{ part: '3001', colour: 4, quantity: 2 }]);
  });

  it('does so whenever the library finishes loading', () => {
    const library = createStore<LibraryState>(() => ({ status: 'loading', entries: [], aliases: new Map(), categories: [], error: null }));
    const calls: number[] = [];
    const stop = startInventoryMatching(library, { rematch: (numbers) => calls.push(numbers.known.size) > 0 });
    expect(calls).toEqual([]);
    library.setState({ status: 'ready' });
    library.setState({ error: null });
    expect(calls).toHaveLength(1);
    stop();
    library.setState({ status: 'failed' });
    library.setState({ status: 'ready' });
    expect(calls).toHaveLength(1);
  });
});

describe('reading stored lists', () => {
  it('starts afresh from text that is not a store of lists', () => {
    expect(parseInventory('nope')).toEqual({ lists: [] });
    expect(parseInventory('{"lists": 3}')).toEqual({ lists: [] });
  });

  it('keeps the good lists when one is damaged', () => {
    const damaged = { ...SET, id: 'b', lots: [{ part: '../x', colour: 4, quantity: 1 }] };
    const text = JSON.stringify({ lists: [SET, damaged, { ...SET, id: 'c', copies: 1000 }, null] });
    expect(parseInventory(text).lists.map((l) => l.id)).toEqual(['a']);
  });
});

describe('a new list', () => {
  it('is matched and named from its file', () => {
    const numbers = partNumbersOf(PARTS, [], new Map());
    const { list, cut } = ownedListFrom(
      {
        catalogue: 'bricklink',
        parts: [
          { part: '3001', colour: 5, quantity: 6 },
          { part: '99999', colour: 5, quantity: 1 },
        ],
        notParts: 0,
        unreadable: 0,
      },
      nameFromFile('42693-1_parts.xml'),
      numbers,
      'id-1',
    );
    expect(list).toEqual({
      id: 'id-1',
      name: '42693-1 parts',
      catalogue: 'bricklink',
      copies: 1,
      lots: [{ part: '3001', colour: 4, quantity: 6 }],
      unmatched: [{ part: '99999', colour: 5, quantity: 1, reason: 'part' }],
    });
    expect(cut).toBe(false);
    expect(listSize(list)).toEqual({ usable: 6, unusable: 1 });
  });

  it('always has a short name', () => {
    expect(cleanName('   ')).toBe('Parts list');
    expect(cleanName('x'.repeat(200))).toHaveLength(80);
    expect(nameFromFile('Rebrickable_parts.CSV')).toBe('Rebrickable parts');
  });
});
