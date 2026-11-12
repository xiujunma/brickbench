import type { StoreApi } from 'zustand/vanilla';
import { LDRAW_PREFIX } from '../core/ldraw/catalogIndex';
import type { MeshStore } from '../engine/meshStore';
import { partLibrary } from './library';
import type { EditorState } from './types';

/** One notice per burst: when the connection drops, dozens of parts fail at once. */
export const FAILURE_QUIET_MS = 10_000;

/** Tries failed library parts again when the browser comes back online. */
export function retryWhenOnline(
  meshes: Pick<MeshStore, 'retryFailed'> = partLibrary.meshes,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  const retry = (): void => meshes.retryFailed();
  target.addEventListener('online', retry);
  return () => target.removeEventListener('online', retry);
}

/** Tells the user when library parts fail to load and are drawn as plain boxes instead. */
export function watchLibraryFailures(
  store: StoreApi<EditorState>,
  meshes: Pick<MeshStore, 'onFailure'> = partLibrary.meshes,
  now: () => number = () => Date.now(),
): () => void {
  let last = -Infinity;
  return meshes.onFailure((partId) => {
    if (now() - last < FAILURE_QUIET_MS) return;
    last = now();
    const number = partId.startsWith(LDRAW_PREFIX) ? partId.slice(LDRAW_PREFIX.length) : partId;
    store.getState().toast(`LDraw part ${number} could not be loaded, so it is shown as a plain box.`, 'error');
  });
}
