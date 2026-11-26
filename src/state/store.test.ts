import { describe, expect, it } from 'bun:test';
import { DEFAULT_SCENE } from '../core/io/modelFile';
import { allBricks, modelFromBricks } from '../core/model/model';
import { brickConnectors } from '../core/model/connections';
import { brickCellBox, brickFloor } from '../core/model/geometry';
import { connectorLookup } from '../core/model/connectorTestParts';
import { makeBrick } from '../core/model/testUtils';
import type { Brick } from '../core/model/types';
import { turnAbout } from '../core/orientation';
import { getPart } from '../core/parts/catalog';
import { attachToConnector } from '../core/placement/connect';
import { materialize, payloadFromPart } from '../core/placement/payload';
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

  it('plugs the part being built in by the connection of its own chosen, until another part is', () => {
    const { state } = withBricks(makeBrick({ id: 'a', partId: 'plate-1x6' }));
    expect(state().buildVia).toBeNull();
    state().setBuildVia(2);
    expect(state().buildVia).toBe(2);
    // R and T turn it about that connection, and keep it
    state().rotateBuild(1);
    state().tipBuild('x', 1);
    expect(state().buildVia).toBe(2);
    // another part, or one picked up, goes on by whichever fits best again
    state().setActivePart('brick-2x2');
    expect(state().buildVia).toBeNull();
    state().setBuildVia(1);
    state().eyedrop('a');
    expect(state().buildVia).toBeNull();
  });

  it('pushes the part being built as far into a hole as D says, until another part is', () => {
    const { store, state } = withBricks(makeBrick({ id: 'a', partId: 'plate-1x6' }));
    expect(state().buildDepth).toBe(0);
    state().setBuildDepth(2);
    expect(state().buildDepth).toBe(2);
    // R, T and C keep it
    state().rotateBuild(1);
    state().tipBuild('x', 1);
    state().setBuildVia(1);
    expect(state().buildDepth).toBe(2);
    let calls = 0;
    store.subscribe(() => (calls += 1));
    state().setBuildDepth(2);
    expect(calls).toBe(0);
    // another part, or one picked up, goes in a stud again
    state().setActivePart('brick-2x2');
    expect(state().buildDepth).toBe(0);
    state().setBuildDepth(1);
    state().eyedrop('a');
    expect(state().buildDepth).toBe(0);
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

  it('lifts a car roof on its holder, and the top of a folding hinge plate, with R, whichever way they face', () => {
    for (const [holder, hinged] of [['roof-plate', 'roof'], ['fold-base', 'fold-top']] as const) {
      for (const r of [0, 1, 2, 3]) {
        let n = 0;
        const store = createEditorStore({ lookup: connectorLookup, nextId: () => `id${n++}` });
        // the half that holds, on the ground, and the other on it as it goes on: lying flat, low over the ground
        const base = makeBrick({ id: 'base', partId: holder, x: 10, z: 10, r });
        const [joint] = brickConnectors(base, connectorLookup);
        const part = connectorLookup(hinged);
        if (!joint || !part) throw new Error(holder);
        const on = attachToConnector({ kind: 'brick', brickId: 'base', point: joint.at, normal: { x: 0, y: 1, z: 0 }, t: 1, base: 0 }, base, payloadFromPart(part, 4, 0), { spin: 0, flipped: false }, connectorLookup, [base]);
        const [lid] = on ? materialize(on.payload, on.offset, () => 'lid') : [];
        if (!lid) throw new Error(`${hinged} did not go on`);
        store.getState().loadDocument({ name: 'hinge', settings: DEFAULT_SCENE, model: modelFromBricks([base, lid]) });
        store.getState().select(['lid'], 'replace');
        const flat = brickCellBox(lid, connectorLookup);
        // back from lying flat is down through the ground: refused, the model left as it was
        const before = store.getState().history.present;
        expect(`${hinged} ${r} back: ${store.getState().rotateSelection(-1)}`).toBe(`${hinged} ${r} back: false`);
        expect(store.getState().history.present).toBe(before);
        // R lifts it: its far edge rises, nothing of it sinks
        expect(`${hinged} ${r}: ${store.getState().rotateSelection(1)}`).toBe(`${hinged} ${r}: true`);
        const lifted = store.getState().history.present.bricks.get('lid') as Brick;
        expect(brickCellBox(lifted, connectorLookup).y1).toBeGreaterThan(flat.y1 + 1);
        // round about its hinge, it does not: only the corner of its box beyond the hinge dips
        expect(brickFloor(lifted, connectorLookup)).toBeGreaterThanOrEqual(-1e-9);
        // and ⇧R lays it back where it lay
        expect(store.getState().rotateSelection(-1)).toBe(true);
        const back = store.getState().history.present.bricks.get('lid') as Brick;
        const near = (v: number): number => Math.round(v * 1e9) / 1e9 + 0;
        expect([back.x, back.y, back.z, ...(back.m ?? [])].map(near)).toEqual([lid.x, lid.y, lid.z, ...(lid.m ?? [])].map(near));
      }
    }
  });

  it('swings a part on a hinge up off the ground, and won’t swing it down through it', () => {
    let n = 0;
    const store = createEditorStore({ lookup: connectorLookup, nextId: () => `id${n++}` });
    // a hinge brick on the ground, the other half of the hinge flat beside it
    const fork = makeBrick({ id: 'fork', partId: 'fork' });
    const finger = { id: 'finger', partId: 'finger', colorId: 4, x: 2, y: 0, z: 0, r: 2, m: turnAbout({ x: 0, y: 1, z: 0 }, Math.PI) };
    store.getState().loadDocument({ name: 'hinge', settings: DEFAULT_SCENE, model: modelFromBricks([fork, finger]) });
    store.getState().select(['finger'], 'replace');
    // R lifts it, clear of the ground though the corner of its box beyond the hinge dips under it
    expect(store.getState().rotateSelection(1)).toBe(true);
    const lifted = store.getState().history.present.bricks.get('finger') as Brick;
    expect(brickCellBox(lifted, connectorLookup).y1).toBeGreaterThan(4);
    expect(brickCellBox(lifted, connectorLookup).y0).toBeLessThan(0);
    expect(brickFloor(lifted, connectorLookup)).toBeGreaterThanOrEqual(-1e-9);
    // ⇧R lays it back as it lay; and on down through the ground it will not go: refused, the model left as it was
    expect(store.getState().rotateSelection(-1)).toBe(true);
    const flat = store.getState().history.present;
    const [back] = allBricks(flat).filter((brick) => brick.id === 'finger');
    expect([back?.x, back?.y, back?.z].map((v) => Math.round((v ?? 9) * 1e9) / 1e9 + 0)).toEqual([finger.x, finger.y, finger.z]);
    expect(store.getState().rotateSelection(-1)).toBe(false);
    expect(store.getState().history.present).toBe(flat);
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
    state().setPlugChoice(null);
    state().setDepthChoice(null);
    expect(calls).toBe(0);
  });

  it('keeps which of the ways it could plug in the build preview shows, and how many there are', () => {
    const { store, state } = setup();
    state().setPlugChoice({ at: 1, of: 3 });
    expect(state().plugChoice).toEqual({ at: 1, of: 3 });
    let calls = 0;
    store.subscribe(() => (calls += 1));
    state().setPlugChoice({ at: 1, of: 3 });
    expect(calls).toBe(0);
    state().setPlugChoice({ at: 2, of: 3 });
    // the same way of more, where the cursor has moved on to a connection it could plug into more ways
    state().setPlugChoice({ at: 2, of: 4 });
    expect(state().plugChoice).toEqual({ at: 2, of: 4 });
    state().setPlugChoice(null);
    expect(calls).toBe(3);
    expect(state().plugChoice).toBeNull();
  });

  it('keeps which of the places an axle could go to in a hole the build preview shows, and how many there are', () => {
    const { store, state } = setup();
    state().setDepthChoice({ at: 0, of: 3 });
    expect(state().depthChoice).toEqual({ at: 0, of: 3 });
    let calls = 0;
    store.subscribe(() => (calls += 1));
    state().setDepthChoice({ at: 0, of: 3 });
    expect(calls).toBe(0);
    state().setDepthChoice({ at: 1, of: 3 });
    state().setDepthChoice({ at: 1, of: 2 });
    expect(state().depthChoice).toEqual({ at: 1, of: 2 });
    state().setDepthChoice(null);
    expect(calls).toBe(3);
    expect(state().depthChoice).toBeNull();
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
