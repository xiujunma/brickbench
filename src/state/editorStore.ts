import { useStore } from 'zustand';
import { createIdFactory } from '../core/model/ids';
import { getPart } from '../core/parts/catalog';
import { partLibrary, usesLibraryParts } from './library';
import { restoreSession, type Restored } from './session';
import { createEditorStore } from './store';
import type { EditorState } from './types';

/** Ids for new bricks, shared by everything that adds bricks to the editor. */
export const nextId = createIdFactory();

/** The app-wide editor store. */
export const editorStore = createEditorStore({ lookup: getPart, nextId });

/** Reopens this browser's autosave, loading the LDraw library first when the model needs it. */
export function restoreLastSession(): Promise<Restored> {
  return restoreSession({
    store: editorStore,
    lookup: getPart,
    nextId,
    loadLibrary: () => partLibrary.load(),
    usesLibrary: usesLibraryParts,
  });
}

export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useStore(editorStore, selector);
}
