import { describe, expect, it } from 'bun:test';
import { DEFAULT_SCENE } from '../core/io/modelFile';
import { allBricks, modelFromBricks } from '../core/model/model';
import { brickConnectors } from '../core/model/connections';
import { brickCellBox } from '../core/model/geometry';
import { connectorLookup } from '../core/model/connectorTestParts';
import { makeBrick } from '../core/model/testUtils';
import type { Brick } from '../core/model/types';
import { turnAbout } from '../core/orientation';
import { getPart } from '../core/parts/catalog';
import { createEditorStore } from './store';
import type { EditorState } from './types';

function setup() {
  let n = 0;
  const store = createEditorStore({ lookup: getPart, nextId: () => `id${n++}` });
  const state = (): EditorState => store.getState();
  const bricks = () => allBricks(state().history.present);
  return { store, state, bricks };
}

function withBricks(...list: ReturnType<typeof makeBrick>[]) {
  const ctx = setup();
  ctx.state().loadDocument({ name: 'test', settings: DEFAULT_SCENE, model: modelFromBricks(list) });
  return ctx;
}

describe('building', () => {
  it('starts ready to build with an empty model', () => {
    const { state, bricks } = setup();
    expect(state().tool).toBe('build');
    expect(bricks()).toEqual([]);
  });

  it('places the active part and undoes and redoes it', () => {
    const { state, bricks } = setup();
    state().setActivePart('brick-2x2');
    expect(state().placePayload({ x: 1, y: 0, z: 2 })).toBe(true);
    expect(bricks()).toEqual([expect.objectContaining({ partId: 'brick-2x2', x: 1, z: 2, colorId: 4 })]);
    state().undo();
    expect(bricks()).toEqual([]);
    state().redo();
    expect(bricks()).toHaveLength(1);
  });

  it('refuses occupied spots and says why', () => {
    const { state, bricks } = setup();
    state().placePayload({ x: 0, y: 0, z: 0 });
    expect(state().placePayload({ x: 1, y: 0, z: 0 })).toBe(false);
    expect(bricks()).toHaveLength(1);
    expect(state().toasts.at(-1)?.tone).toBe('error');
  });

  it('turns the part being built', () => {
    const { state } = setup();
    state().rotateBuild(-1);
    expect(state().buildRotation).toBe(3);
  });

  it('ignores unknown parts and colours', () => {
    const { state } = setup();
    state().setActivePart('nope');
    state().setActiveColor(-5);
    expect(state().activePartId).toBe('brick-2x4');
    expect(state().activeColorId).toBe(4);
  });
});

describe('selection', () => {
  it('replaces, adds and toggles selections, ignoring unknown ids', () => {
    const { state } = withBricks(makeBrick({ id: 'a' }), makeBrick({ id: 'b', x: 4 }));
    state().select(['a', 'ghost'], 'replace');
    expect([...state().selection]).toEqual(['a']);
    state().select(['b'], 'add');
    expect(state().selection.size).toBe(2);
    state().select(['a'], 'toggle');
    expect([...state().selection]).toEqual(['b']);
    state().clearSelection();
    expect(state().selection.size).toBe(0);
    state().selectAll();
    expect(state().selection.size).toBe(2);
  });

  it('recolours the selection when a colour is picked', () => {
    const { state, bricks } = withBricks(makeBrick({ id: 'a' }));
    state().select(['a'], 'replace');
    state().setActiveColor(1);
    expect(bricks()[0]?.colorId).toBe(1);
    expect(state().activeColorId).toBe(1);
    state().undo();
    expect(bricks()[0]?.colorId).toBe(4);
  });

  it('only changes the build colour when nothing is selected', () => {
    const { state, bricks } = withBricks(makeBrick({ id: 'a' }));
    state().setActiveColor(14);
    expect(bricks()[0]?.colorId).toBe(4);
    expect(state().history.past).toHaveLength(0);
  });

  it('moves the selection unless something is in the way', () => {
    const { state, bricks } = withBricks(makeBrick({ id: 'a' }), makeBrick({ id: 'b', x: 5 }));
    state().select(['a'], 'replace');
    expect(state().moveSelection({ x: 1, y: 0, z: 0 })).toBe(true);
    expect(state().moveSelection({ x: 1, y: 0, z: 0 })).toBe(false);
    expect(state().moveSelection({ x: 0, y: -1, z: 0 })).toBe(false);
    expect(bricks().find((b) => b.id === 'a')?.x).toBe(1);
  });

  it('rotates the selection in place', () => {
    const { state, bricks } = withBricks(makeBrick({ id: 'a', x: 4, z: 4 }));
    state().select(['a'], 'replace');
    expect(state().rotateSelection(1)).toBe(true);
    expect(bricks()[0]).toMatchObject({ r: 1, x: 5, z: 3 });
  });

  it('swings a selection hanging on a pin about the pin, 15° at a time', () => {
    let n = 0;
    const store = createEditorStore({ lookup: connectorLookup, nextId: () => `id${n++}` });
    const beam = makeBrick({ id: 'beam', partId: 'beam' });
    const pin = { id: 'pin', partId: 'pin', colorId: 4, x: 0.1, y: 0, z: 1, r: 0, m: turnAbout({ x: 0, y: 0, z: 1 }, Math.PI / 2) };
    const top = makeBrick({ id: 'top', partId: 'beam', y: 2.5, z: 1 });
    store.getState().loadDocument({ name: 'technic', settings: DEFAULT_SCENE, model: modelFromBricks([beam, pin, top]) });
    store.getState().select(['top'], 'replace');
    expect(store.getState().rotateSelection(1)).toBe(true);
    const swung = store.getState().history.present.bricks.get('top');
    // turned 15° about the upright pin, at the beam's end hole: loose, and still on the pin
    expect(swung?.m?.[0]).toBeCloseTo(Math.cos(Math.PI / 12), 9);
    expect(swung?.y).toBeCloseTo(2.5, 9);
    const [hole] = brickConnectors(swung as Brick, connectorLookup);
    expect(hole?.at.x).toBeCloseTo(0.5, 9);
    expect(hole?.at.z).toBeCloseTo(1.5, 9);
  });

  it('won’t swing a part on a hinge down through the ground', () => {
    let n = 0;
    const store = createEditorStore({ lookup: connectorLookup, nextId: () => `id${n++}` });
    // a hinge brick on the ground, the other half of the hinge flat beside it
    const fork = makeBrick({ id: 'fork', partId: 'fork' });
    const finger = { id: 'finger', partId: 'finger', colorId: 4, x: 2, y: 0, z: 0, r: 2, m: turnAbout({ x: 0, y: 1, z: 0 }, Math.PI) };
    store.getState().loadDocument({ name: 'hinge', settings: DEFAULT_SCENE, model: modelFromBricks([fork, finger]) });
    store.getState().select(['finger'], 'replace');
    const before = store.getState().history.present;
    const down = [store.getState().rotateSelection(1), store.getState().rotateSelection(-1)].indexOf(false);
    expect(down).not.toBe(-1);
    // whichever way is down was refused, and left the model as it was
    if (down === 0) expect(store.getState().history.present).toBe(before);
    for (const brick of store.getState().history.present.bricks.values()) expect(brickCellBox(brick, connectorLookup).y0).toBeGreaterThanOrEqual(0);
  });

  it('deletes the selection and keeps selections valid through undo and redo', () => {
    const { state, bricks } = withBricks(makeBrick({ id: 'a' }), makeBrick({ id: 'b', x: 4 }));
    state().select(['a', 'b'], 'replace');
    state().deleteSelection();
    expect(bricks()).toEqual([]);
    expect(state().selection.size).toBe(0);
    state().undo();
    expect(bricks()).toHaveLength(2);
    state().select(['a'], 'replace');
    state().redo();
    expect(state().selection.size).toBe(0);
  });

  it('applies dragged bricks only where they fit', () => {
    const { state, bricks } = withBricks(makeBrick({ id: 'a' }), makeBrick({ id: 'b', x: 6 }));
    expect(state().applyBricks([makeBrick({ id: 'a', x: 5 })])).toBe(false);
    expect(state().applyBricks([makeBrick({ id: 'a', y: 3, x: 6 })])).toBe(true);
    expect(bricks().find((b) => b.id === 'a')).toMatchObject({ x: 6, y: 3 });
    expect(state().applyBricks([makeBrick({ id: 'missing' })])).toBe(false);
  });
});

describe('clipboard', () => {
  it('copies, then pastes a single copy that ends up selected', () => {
    const { state, bricks } = withBricks(makeBrick({ id: 'a' }), makeBrick({ id: 'b', y: 3 }));
    state().select(['a', 'b'], 'replace');
    expect(state().copySelection()).toBe(true);
    expect(state().paste()).toBe(true);
    expect(state().tool).toBe('build');
    expect(state().pastePayload?.bricks).toHaveLength(2);
    expect(state().placePayload({ x: 10, y: 0, z: 10 })).toBe(true);
    expect(bricks()).toHaveLength(4);
    expect(state().tool).toBe('select');
    expect(state().pastePayload).toBeNull();
    expect(state().selection.size).toBe(2);
    expect([...state().selection].every((id) => id.startsWith('id'))).toBe(true);
  });

  it('cuts bricks out of the model', () => {
    const { state, bricks } = withBricks(makeBrick({ id: 'a' }));
    state().select(['a'], 'replace');
    expect(state().cutSelection()).toBe(true);
    expect(bricks()).toEqual([]);
    expect(state().clipboard).not.toBeNull();
  });

  it('does nothing without a selection or clipboard', () => {
    const { state } = setup();
    expect(state().copySelection()).toBe(false);
    expect(state().paste()).toBe(false);
    expect(state().duplicateSelection()).toBe(false);
  });

  it('duplicates the selection into a paste', () => {
    const { state } = withBricks(makeBrick({ id: 'a' }));
    state().select(['a'], 'replace');
    expect(state().duplicateSelection()).toBe(true);
    expect(state().pastePayload).not.toBeNull();
  });

  it('turns a paste while it is being placed', () => {
    const { state } = withBricks(makeBrick({ id: 'a' }));
    state().select(['a'], 'replace');
    state().duplicateSelection();
    state().rotateBuild(1);
    expect(state().pastePayload?.size).toMatchObject({ w: 2, d: 4 });
  });
});

describe('single-brick tools', () => {
  it('erases and paints bricks', () => {
    const { state, bricks } = withBricks(makeBrick({ id: 'a' }), makeBrick({ id: 'b', x: 4 }));
    state().setActiveColor(14);
    state().paintBrick('a');
    state().eraseBrick('b');
    expect(bricks()).toEqual([expect.objectContaining({ id: 'a', colorId: 14 })]);
  });

  it('eyedrops part, colour and rotation', () => {
    const { state } = withBricks(makeBrick({ id: 'a', partId: 'plate-1x6', colorId: 1, r: 3 }));
    state().setTool('select');
    state().eyedrop('a');
    expect(state()).toMatchObject({ activePartId: 'plate-1x6', activeColorId: 1, buildRotation: 3, tool: 'build' });
  });
});

describe('documents and ui state', () => {
  it('starts a new model', () => {
    const { state, bricks } = withBricks(makeBrick({ id: 'a' }));
    state().setName('Castle');
    state().newModel();
    expect(bricks()).toEqual([]);
    expect(state().name).toBe('Untitled model');
    expect(state().history.past).toHaveLength(0);
  });

  it('keeps model names tidy', () => {
    const { state } = setup();
    state().setName('  Big   red\nbarn  ');
    expect(state().name).toBe('Big red barn');
    state().setName('   ');
    expect(state().name).toBe('Untitled model');
    state().setName('x'.repeat(500));
    expect(state().name).toHaveLength(120);
  });

  it('changes the baseplate', () => {
    const { state } = setup();
    state().setBaseplate(48, 71);
    expect(state().settings).toEqual({ baseplateSize: 48, baseplateColor: 71 });
  });

  it('keeps the newest toasts and dismisses them', () => {
    const { state } = setup();
    for (let i = 0; i < 6; i++) state().toast(`t${i}`);
    expect(state().toasts.map((t) => t.message)).toEqual(['t2', 't3', 't4', 't5']);
    state().dismissToast(state().toasts[0]?.id ?? -1);
    expect(state().toasts).toHaveLength(3);
  });

  it('closes only the dialog that asked to close', () => {
    const { state } = setup();
    state().openDialog('help');
    state().closeDialog('instructions');
    expect(state().dialog).toBe('help');
    state().closeDialog('help');
    expect(state().dialog).toBeNull();
    state().openDialog('parts-list');
    state().closeDialog();
    expect(state().dialog).toBeNull();
  });

  it('does not notify listeners for no-op updates', () => {
    const { store, state } = setup();
    let calls = 0;
    store.subscribe(() => (calls += 1));
    state().clearSelection();
    state().setHover(null);
    state().setCursor(null);
    state().setPlacementValid(null);
    expect(calls).toBe(0);
  });
});

describe('changes made elsewhere', () => {
  it('records a whole new model as one step to undo, dropping gone bricks from the selection', () => {
    const { state, bricks } = withBricks(makeBrick({ id: 'a' }), makeBrick({ id: 'b', x: 4 }));
    state().select(['a', 'b'], 'replace');
    const before = state().history.present;
    state().commitModel(modelFromBricks([makeBrick({ id: 'b', x: 4 }), makeBrick({ id: 'c', y: 3 })]));
    expect(bricks().map((b) => b.id)).toEqual(['b', 'c']);
    expect([...state().selection]).toEqual(['b']);
    state().undo();
    expect(state().history.present).toBe(before);
  });

  it('folds an agent’s whole request into one step to undo', () => {
    const { state, bricks } = withBricks(makeBrick({ id: 'a' }));
    const before = state().history.present;
    state().commitModel(modelFromBricks([makeBrick({ id: 'a' }), makeBrick({ id: 'b', y: 3 })]));
    state().commitModel(modelFromBricks([makeBrick({ id: 'a' }), makeBrick({ id: 'b', y: 3 }), makeBrick({ id: 'c', y: 6 })]));
    state().squashHistorySince(before);
    expect(bricks()).toHaveLength(3);
    state().undo();
    expect(state().history.present).toBe(before);
  });

  it('leaves history alone when the model is the same', () => {
    const { state } = withBricks(makeBrick({ id: 'a' }));
    const history = state().history;
    state().commitModel(state().history.present);
    expect(state().history).toBe(history);
  });
});

describe('documents', () => {
  it('closes the report on an opened file when another model loads or a new one starts', () => {
    const { state } = setup();
    state().openDialog('import-report');
    state().loadDocument({ name: 'next', settings: DEFAULT_SCENE, model: modelFromBricks([makeBrick()]) });
    expect(state().dialog).toBeNull();
    state().openDialog('import-report');
    state().newModel();
    expect(state().dialog).toBeNull();
  });

  it('leaves other dialogs open', () => {
    const { state } = setup();
    state().openDialog('help');
    state().loadDocument({ name: 'next', settings: DEFAULT_SCENE, model: modelFromBricks([]) });
    expect(state().dialog).toBe('help');
  });
});
