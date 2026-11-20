import type { StoreApi } from 'zustand/vanilla';
import { parseDocument } from '../core/io/modelFile';
import type { IdFactory } from '../core/model/ids';
import type { PartLookup } from '../core/parts/types';
import { readAutosaveText } from './persistence';
import { checkForBackup, keepBackup } from './sessionBackup';
import type { EditorState } from './types';

/** How long startup waits for the parts library before opening the model without it. */
export const LIBRARY_WAIT_MS = 15_000;

export interface SessionDeps {
  readonly store: StoreApi<EditorState>;
  readonly lookup: PartLookup;
  readonly nextId: IdFactory;
  /** Loads the LDraw library; only called when the saved model uses it. */
  readonly loadLibrary: () => Promise<unknown>;
  readonly usesLibrary: (text: string) => boolean;
  readonly waitMs?: number;
}

function withTimeout(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    work.then(
      () => resolve(),
      () => resolve(),
    ).finally(() => clearTimeout(timer));
  });
}

/** Tells the user part of their session is missing, keeping the whole of it to recover later. */
function keepCopy(store: StoreApi<EditorState>, text: string, problem: string): void {
  const next =
    keepBackup(text) === 'stored'
      ? 'A full copy is kept: choose File › Recover earlier session to open it.'
      : 'Browser storage is too full to keep a copy, so autosave is paused to protect it. Choose File › Recover earlier session, or save to a file.';
  store.getState().toast(`${problem} ${next}`, 'error');
}

/**
 * How a restore went: the autosaved model back whole, none to restore, or
 * one back only in part or not at all. Only a model back whole may go on
 * saving over its copy online.
 */
export type Restored = 'whole' | 'none' | 'partly';

function restoreText(deps: SessionDeps, text: string): Restored {
  const { store } = deps;
  const result = parseDocument(text, deps.lookup, deps.nextId);
  if (!result.ok) {
    store.getState().toast('Your last session could not be restored, so a fresh model was started.', 'error');
    return 'partly';
  }
  const { doc, warnings, skippedBricks } = result.value;
  store.getState().loadDocument(doc);
  if (skippedBricks > 0) {
    const bricks = skippedBricks === 1 ? '1 brick' : `${skippedBricks} bricks`;
    keepCopy(store, text, `${bricks} from your last session could not be restored.`);
  }
  for (const warning of warnings) store.getState().toast(warning, 'info');
  return skippedBricks > 0 ? 'partly' : 'whole';
}

/**
 * Reopens the model autosaved in this browser. When it uses LDraw library
 * parts the library is loaded first, since parts the editor does not know
 * are dropped. If bricks are lost anyway (the library is unreachable, or a
 * part changed size), the full session is kept for File › Recover.
 */
export async function restoreSession(deps: SessionDeps): Promise<Restored> {
  const { store } = deps;
  checkForBackup();
  const saved = readAutosaveText();
  if (saved.status === 'empty') return 'none';
  if (saved.status === 'failed') {
    store.getState().toast('Your last session could not be restored, so a fresh model was started.', 'error');
    return 'partly';
  }
  if (deps.usesLibrary(saved.text)) await withTimeout(deps.loadLibrary(), deps.waitMs ?? LIBRARY_WAIT_MS);
  try {
    return restoreText(deps, saved.text);
  } catch {
    keepCopy(store, saved.text, 'Your last session could not be restored.');
    return 'partly';
  }
}
