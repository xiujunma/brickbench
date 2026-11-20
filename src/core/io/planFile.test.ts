import { describe, expect, it } from 'bun:test';
import { STEEPEST_VIEW } from '../instructions/camera';
import type { InstructionPlan } from '../instructions/plan';
import { modelFromBricks } from '../model/model';
import { createIdFactory } from '../model/ids';
import { makeBrick } from '../model/testUtils';
import type { Brick, Model } from '../model/types';
import { getPart } from '../parts/catalog';
import { DEFAULT_SCENE, parseDocument, serializeDocument } from './modelFile';
import { planFromRecord, planToRecord } from './planFile';

/** Four 2 × 4 bricks side by side. */
const BRICKS: readonly Brick[] = ['a', 'b', 'c', 'd'].map((id, i) => makeBrick({ id, x: i * 4 }));
const PLAN: InstructionPlan = {
  steps: [{ bricks: ['b'] }, { bricks: ['a'], assembly: 'roof', view: { x: 1, y: 0, z: 0 } }],
  assemblies: [{ id: 'roof', name: 'Roof', steps: [{ bricks: ['c'] }, { bricks: ['d'], view: { x: 0, y: 0, z: -1 } }] }],
};

function roundTrip(model: Model) {
  const text = serializeDocument({ name: 'Plan', model, settings: DEFAULT_SCENE });
  const parsed = parseDocument(text, getPart, createIdFactory('n'));
  if (!parsed.ok) throw new Error(parsed.error);
  return { text, ...parsed.value };
}

/** A plan with its bricks named by where they stand, as ids change from file to file. */
function byPlace(plan: InstructionPlan | undefined, model: Model) {
  const place = (id: string) => model.bricks.get(id)?.x;
  const steps = (s: InstructionPlan['steps']) => s.map((step) => ({ ...step, bricks: step.bricks.map(place), assembly: step.assembly ? 'yes' : 'no' }));
  return { steps: steps(plan?.steps ?? []), assemblies: (plan?.assemblies ?? []).map((a) => ({ name: a.name, steps: steps(a.steps) })) };
}

describe('building instructions in a model file', () => {
  it('keeps the steps, sub-assemblies and views a model was given', () => {
    const model: Model = { ...modelFromBricks(BRICKS), plan: PLAN };
    const back = roundTrip(model);
    expect(JSON.parse(back.text).instructions).toEqual({
      steps: [{ bricks: [1] }, { bricks: [0], assembly: 0, view: [1, 0, 0] }],
      assemblies: [{ name: 'Roof', steps: [{ bricks: [2] }, { bricks: [3], view: [0, 0, -1] }] }],
    });
    expect(byPlace(back.doc.model.plan, back.doc.model)).toEqual(byPlace(PLAN, model));
    expect(back.warnings).toEqual([]);
  });

  it('writes none for a model without a plan, or whose plan places none of its bricks', () => {
    expect(JSON.parse(roundTrip(modelFromBricks(BRICKS)).text)).not.toHaveProperty('instructions');
    const stale: Model = { ...modelFromBricks(BRICKS), plan: { steps: [{ bricks: ['gone'] }], assemblies: [] } };
    const back = roundTrip(stale);
    expect(JSON.parse(back.text)).not.toHaveProperty('instructions');
    expect(back.doc.model.plan).toBeUndefined();
  });

  it('drops steps for bricks left out as the model loads', () => {
    const text = JSON.stringify({
      format: 'brickbench.model',
      version: 1,
      name: 'Gaps',
      bricks: [
        { part: 'brick-2x4', color: 4, x: 0, y: 0, z: 0, r: 0 },
        { part: 'no-such-part', color: 4, x: 4, y: 0, z: 0, r: 0 },
        { part: 'brick-2x4', color: 4, x: 8, y: 0, z: 0, r: 0 },
      ],
      instructions: { steps: [{ bricks: [1] }, { bricks: [2, 0, 99] }], assemblies: [] },
    });
    const parsed = parseDocument(text, getPart, createIdFactory('n'));
    if (!parsed.ok) throw new Error(parsed.error);
    const { model } = parsed.value.doc;
    expect(model.plan?.steps.map((s) => s.bricks.map((id) => model.bricks.get(id)?.x))).toEqual([[8, 0]]);
  });

  it('opens a model whose plan is damaged, planning its steps again, and says so', () => {
    const text = JSON.stringify({
      format: 'brickbench.model',
      version: 1,
      name: 'Damaged',
      bricks: [{ part: 'brick-2x4', color: 4, x: 0, y: 0, z: 0, r: 0 }],
      instructions: { steps: [{ bricks: ['first'] }], assemblies: [{ name: '', steps: [] }] },
    });
    const parsed = parseDocument(text, getPart, createIdFactory('n'));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.doc.model.bricks.size).toBe(1);
    expect(parsed.value.doc.model.plan).toBeUndefined();
    expect(parsed.value.warnings).toEqual(['The building steps in this file could not be read, so they will be planned again.']);
  });

  it('reads a view of any length, tilting one too steep to draw upright, and writes only views it can draw', () => {
    const text = JSON.stringify({
      format: 'brickbench.model',
      version: 1,
      name: 'V',
      bricks: [{ part: 'brick-2x4', color: 4, x: 0, y: 0, z: 0, r: 0 }],
      instructions: { steps: [{ bricks: [0], view: [0.01, -3, 0] }], assemblies: [] },
    });
    const parsed = parseDocument(text, getPart, createIdFactory('n'));
    if (!parsed.ok) throw new Error(parsed.error);
    const view = parsed.value.doc.model.plan?.steps[0]?.view;
    expect(view?.y).toBeCloseTo(-STEEPEST_VIEW);
    expect(Math.hypot(view?.x ?? 0, view?.y ?? 0, view?.z ?? 0)).toBeCloseTo(1);
    // a step's view no picture can be drawn from leaves the file; the step stays
    const plan: InstructionPlan = { steps: [{ bricks: ['a'], view: { x: 0, y: -1, z: 0 } }], assemblies: [] };
    expect(planToRecord(plan, ['a'])).toEqual({ steps: [{ bricks: [0] }], assemblies: [] });
  });

  it('refuses a view straight down, which a picture cannot keep upright, and one that is no direction', () => {
    const plan = (view: unknown) => ({ steps: [{ bricks: [0], view }], assemblies: [] });
    const text = (view: unknown) =>
      JSON.stringify({ format: 'brickbench.model', version: 1, name: 'V', bricks: [{ part: 'brick-2x4', color: 4, x: 0, y: 0, z: 0, r: 0 }], instructions: plan(view) });
    for (const view of [[0, -1, 0], [0, 0, 0], [Number.MAX_VALUE * 2, 0, 0]]) {
      const parsed = parseDocument(text(view), getPart, createIdFactory('n'));
      expect(parsed.ok && parsed.value.doc.model.plan).toBe(undefined);
    }
  });

  it('names sub-assemblies in a file by their place, and leaves out a step that adds one it lacks', () => {
    const plan = planFromRecord({ steps: [{ bricks: [0], assembly: 3 }], assemblies: [] }, ['x']);
    expect(plan).toEqual({ steps: [{ bricks: ['x'] }], assemblies: [] });
    expect(planToRecord({ steps: [], assemblies: [] }, ['x'])).toBeNull();
  });
});
