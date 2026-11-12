import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { z } from 'zod';
import type { EditorState } from './types';

/** Parts you picked lately, newest first, and parts you starred. */
export interface PartPicks {
  readonly recent: readonly string[];
  readonly favourites: readonly string[];
}

export const RECENT_LIMIT = 12;
/** Far more than anyone stars; it stops a damaged entry growing without end. */
export const FAVOURITES_LIMIT = 1000;
export const PICKS_KEY = 'brickbench:part-picks:v1';

const partId = z.string().min(1).max(64);
/** What is usable of a stored list: part ids, each once, in order. One bad item spoils nothing else. */
const idList = z
  .array(z.unknown())
  .catch([])
  .transform((items) => [...new Set(items.filter((item): item is string => partId.safeParse(item).success))]);
const picksSchema = z.object({ recent: idList, favourites: idList });

const EMPTY: PartPicks = { recent: [], favourites: [] };

/** Moves a part to the front of the recent list, keeping it short. */
export function withRecent(picks: PartPicks, id: string): PartPicks {
  if (picks.recent[0] === id) return picks;
  return { ...picks, recent: [id, ...picks.recent.filter((r) => r !== id)].slice(0, RECENT_LIMIT) };
}

/** Stars a part, or unstars it if it already was; past the limit the oldest star goes. */
export function toggledFavourite(picks: PartPicks, id: string): PartPicks {
  const starred = picks.favourites.includes(id);
  const favourites = starred ? picks.favourites.filter((f) => f !== id) : [...picks.favourites, id].slice(-FAVOURITES_LIMIT);
  return { ...picks, favourites };
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
/** Where the browser reports changes other tabs make to storage: `window`. */
type StorageEvents = Pick<EventTarget, 'addEventListener'>;

function parsePicks(text: string): PartPicks {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON at all: start afresh rather than fail
    return EMPTY;
  }
  const parsed = picksSchema.safeParse(json);
  if (!parsed.success) return EMPTY;
  return { recent: parsed.data.recent.slice(0, RECENT_LIMIT), favourites: parsed.data.favourites.slice(0, FAVOURITES_LIMIT) };
}

function read(storage: Storage | null): PartPicks {
  let text: string | null | undefined;
  try {
    text = storage?.getItem(PICKS_KEY);
  } catch {
    // blocked storage: start with empty lists
    return EMPTY;
  }
  return text ? parsePicks(text) : EMPTY;
}

export interface PartPicksStore {
  readonly store: StoreApi<PartPicks>;
  notePicked(id: string): void;
  toggleFavourite(id: string): void;
}

/**
 * Recent and favourite parts, kept in this browser. They are a convenience:
 * if storage is blocked they still work until the page closes. With
 * `events`, changes made in another tab show up here too.
 */
export function createPartPicks(storage: Storage | null, events: StorageEvents | null = null): PartPicksStore {
  const store = createStore<PartPicks>(() => read(storage));
  events?.addEventListener('storage', (event) => {
    // a null key means the other tab cleared all storage
    const key = (event as Partial<StorageEvent>).key;
    if (key === PICKS_KEY || key === null) store.setState(read(storage), true);
  });
  const update = (next: PartPicks): void => {
    if (next === store.getState()) return;
    store.setState(next, true);
    try {
      storage?.setItem(PICKS_KEY, JSON.stringify(next));
    } catch {
      // storage is full or blocked: the lists still work for this visit
    }
  };
  return {
    store,
    notePicked: (id) => update(withRecent(store.getState(), id)),
    toggleFavourite: (id) => update(toggledFavourite(store.getState(), id)),
  };
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const partPicks = createPartPicks(browserStorage(), typeof window === 'undefined' ? null : window);

export function usePartPicks<T>(selector: (picks: PartPicks) => T): T {
  return useStore(partPicks.store, selector);
}

/** Records every part the editor starts building with, from the panel, a shortcut or the eyedropper. */
export function startPartPicks(editor: StoreApi<EditorState>, picks: Pick<PartPicksStore, 'notePicked'> = partPicks): () => void {
  return editor.subscribe((state, previous) => {
    if (state.activePartId !== previous.activePartId) picks.notePicked(state.activePartId);
  });
}
