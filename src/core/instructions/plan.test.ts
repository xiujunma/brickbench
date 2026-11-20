import { describe, expect, it } from 'bun:test';
import { makeBrick } from '../model/testUtils';
import type { Brick } from '../model/types';
import { getPart } from '../parts/catalog';
import { STEEPEST_VIEW } from './camera';
import { bricksAddedBy, clampRef, leftOutCount, resolvePlan, stepsOf, type InstructionPlan, type PlanContext } from './plan';
import { dissolveAssembly, freshAssemblyName, makeAssembly, mergeWithNext, moveToStep, newStepAfter, renameAssembly, setStepView } from './planEdits';
import { bookletPlan, bookletStepCount, bookletSteps, splitByKinds, stepView } from './planView';

/** Six bricks in two layers: a, b, c on the ground, d, e, f on top. */
const BRICKS: readonly Brick[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => makeBrick({ id, x: (i % 3) * 4, y: i < 3 ? 0 : 3 }));
const context = (bricks: readonly Brick[] = BRICKS, partsPerStep = 3): PlanContext => ({
  bricks: new Map(bricks.map((b) => [b.id, b])),
  lookup: getPart,
  options: { order: 'layers', partsPerStep },
});
const ids = (plan: InstructionPlan, assembly: string | null = null): string[][] => stepsOf(plan, assembly).map((s) => [...s.bricks]);
/** Looking along x, level: a view at unit length, as views are kept. */
const VIEW = { x: 1, y: 0, z: 0 };

describe('resolving a plan', () => {
  it('plans every brick automatically when there is no plan', () => {
    expect(ids(resolvePlan(undefined, context()))).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
  });

  it('keeps the steps it is given, drops bricks the model no longer has, and plans new ones after', () => {
    const plan: InstructionPlan = { steps: [{ bricks: ['d', 'gone', 'a'] }, { bricks: ['gone2'] }, { bricks: ['b'], view: VIEW }], assemblies: [] };
    const resolved = resolvePlan(plan, context());
    expect(ids(resolved)).toEqual([['d', 'a'], ['b'], ['c', 'e', 'f']]);
    expect(resolved.steps[1]?.view).toEqual(VIEW);
  });

  it('plans the bricks the steps leave out bottom up, whatever order the rest would be planned in', () => {
    // built top layer first
    const asBuilt: PlanContext = { ...context([...BRICKS].reverse()), options: { order: 'build-order', partsPerStep: 3 } };
    expect(ids(resolvePlan(undefined, asBuilt))).toEqual([
      ['f', 'e', 'd'],
      ['c', 'b', 'a'],
    ]);
    const tail = ids(resolvePlan({ steps: [{ bricks: ['a'] }], assemblies: [] }, asBuilt)).slice(1);
    expect(tail.map((step) => step.toSorted())).toEqual([
      ['b', 'c'],
      ['d', 'e', 'f'],
    ]);
  });

  it('counts the bricks a plan leaves to be planned automatically', () => {
    const { bricks } = context();
    expect(leftOutCount(undefined, bricks)).toBe(6);
    const plan: InstructionPlan = {
      steps: [{ bricks: ['a', 'gone'] }, { bricks: [], assembly: 'top' }],
      // a sub-assembly no step adds is no sub-assembly, so its bricks are left out
      assemblies: [
        { id: 'top', name: 'Top', steps: [{ bricks: ['b'] }] },
        { id: 'loose', name: 'Loose', steps: [{ bricks: ['c'] }] },
      ],
    };
    expect(leftOutCount(plan, bricks)).toBe(4);
  });

  it('lets a brick be in one step only, the first that names it', () => {
    expect(ids(resolvePlan({ steps: [{ bricks: ['a', 'b'] }, { bricks: ['a', 'c'] }], assemblies: [] }, context(BRICKS.slice(0, 3))))).toEqual([['a', 'b'], ['c']]);
  });

  it('keeps sub-assemblies a step adds, once, and lets go of those no step adds or that are empty', () => {
    const plan: InstructionPlan = {
      steps: [{ bricks: ['a'], assembly: 'wheel' }, { bricks: [], assembly: 'wheel' }, { bricks: [], assembly: 'empty' }],
      assemblies: [
        { id: 'wheel', name: 'Wheel', steps: [{ bricks: ['d'] }, { bricks: ['e'] }] },
        { id: 'orphan', name: 'Orphan', steps: [{ bricks: ['f'] }] },
        { id: 'empty', name: 'Empty', steps: [{ bricks: ['gone'] }] },
      ],
    };
    const resolved = resolvePlan(plan, context());
    expect(resolved.assemblies.map((a) => a.id)).toEqual(['wheel']);
    expect(resolved.steps.map((s) => s.assembly ?? null)).toEqual(['wheel', null]);
    expect(ids(resolved)).toEqual([['a'], ['b', 'c', 'f']]);
    expect(ids(resolved, 'wheel')).toEqual([['d'], ['e']]);
    expect(bricksAddedBy(resolved, resolved.steps[0]!)).toEqual(['d', 'e', 'a']);
  });

  it('points a step ref at a step that is there', () => {
    const plan = resolvePlan({ steps: [{ bricks: ['a'], assembly: 'w' }], assemblies: [{ id: 'w', name: 'W', steps: [{ bricks: ['b'] }] }] }, context(BRICKS.slice(0, 2)));
    expect(clampRef(plan, { assembly: null, index: 9 })).toEqual({ assembly: null, index: 0 });
    expect(clampRef(plan, { assembly: 'gone', index: 3 })).toEqual({ assembly: null, index: 0 });
    expect(clampRef(plan, { assembly: 'w', index: -2 })).toEqual({ assembly: 'w', index: 0 });
  });
});

describe('editing a plan', () => {
  const auto = resolvePlan(undefined, context());

  it('moves bricks into a step, dropping steps left empty', () => {
    const moved = moveToStep(auto, ['d', 'e', 'f'], { assembly: null, index: 0 });
    expect(ids(moved.plan)).toEqual([['a', 'b', 'c', 'd', 'e', 'f']]);
    expect(moved.at).toEqual({ assembly: null, index: 0 });
    // moving into a later step: the step before empties and goes, so the target moves up
    const back = moveToStep(moved.plan, [], { assembly: null, index: 0 });
    expect(back.plan).toBe(moved.plan);
    const forward = moveToStep({ steps: [{ bricks: ['a'] }, { bricks: ['b'] }], assemblies: [] }, ['a'], { assembly: null, index: 1 });
    expect(ids(forward.plan)).toEqual([['b', 'a']]);
    expect(forward.at).toEqual({ assembly: null, index: 0 });
  });

  it('splits a step, or pulls bricks into a step of their own', () => {
    const split = newStepAfter(auto, ['c'], { assembly: null, index: 0 });
    expect(ids(split.plan)).toEqual([['a', 'b'], ['c'], ['d', 'e', 'f']]);
    expect(split.at).toEqual({ assembly: null, index: 1 });
    expect(newStepAfter(auto, ['c'], { assembly: null, index: 7 }).plan).toBe(auto);
  });

  it('merges a step with the next, but never two sub-assemblies into one step', () => {
    const merged = mergeWithNext(setStepView(auto, { assembly: null, index: 1 }, VIEW).plan, { assembly: null, index: 0 });
    expect(ids(merged.plan)).toEqual([['a', 'b', 'c', 'd', 'e', 'f']]);
    expect(merged.plan.steps[0]?.view).toEqual(VIEW);
    expect(mergeWithNext(auto, { assembly: null, index: 1 }).plan).toBe(auto);
    const twoWheels: InstructionPlan = {
      steps: [{ bricks: [], assembly: 'x' }, { bricks: [], assembly: 'y' }],
      assemblies: [{ id: 'x', name: 'X', steps: [{ bricks: ['a'] }] }, { id: 'y', name: 'Y', steps: [{ bricks: ['b'] }] }],
    };
    expect(mergeWithNext(twoWheels, { assembly: null, index: 0 }).plan).toBe(twoWheels);
  });

  it('sets a step’s view, and gives it the booklet’s own back', () => {
    const set = setStepView(auto, { assembly: null, index: 1 }, VIEW).plan;
    expect(set.steps[1]?.view).toEqual(VIEW);
    expect(setStepView(set, { assembly: null, index: 1 }, null).plan.steps[1]).toEqual({ bricks: ['d', 'e', 'f'] });
    expect(setStepView(auto, { assembly: null, index: 5 }, VIEW).plan).toBe(auto);
    // too steep to draw upright: tilted up as far as it must be, its heading kept; straight down has none
    const steep = setStepView(auto, { assembly: null, index: 1 }, { x: 0, y: -5, z: 0.01 }).plan.steps[1]?.view;
    expect(steep?.y).toBeCloseTo(-STEEPEST_VIEW);
    expect(steep?.x).toBe(0);
    expect(steep?.z).toBeGreaterThan(0);
    expect(setStepView(auto, { assembly: null, index: 1 }, { x: 0, y: -1, z: 0 }).plan).toBe(auto);
  });

  it('makes a sub-assembly with steps of its own, added whole at a step, and undoes one', () => {
    const made = makeAssembly(auto, ['d', 'e'], { assembly: null, index: 0 }, 'sa', context(BRICKS, 1));
    expect(made.plan.assemblies).toEqual([{ id: 'sa', name: 'Sub-assembly 1', steps: [{ bricks: ['d'] }, { bricks: ['e'] }] }]);
    expect(made.plan.steps).toEqual([{ bricks: ['a', 'b', 'c'], assembly: 'sa' }, { bricks: ['f'] }]);
    expect(made.at).toEqual({ assembly: null, index: 0 });
    expect(freshAssemblyName(made.plan)).toBe('Sub-assembly 2');
    // at a step that adds one already, it gets a step of its own
    const second = makeAssembly(made.plan, ['f'], { assembly: null, index: 0 }, 'sb', context());
    expect(second.plan.steps.map((s) => s.assembly ?? null)).toEqual(['sa', 'sb']);
    expect(second.at).toEqual({ assembly: null, index: 1 });
    // no nesting
    expect(makeAssembly(made.plan, ['d'], { assembly: 'sa', index: 0 }, 'sc', context()).plan).toBe(made.plan);
    const undone = dissolveAssembly(made.plan, 'sa');
    expect(undone.plan).toEqual({ steps: [{ bricks: ['d', 'e', 'a', 'b', 'c'] }, { bricks: ['f'] }], assemblies: [] });
    expect(dissolveAssembly(made.plan, 'nope').plan).toBe(made.plan);
  });

  it('drops a sub-assembly emptied by moving its bricks out', () => {
    const made = makeAssembly(auto, ['d'], { assembly: null, index: 1 }, 'sa', context()).plan;
    const emptied = moveToStep(made, ['d'], { assembly: null, index: 0 }).plan;
    expect(emptied.assemblies).toEqual([]);
    expect(emptied.steps.every((s) => s.assembly === undefined)).toBe(true);
  });

  it('renames a sub-assembly, keeping a name it is given', () => {
    const made = makeAssembly(auto, ['d'], { assembly: null, index: 0 }, 'sa', context()).plan;
    const renamed = renameAssembly(made, 'sa', '  Left wheel ');
    expect(renamed.assemblies[0]?.name).toBe('Left wheel');
    // nothing to change, so nothing to undo
    expect(renameAssembly(made, 'sa', '   ')).toBe(made);
    expect(renameAssembly(renamed, 'sa', 'Left wheel ')).toBe(renamed);
    expect(renameAssembly(made, 'gone', 'Left wheel')).toBe(made);
    expect(renameAssembly(made, 'sa', `${'x'.repeat(59)}  more`).assemblies[0]?.name).toBe('x'.repeat(59));
  });
});

describe('looking at a plan', () => {
  const plan = resolvePlan(
    { steps: [{ bricks: ['a', 'b'] }, { bricks: ['c'], assembly: 'top' }], assemblies: [{ id: 'top', name: 'Roof', steps: [{ bricks: ['d', 'e'] }, { bricks: ['f'], view: VIEW }] }] },
    context(),
  );

  it('shows the model at a step: built, added now, and still to come', () => {
    expect(stepView(plan, { assembly: null, index: 0 })).toEqual({ before: [], current: ['a', 'b'], after: ['d', 'e', 'f', 'c'] });
    expect(stepView(plan, { assembly: null, index: 1 })).toEqual({ before: ['a', 'b'], current: ['d', 'e', 'f', 'c'], after: [] });
    // inside a sub-assembly, only its own bricks
    expect(stepView(plan, { assembly: 'top', index: 1 })).toEqual({ before: ['d', 'e'], current: ['f'], after: [] });
  });

  it('lays out a booklet: a sub-assembly’s steps just before the step that adds it', () => {
    const pages = bookletSteps(plan, context().bricks);
    const show = (bricks: readonly Brick[]) => bricks.map((b) => b.id);
    expect(pages.map((p) => [p.number, show(p.built), show(p.added), show(p.parts), p.assembly ?? null])).toEqual([
      [1, [], ['a', 'b'], ['a', 'b'], null],
      [2, [], ['d', 'e'], ['d', 'e'], { name: 'Roof', adds: false }],
      [3, ['d', 'e'], ['f'], ['f'], { name: 'Roof', adds: false }],
      [4, ['a', 'b'], ['d', 'e', 'f', 'c'], ['c'], { name: 'Roof', adds: true }],
    ]);
    expect(pages[2]?.view).toEqual(VIEW);
    expect(show(pages[1]?.frame ?? [])).toEqual(['d', 'e', 'f']);
    expect(pages[3]?.frame).toHaveLength(6);
    expect(bookletStepCount(plan, context().bricks)).toBe(pages.length);
  });

  it('spreads a step over pages when its parts box would list more kinds of part than fit', () => {
    // two red 2 × 4s and a blue one on the ground, a 2 × 2 on top: three kinds
    const kinds = [
      makeBrick({ id: 'top', partId: 'brick-2x2', y: 3 }),
      makeBrick({ id: 'red1' }),
      makeBrick({ id: 'blue', x: 4, colorId: 1 }),
      makeBrick({ id: 'red2', x: 8 }),
    ];
    const names = (chunks: readonly (readonly Brick[])[]) => chunks.map((chunk) => chunk.map((b) => b.id));
    expect(names(splitByKinds(kinds, 3))).toEqual([['top', 'red1', 'blue', 'red2']]);
    // bottom up, a kind already on the page taking no more room
    expect(names(splitByKinds(kinds, 2))).toEqual([['red1', 'blue', 'red2'], ['top']]);
    expect(names(splitByKinds(kinds, 1))).toEqual([['red1'], ['blue'], ['red2'], ['top']]);

    const bricks = new Map([...kinds, makeBrick({ id: 'wing', x: 20 })].map((b) => [b.id, b]));
    const plan: InstructionPlan = {
      steps: [{ bricks: ['top', 'red1', 'blue', 'red2'], assembly: 'side', view: VIEW }],
      assemblies: [{ id: 'side', name: 'Side', steps: [{ bricks: ['wing'] }] }],
    };
    const pages = bookletSteps(plan, bricks, 2);
    const show = (list: readonly Brick[]) => list.map((b) => b.id);
    expect(pages.map((p) => [p.number, show(p.built), show(p.added), show(p.parts), p.assembly ?? null, p.view ?? null])).toEqual([
      [1, [], ['wing'], ['wing'], { name: 'Side', adds: false }, null],
      // the sub-assembly goes on with the step's first page; every page keeps the step's view
      [2, [], ['wing', 'red1', 'blue', 'red2'], ['red1', 'blue', 'red2'], { name: 'Side', adds: true }, VIEW],
      [3, ['wing', 'red1', 'blue', 'red2'], ['top'], ['top'], null, VIEW],
    ]);
    expect(bookletStepCount(plan, bricks, 2)).toBe(3);
    expect(bookletStepCount(plan, bricks)).toBe(2);
  });

  it('makes the booklet from the user’s steps, or plans its steps automatically', () => {
    const { bricks } = context();
    const mine: InstructionPlan = { steps: [{ bricks: ['f', 'a'] }], assemblies: [] };
    const custom = bookletPlan(bricks, mine, { order: 'custom', partsPerStep: 3 }, getPart);
    expect(ids(custom)[0]).toEqual(['f', 'a']);
    expect(bookletStepCount(custom, bricks)).toBe(3);
    // with no steps of the user's, "your steps" are planned bottom up
    expect(ids(bookletPlan(bricks, undefined, { order: 'custom', partsPerStep: 3 }, getPart))).toEqual(ids(resolvePlan(undefined, context())));
    // an automatic order leaves the user's steps aside
    const auto = bookletPlan(bricks, mine, { order: 'layers', partsPerStep: 6 }, getPart);
    expect(ids(auto)).toEqual([['a', 'b', 'c', 'd', 'e', 'f']]);
  });
});
