import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { AUTOSAVE_BACKUP_KEY, pauseAutosave, resumeAutosave } from './persistence';

/** Whether a copy of an earlier session is waiting to be recovered. */
export const backupStore = createStore<{ readonly available: boolean }>(() => ({ available: false }));

/** A copy browser storage had no room for: it lives as long as the page, with autosave paused. */
let inMemory: string | null = null;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Keeps the text of a session that could not be restored in full, so the
 * next autosave cannot destroy it. If browser storage has no room for the
 * copy, it is held in memory instead and autosave is paused, which leaves
 * the stored session untouched until it is recovered.
 */
export function keepBackup(text: string): 'stored' | 'held' {
  backupStore.setState({ available: true });
  try {
    const store = storage();
    if (!store) throw new Error('Storage is unavailable');
    store.setItem(AUTOSAVE_BACKUP_KEY, text);
    return 'stored';
  } catch {
    inMemory = text;
    pauseAutosave();
    return 'held';
  }
}

export function readBackup(): string | null {
  try {
    return inMemory ?? storage()?.getItem(AUTOSAVE_BACKUP_KEY) ?? null;
  } catch {
    return inMemory;
  }
}

/** Forgets the copy once it is recovered, and lets autosave carry on. */
export function discardBackup(): void {
  inMemory = null;
  resumeAutosave();
  try {
    storage()?.removeItem(AUTOSAVE_BACKUP_KEY);
  } catch {
    // a copy that cannot be removed does no harm; it just stays recoverable
  }
  backupStore.setState({ available: readBackup() !== null });
}

/** Picks up a copy kept by an earlier visit. */
export function checkForBackup(): void {
  backupStore.setState({ available: readBackup() !== null });
}

export function useBackupAvailable(): boolean {
  return useStore(backupStore, (s) => s.available);
}
