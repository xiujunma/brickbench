import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { z } from 'zod';
import { matchList, partNumbersOf, type PartNumbers } from '../core/inventory/match';
import { MAX_QUANTITY, type PartsListFile } from '../core/inventory/read';
import { rematchList, type OwnedList } from '../core/inventory/stock';
import { PARTS } from '../core/parts/catalog';
import type { LibraryState } from './library';

/** The parts lists of the sets the user owns. */
export interface Inventory {
  readonly lists: readonly OwnedList[];
}

export const INVENTORY_KEY = 'brickbench:owned-parts:v1';
export const MAX_LISTS = 200;
export const MAX_COPIES = 99;
export const MAX_NAME = 80;
/** Lots and left-out lines one list may keep: a whole collection fits, a damaged entry cannot grow without end. */
const MAX_LOTS = 20_000;
const MAX_UNMATCHED = 5_000;

const quantity = z.number().int().min(1).max(MAX_QUANTITY);
const lotSchema = z.object({ part: z.string().regex(/^[0-9a-z_-]{1,40}$/), colour: z.number().int().min(0).max(99_999), quantity });
const unmatchedSchema = z.object({
  part: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/),
  colour: z.number().int().min(-1).max(99_999_999),
  quantity,
  reason: z.enum(['part', 'colour']),
});
const listSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(MAX_NAME),
  catalogue: z.enum(['rebrickable', 'bricklink']),
  copies: z.number().int().min(1).max(MAX_COPIES),
  lots: z.array(lotSchema).max(MAX_LOTS),
  unmatched: z.array(unmatchedSchema).max(MAX_UNMATCHED),
});
const storedSchema = z.object({ lists: z.array(z.unknown()).max(MAX_LISTS) });

const EMPTY: Inventory = { lists: [] };

/** Keeps a name on one short line; a list always has one. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim() || 'Parts list';
}

/** A name from a file's: "42693-1.csv" → "42693-1", "my_parts.xml" → "my parts". */
export function nameFromFile(fileName: string): string {
  return cleanName(fileName.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_]+/g, ' '));
}

/** What is usable of stored lists: each one checked on its own, so one bad list spoils nothing else. */
export function parseInventory(text: string): Inventory {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON at all: start afresh rather than fail
    return EMPTY;
  }
  const stored = storedSchema.safeParse(json);
  if (!stored.success) return EMPTY;
  const lists = stored.data.lists.flatMap((raw) => {
    const parsed = listSchema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
  return { lists };
}

/** Matches a parts list read from a file, ready to keep; `cut` says whether it was too long to keep whole. */
export function ownedListFrom(file: PartsListFile, name: string, numbers: PartNumbers, id: string): { readonly list: OwnedList; readonly cut: boolean } {
  const { lots, unmatched } = matchList(file, numbers);
  const list: OwnedList = { id, name: cleanName(name), catalogue: file.catalogue, copies: 1, lots: lots.slice(0, MAX_LOTS), unmatched: unmatched.slice(0, MAX_UNMATCHED) };
  return { list, cut: lots.length > MAX_LOTS || unmatched.length > MAX_UNMATCHED };
}

/** Whether a list is one the store keeps and reads back: the same check stored lists get. */
export function isStorable(list: OwnedList): boolean {
  return listSchema.safeParse(list).success;
}

/** How many parts a list holds, and how many of them BrickBench cannot build with. */
export function listSize(list: Pick<OwnedList, 'lots' | 'unmatched'>): { readonly usable: number; readonly unusable: number } {
  const sum = (items: readonly { readonly quantity: number }[]): number => items.reduce((n, item) => n + item.quantity, 0);
  return { usable: sum(list.lots), unusable: sum(list.unmatched) };
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
/** Where the browser reports changes other tabs make to storage: `window`. */
type StorageEvents = Pick<EventTarget, 'addEventListener'>;

function read(storage: Storage | null): Inventory {
  let text: string | null | undefined;
  try {
    text = storage?.getItem(INVENTORY_KEY);
  } catch {
    // blocked storage: start with no lists
    return EMPTY;
  }
  return text ? parseInventory(text) : EMPTY;
}

export interface InventoryStore {
  readonly store: StoreApi<Inventory>;
  /**
   * Each change answers whether it was kept in this browser; when not, it
   * still counts until the page closes. A list past the limits (see
   * isStorable, MAX_LISTS) is not added at all.
   */
  addList(list: OwnedList): boolean;
  removeList(id: string): boolean;
  setCopies(id: string, copies: number): boolean;
  renameList(id: string, name: string): boolean;
  /** Matches every list's left-out parts again, as once the library has loaded; whether any list changed. */
  rematch(numbers: PartNumbers): boolean;
}

/**
 * The user's parts lists, kept in this browser. With `events`, changes made
 * in another tab show up here too.
 */
export function createInventory(storage: Storage | null, events: StorageEvents | null = null): InventoryStore {
  const store = createStore<Inventory>(() => read(storage));
  events?.addEventListener('storage', (event) => {
    // a null key means the other tab cleared all storage
    const key = (event as Partial<StorageEvent>).key;
    if (key === INVENTORY_KEY || key === null) store.setState(read(storage), true);
  });
  const update = (lists: readonly OwnedList[]): boolean => {
    store.setState({ lists }, true);
    try {
      storage?.setItem(INVENTORY_KEY, JSON.stringify({ lists }));
      return storage !== null;
    } catch {
      // storage is full or blocked: the lists still work for this visit
      return false;
    }
  };
  const change = (id: string, edit: (list: OwnedList) => OwnedList): boolean =>
    update(store.getState().lists.map((list) => (list.id === id ? edit(list) : list)));
  return {
    store,
    addList: (list) => {
      const { lists } = store.getState();
      return lists.length < MAX_LISTS && isStorable(list) && update([...lists, list]);
    },
    removeList: (id) => update(store.getState().lists.filter((list) => list.id !== id)),
    setCopies: (id, copies) => change(id, (list) => ({ ...list, copies: Math.min(Math.max(Math.round(copies) || 1, 1), MAX_COPIES) })),
    renameList: (id, name) => change(id, (list) => ({ ...list, name: cleanName(name) })),
    rematch: (numbers) => {
      const { lists } = store.getState();
      const next = lists.map((list) => rematchList(list, numbers));
      if (next.every((list, i) => list === lists[i])) return false;
      update(next);
      return true;
    },
  };
}

/**
 * Matches the lists again whenever the library finishes loading: a list
 * added while it could not load, or before the library grew, gains the
 * parts it can now build with.
 */
export function startInventoryMatching(library: StoreApi<LibraryState>, lists: Pick<InventoryStore, 'rematch'> = inventory): () => void {
  const matchAgain = (state: LibraryState): void => {
    if (state.status === 'ready') lists.rematch(partNumbersOf(PARTS, state.entries, state.aliases));
  };
  matchAgain(library.getState());
  return library.subscribe((state, previous) => {
    if (state.status !== previous.status) matchAgain(state);
  });
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const inventory = createInventory(browserStorage(), typeof window === 'undefined' ? null : window);

export function useInventory<T>(selector: (state: Inventory) => T): T {
  return useStore(inventory.store, selector);
}
