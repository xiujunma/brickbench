import { createStore, type StoreApi } from 'zustand/vanilla';
import { DEFAULT_COLOR_ID, getColor } from '../core/colors';
import { normalizeRotation, type Vec3 } from '../core/grid';
import { createHistory, pushHistory, redo, undo } from '../core/history';
import { DEFAULT_SCENE } from '../core/io/modelFile';
import { rotateGroup } from '../core/model/geometry';
import type { IdFactory } from '../core/model/ids';
import { addBricks, emptyModel, recolorBricks, removeBricks, replaceBricks } from '../core/model/model';
import type { Model } from '../core/model/types';
import { DEFAULT_PART_ID } from '../core/parts/catalog';
import type { PartLookup } from '../core/parts/types';
import { materialize, payloadFromBricks, payloadFromPart, rotatePayload, type Payload } from '../core/placement/payload';
import { bricksFit, selectedBricks } from './selectors';
import type { EditorData, EditorState, SelectMode, ToastTone } from './types';

export const DEFAULT_NAME = 'Untitled model';
const MAX_NAME_LENGTH = 120;
const MAX_TOASTS = 4;
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

export interface StoreDeps {
  readonly lookup: PartLookup;
  readonly nextId: IdFactory;
}

export function initialData(): EditorData {
  return {
    name: DEFAULT_NAME,
    settings: DEFAULT_SCENE,
    history: createHistory(emptyModel()),
    selection: EMPTY_SELECTION,
    tool: 'build',
    activePartId: DEFAULT_PART_ID,
    activeColorId: DEFAULT_COLOR_ID,
    buildRotation: 0,
    clipboard: null,
    pastePayload: null,
    cursor: null,
    hoverBrickId: null,
    placementValid: null,
    toasts: [],
    dialog: null,
    lastSavedAt: null,
  };
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** Drops selected ids that no longer exist in the model. */
function pruneSelection(selection: ReadonlySet<string>, model: Model): ReadonlySet<string> {
  const kept = [...selection].filter((id) => model.bricks.has(id));
  if (kept.length === selection.size) return selection;
  return kept.length === 0 ? EMPTY_SELECTION : new Set(kept);
}

function applySelection(current: ReadonlySet<string>, ids: readonly string[], mode: SelectMode): ReadonlySet<string> {
  if (mode === 'replace') return new Set(ids);
  const next = new Set(current);
  for (const id of ids) {
    if (mode === 'toggle' && next.has(id)) next.delete(id);
    else next.add(id);
  }
  return next;
}

function sameVec(a: Vec3 | null, b: Vec3 | null): boolean {
  return a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.z === b.z);
}

export function createEditorStore(deps: StoreDeps, initial: Partial<EditorData> = {}): StoreApi<EditorState> {
  const { lookup, nextId } = deps;
  let toastCounter = 0;

  return createStore<EditorState>()((set, get) => {
    const model = (): Model => get().history.present;

    /** Records a new model snapshot (if it changed) together with any other state. */
    const commit = (next: Model, extra: Partial<EditorData> = {}): void => {
      const state = get();
      const changed = next !== state.history.present;
      if (!changed && Object.keys(extra).length === 0) return;
      const selection = pruneSelection(extra.selection ?? state.selection, next);
      set({
        ...extra,
        ...(changed ? { history: pushHistory(state.history, next) } : {}),
        selection,
      });
    };

    const toast = (message: string, tone: ToastTone = 'info'): void => {
      toastCounter += 1;
      const entry = { id: toastCounter, message, tone };
      set((s) => ({ toasts: [...s.toasts, entry].slice(-MAX_TOASTS) }));
    };

    const buildPayload = (): Payload | null => {
      const state = get();
      if (state.pastePayload) return state.pastePayload;
      const part = lookup(state.activePartId);
      return part ? payloadFromPart(part, state.activeColorId, state.buildRotation) : null;
    };

    return {
      ...initialData(),
      ...initial,

      setTool: (tool) =>
        set((s) =>
          s.tool === tool
            ? s
            : { tool, pastePayload: tool === 'build' ? s.pastePayload : null, hoverBrickId: null, placementValid: null },
        ),

      setActivePart: (partId) => {
        if (!lookup(partId)) return;
        set({ activePartId: partId, tool: 'build', pastePayload: null });
      },

      setActiveColor: (colorId) => {
        if (!getColor(colorId)) return;
        const { selection } = get();
        if (selection.size === 0) set({ activeColorId: colorId });
        else commit(recolorBricks(model(), selection, colorId), { activeColorId: colorId });
      },

      rotateBuild: (dir) =>
        set((s) =>
          s.pastePayload
            ? { pastePayload: rotatePayload(s.pastePayload, lookup, dir) }
            : { buildRotation: normalizeRotation(s.buildRotation + dir) },
        ),

      placePayload: (offset) => {
        const payload = buildPayload();
        if (!payload) return false;
        const bricks = materialize(payload, offset, nextId);
        if (!bricksFit(model(), bricks, lookup)) {
          toast('There is no room for that there.', 'error');
          return false;
        }
        const next = addBricks(model(), bricks);
        if (get().pastePayload) {
          commit(next, { selection: new Set(bricks.map((b) => b.id)), pastePayload: null, tool: 'select' });
        } else {
          commit(next);
        }
        return true;
      },

      select: (ids, mode) =>
        set((s) => {
          const known = ids.filter((id) => model().bricks.has(id));
          const selection = applySelection(s.selection, known, mode);
          return sameSet(selection, s.selection) ? s : { selection };
        }),

      clearSelection: () => set((s) => (s.selection.size === 0 ? s : { selection: EMPTY_SELECTION })),

      selectAll: () => set({ selection: new Set(model().bricks.keys()), tool: 'select', pastePayload: null }),

      deleteSelection: () => {
        const { selection } = get();
        if (selection.size > 0) commit(removeBricks(model(), selection), { selection: EMPTY_SELECTION });
      },

      eraseBrick: (id) => commit(removeBricks(model(), [id])),

      paintBrick: (id) => commit(recolorBricks(model(), [id], get().activeColorId)),

      eyedrop: (id) => {
        const brick = model().bricks.get(id);
        if (!brick) return;
        set({
          activePartId: brick.partId,
          activeColorId: brick.colorId,
          buildRotation: brick.r,
          tool: 'build',
          pastePayload: null,
        });
      },

      moveSelection: (delta) => {
        const state = get();
        const selected = selectedBricks(state);
        if (selected.length === 0) return false;
        const moved = selected.map((b) => ({ ...b, x: b.x + delta.x, y: b.y + delta.y, z: b.z + delta.z }));
        if (!bricksFit(model(), moved, lookup, state.selection)) return false;
        commit(replaceBricks(model(), moved));
        return true;
      },

      rotateSelection: (dir) => {
        const state = get();
        const selected = selectedBricks(state);
        if (selected.length === 0) return false;
        const turned = rotateGroup(selected, lookup, dir);
        if (!bricksFit(model(), turned, lookup, state.selection)) return false;
        commit(replaceBricks(model(), turned));
        return true;
      },

      applyBricks: (bricks) => {
        if (bricks.length === 0 || bricks.some((b) => !model().bricks.has(b.id))) return false;
        if (!bricksFit(model(), bricks, lookup, new Set(bricks.map((b) => b.id)))) return false;
        commit(replaceBricks(model(), bricks));
        return true;
      },

      copySelection: () => {
        const selected = selectedBricks(get());
        if (selected.length === 0) return false;
        set({ clipboard: payloadFromBricks(selected, lookup) });
        return true;
      },

      cutSelection: () => {
        if (!get().copySelection()) return false;
        get().deleteSelection();
        return true;
      },

      paste: () => {
        const { clipboard } = get();
        if (!clipboard) return false;
        set({ pastePayload: clipboard, tool: 'build', selection: EMPTY_SELECTION });
        return true;
      },

      duplicateSelection: () => get().copySelection() && get().paste(),

      undo: () =>
        set((s) => {
          const history = undo(s.history);
          return history === s.history ? s : { history, selection: pruneSelection(s.selection, history.present) };
        }),

      redo: () =>
        set((s) => {
          const history = redo(s.history);
          return history === s.history ? s : { history, selection: pruneSelection(s.selection, history.present) };
        }),

      newModel: () =>
        set({
          history: createHistory(emptyModel()),
          name: DEFAULT_NAME,
          settings: DEFAULT_SCENE,
          selection: EMPTY_SELECTION,
          pastePayload: null,
          lastSavedAt: null,
        }),

      loadDocument: (doc) =>
        set({
          history: createHistory(doc.model),
          name: doc.name.trim() || DEFAULT_NAME,
          settings: doc.settings,
          selection: EMPTY_SELECTION,
          pastePayload: null,
        }),

      setName: (name) => {
        const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
        set({ name: clean || DEFAULT_NAME });
      },

      setBaseplate: (size, colorId) =>
        set((s) => ({
          settings: { baseplateSize: size, baseplateColor: getColor(colorId) ? colorId : s.settings.baseplateColor },
        })),

      setCursor: (cursor) => set((s) => (sameVec(s.cursor, cursor) ? s : { cursor })),
      setHover: (brickId) => set((s) => (s.hoverBrickId === brickId ? s : { hoverBrickId: brickId })),
      setPlacementValid: (valid) => set((s) => (s.placementValid === valid ? s : { placementValid: valid })),

      toast,
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      openDialog: (dialog) => set({ dialog }),
      closeDialog: (dialog) => set((s) => (s.dialog === null || (dialog && s.dialog !== dialog) ? s : { dialog: null })),
      markSaved: (at) => set({ lastSavedAt: at }),
    };
  });
}
