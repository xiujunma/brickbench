import type { StoreApi } from 'zustand/vanilla';
import { serializeDocument } from '../core/io/modelFile';
import type { EditorState } from './types';

export const AUTOSAVE_KEY = 'brickbench:autosave:v1';
/** Where an autosave goes when restoring it would lose bricks, so it is never silently overwritten. */
export const AUTOSAVE_BACKUP_KEY = 'brickbench:autosave:backup:v1';
const AUTOSAVE_DELAY_MS = 600;

/** While set, autosave leaves the stored session alone (see sessionBackup). */
let paused = false;

/** Stops autosave from overwriting the stored session, e.g. one that could not be restored or copied. */
export function pauseAutosave(): void {
  paused = true;
}

export function resumeAutosave(): void {
  paused = false;
}

export function isAutosavePaused(): boolean {
  return paused;
}

export type SavedText =
  | { readonly status: 'empty' }
  | { readonly status: 'found'; readonly text: string }
  | { readonly status: 'failed'; readonly reason: string };

/** The raw text of the last autosave in this browser, if there is one. */
export function readAutosaveText(): SavedText {
  try {
    const text = window.localStorage.getItem(AUTOSAVE_KEY);
    return text ? { status: 'found', text } : { status: 'empty' };
  } catch (error: unknown) {
    return { status: 'failed', reason: error instanceof Error ? error.message : 'Storage is unavailable' };
  }
}

/**
 * Saves the model to local storage shortly after every change, and when the
 * page is hidden. Only this tab's own edits trigger a write, so closing an
 * idle tab never overwrites work saved by another tab.
 */
export function startAutosave(store: StoreApi<EditorState>): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let warned = false;

  const write = (): void => {
    if (!dirty || paused) return;
    const state = store.getState();
    try {
      window.localStorage.setItem(
        AUTOSAVE_KEY,
        serializeDocument({ name: state.name, model: state.history.present, settings: state.settings }),
      );
      dirty = false;
      state.markSaved(Date.now());
    } catch {
      if (warned) return;
      warned = true;
      state.toast('Autosave failed because browser storage is full or blocked. Save to a file to keep your work.', 'error');
    }
  };

  const unsubscribe = store.subscribe((state, previous) => {
    const changed =
      state.history.present !== previous.history.present ||
      state.name !== previous.name ||
      state.settings !== previous.settings;
    if (!changed) return;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(write, AUTOSAVE_DELAY_MS);
  });

  const flush = (): void => {
    clearTimeout(timer);
    write();
  };
  window.addEventListener('pagehide', flush);

  return () => {
    unsubscribe();
    window.removeEventListener('pagehide', flush);
    clearTimeout(timer);
  };
}
