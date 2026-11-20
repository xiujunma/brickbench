import { describe, expect, it } from 'bun:test';
import { DEFAULT_SCENE } from '../core/io/modelFile';
import { makeAssembly, moveToStep, newStepAfter } from '../core/instructions/planEdits';
import { modelFromBricks } from '../core/model/model';
import { makeBrick } from '../core/model/testUtils';
import { getPart } from '../core/parts/catalog';
import { resolvedPlan, shownStep } from './stepEditor';
import { createEditorStore } from './store';
import type { EditorState } from './types';

/** Three bricks on the ground and one on top: planned two to a step, c and d share one. */
function setup() {
  let n = 0;
  const store = createEditorStore({ lookup: getPart, nextId: () => `id${n++}` });
  const state = (): EditorState => store.getState();
  const bricks = [makeBrick({ id: 'a' }), makeBrick({ id: 'b', x: 4 }), makeBrick({ id: 'c', x: 8 }), makeBrick({ id: 'd', y: 3 })];
  state().loadDocument({ name: 'test', settings: DEFAULT_SCENE, model: modelFromBricks(bricks) });
  return { store, state };
}

const shown = (state: EditorState) => {
  if (!state.stepEditor) throw new Error('the step editor is closed');
  return shownStep(state.history.present, state.stepEditor, getPart);
};

describe('the step editor', () => {
  it('opens at the first step of the plan, with the select tool, and shows the model at it', () => {
    const { state } = setup();
    state().editSteps({ order: 'layers', partsPerStep: 2 });
    expect(state().tool).toBe('select');
    const step = shown(state());
    expect(step.count).toBe(2);
    expect(step.view).toEqual({ before: [], current: ['a', 'b'], after: ['c', 'd'] });
    // opening it changes nothing in the model
    expect(state().history.past).toHaveLength(0);
  });

  it('goes from step to step, staying inside the plan', () => {
    const { state } = setup();
    state().editSteps({ order: 'layers', partsPerStep: 2 });
    state().goToStep({ assembly: null, index: 1 });
    expect(shown(state()).view.current).toEqual(['c', 'd']);
    state().goToStep({ assembly: null, index: 40 });
    expect(state().stepEditor?.at).toEqual({ assembly: null, index: 1 });
  });

  it('keeps each edit as a step to undo, and goes where the edit leads', () => {
    const { state } = setup();
    state().editSteps({ order: 'layers', partsPerStep: 2 });
    state().editPlan((plan) => newStepAfter(plan, ['b'], { assembly: null, index: 0 }));
    expect(state().stepEditor?.at).toEqual({ assembly: null, index: 1 });
    expect(state().history.present.plan?.steps.map((s) => s.bricks)).toEqual([['a'], ['b'], ['c', 'd']]);
    state().editPlan((plan) => moveToStep(plan, ['d'], { assembly: null, index: 0 }));
    expect(state().history.present.plan?.steps.map((s) => s.bricks)).toEqual([['a', 'd'], ['b'], ['c']]);
    state().undo();
    expect(state().history.present.plan?.steps.map((s) => s.bricks)).toEqual([['a'], ['b'], ['c', 'd']]);
    state().undo();
    expect(state().history.present.plan).toBeUndefined();
  });

  it('records nothing for an edit that changes nothing', () => {
    const { state } = setup();
    state().editSteps();
    state().editPlan((plan) => moveToStep(plan, [], { assembly: null, index: 0 }));
    expect(state().history.past).toHaveLength(0);
  });

  it('closes when asked, for another tool, for a part to build with, or another model, and does nothing closed', () => {
    const { state } = setup();
    state().editSteps();
    state().setTool('select');
    expect(state().stepEditor).not.toBeNull();
    state().setTool('paint');
    expect(state().stepEditor).toBeNull();
    state().editSteps();
    state().setActivePart('brick-2x2');
    expect(state().stepEditor).toBeNull();
    state().editSteps();
    state().newModel();
    expect(state().stepEditor).toBeNull();
    state().editSteps();
    state().closeSteps();
    expect(state().stepEditor).toBeNull();
    // closed, these change nothing
    const before = state();
    state().goToStep({ assembly: null, index: 1 });
    state().editPlan((plan) => newStepAfter(plan, ['a'], { assembly: null, index: 0 }));
    state().closeSteps();
    expect(state()).toBe(before);
  });

  it('keeps edits inside a sub-assembly to its bricks, the rest of the model being hidden there', () => {
    const { state } = setup();
    state().editSteps({ order: 'layers', partsPerStep: 2 });
    state().editPlan((plan, context) => makeAssembly(plan, ['a', 'b'], { assembly: null, index: 0 }, 'sub', context));
    state().selectAll();
    expect([...state().selection].sort()).toEqual(['a', 'b', 'c', 'd']);
    // going in lets go of the bricks it hides
    state().goToStep({ assembly: 'sub', index: 0 });
    expect([...state().selection].sort()).toEqual(['a', 'b']);
    state().clearSelection();
    state().selectAll();
    expect([...state().selection].sort()).toEqual(['a', 'b']);
    // an edit that leads out of it keeps what is selected
    state().editPlan((plan) => ({ plan, at: { assembly: null, index: 0 } }));
    expect([...state().selection].sort()).toEqual(['a', 'b']);
    state().goToStep({ assembly: 'sub', index: 0 });
    state().editPlan((plan) => moveToStep(plan, ['b'], { assembly: 'sub', index: 0 }));
    expect([...state().selection].sort()).toEqual(['a', 'b']);
  });

  it('works the plan out once for each model and way of planning', () => {
    const { state } = setup();
    const model = state().history.present;
    const options = { order: 'layers', partsPerStep: 2 } as const;
    expect(resolvedPlan(model, getPart, options)).toBe(resolvedPlan(model, getPart, { ...options }));
    expect(resolvedPlan(model, getPart, { ...options, partsPerStep: 3 })).not.toBe(resolvedPlan(model, getPart, options));
  });
});
