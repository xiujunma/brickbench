/** Immutable undo/redo stack of snapshots. */
export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
}

export const DEFAULT_HISTORY_LIMIT = 200;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Records a new present; pushing the current value again is a no-op. */
export function pushHistory<T>(history: History<T>, next: T, limit = DEFAULT_HISTORY_LIMIT): History<T> {
  if (Object.is(next, history.present)) return history;
  const past = [...history.past, history.present];
  return { past: past.slice(Math.max(0, past.length - limit)), present: next, future: [] };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}

/**
 * Folds every step taken since `snapshot` into one, so a single undo goes
 * back to it, as after an agent's whole request. Unchanged when the snapshot
 * is no longer in the past: undone, or dropped off the end of the history.
 */
export function squashSince<T>(history: History<T>, snapshot: T): History<T> {
  const at = history.past.lastIndexOf(snapshot);
  if (at === -1 || at === history.past.length - 1) return history;
  return { ...history, past: history.past.slice(0, at + 1) };
}
