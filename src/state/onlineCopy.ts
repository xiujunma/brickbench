/**
 * Which model kept online the open model is, so saving it online again
 * saves over that one, following on from the revision opened or last saved.
 * Opening or starting another model lets go of it. It is kept with the
 * autosave (./persistence.ts), so a reload still knows.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { History } from '../core/history';
import type { Model } from '../core/model/types';
import type { EditorState } from './types';

export interface OnlineCopy {
  readonly id: string;
  /** The revision the open model follows on from. */
  readonly revision: number;
  /** The account it belongs to: saving over it is only for them. */
  readonly owner: string;
}

export const ONLINE_COPY_KEY = 'brickbench:online-copy:v1';

export const onlineCopyStore = createStore<{ readonly copy: OnlineCopy | null }>(() => ({ copy: null }));

export function onlineCopy(): OnlineCopy | null {
  return onlineCopyStore.getState().copy;
}

export function setOnlineCopy(copy: OnlineCopy | null): void {
  onlineCopyStore.setState({ copy });
}

/** Whether `next` starts another model rather than going on with `previous`: opening and new models start histories afresh. */
export function startsAnotherModel(next: History<Model>, previous: History<Model>): boolean {
  return next !== previous && next.past.length === 0 && next.future.length === 0 && next.present !== previous.present;
}

/** Lets go of the online copy whenever another model takes the open one's place. */
export function followOpenModel(store: StoreApi<EditorState>): () => void {
  return store.subscribe((state, previous) => {
    if (startsAnotherModel(state.history, previous.history)) setOnlineCopy(null);
  });
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isCopy(value: unknown): value is OnlineCopy {
  if (typeof value !== 'object' || value === null) return false;
  const { id, revision, owner } = value as Record<string, unknown>;
  return typeof id === 'string' && typeof owner === 'string' && typeof revision === 'number' && Number.isInteger(revision) && revision > 0;
}

/** The online copy kept with the autosave; null when there is none, or it cannot be read. */
export function readOnlineCopy(storage: Storage): OnlineCopy | null {
  try {
    const stored: unknown = JSON.parse(storage.getItem(ONLINE_COPY_KEY) ?? 'null');
    return isCopy(stored) ? { id: stored.id, revision: stored.revision, owner: stored.owner } : null;
  } catch {
    return null;
  }
}

/** Keeps the online copy with the autosave written now, or forgets it. */
export function writeOnlineCopy(storage: Storage, copy: OnlineCopy | null): void {
  if (copy === null) storage.removeItem(ONLINE_COPY_KEY);
  else storage.setItem(ONLINE_COPY_KEY, JSON.stringify(copy));
}

/** At start-up: the online copy the autosave kept, if the model came back whole; none otherwise. */
export function restoreOnlineCopy(whole: boolean): void {
  try {
    setOnlineCopy(whole ? readOnlineCopy(window.localStorage) : null);
  } catch {
    // storage blocked: the model is not known to be online
    setOnlineCopy(null);
  }
}
