/**
 * What a resolved plan (see resolvePlan) looks like: at a step, as the step
 * editor shows it, and page by page, as the booklet draws it.
 */
import type { Vec3 } from '../grid';
import type { Brick } from '../model/types';
import type { PartLookup } from '../parts/types';
import { bricksAddedBy, resolvePlan, stepsOf, type InstructionPlan, type StepRef } from './plan';
import { DEFAULT_STEP_OPTIONS, type StepOptions, type StepOrder } from './steps';

/** The model at a step: what is built already, what the step adds, and what is still to come. */
export interface StepView {
  readonly before: readonly string[];
  readonly current: readonly string[];
  readonly after: readonly string[];
}

/**
 * The model at a step of its own, or a sub-assembly at one of its steps;
 * within a sub-assembly, bricks outside it are in none of the three.
 */
export function stepView(plan: InstructionPlan, at: StepRef): StepView {
  const steps = stepsOf(plan, at.assembly);
  const added = (index: number): string[] => {
    const planned = steps[index];
    if (!planned) return [];
    return at.assembly === null ? bricksAddedBy(plan, planned) : [...planned.bricks];
  };
  const before = steps.slice(0, at.index).flatMap((_, index) => added(index));
  const after = steps.slice(at.index + 1).flatMap((_, index) => added(at.index + 1 + index));
  return { before, current: added(at.index), after };
}

/** One page of the booklet's steps. */
export interface BookletStep {
  /** Its number in the booklet: the steps of sub-assemblies count too. */
  readonly number: number;
  /** Already built, drawn as it is: the model so far, or the sub-assembly so far. */
  readonly built: readonly Brick[];
  /** What the step adds, outlined. */
  readonly added: readonly Brick[];
  /** What its parts box lists: the bricks it adds, though not those of a sub-assembly it adds whole. */
  readonly parts: readonly Brick[];
  /** What the picture is framed to: the whole model, or a sub-assembly on its own. */
  readonly frame: readonly Brick[];
  /** The direction it is drawn from, if the step has its own. */
  readonly view?: Vec3;
  /** For a sub-assembly's steps, its name; for the step that adds it, its name and adds. */
  readonly assembly?: { readonly name: string; readonly adds: boolean };
}

/** The steps the user arranged (the model's plan), or steps planned automatically one of these ways. */
export type BookletOrder = 'custom' | StepOrder;

/**
 * The booklet's steps: the user's own (the bricks they leave out planned
 * bottom up), or steps planned automatically.
 */
export function bookletPlan(
  bricks: ReadonlyMap<string, Brick>,
  plan: InstructionPlan | undefined,
  options: { readonly order: BookletOrder; readonly partsPerStep: number },
  lookup: PartLookup,
): InstructionPlan {
  const custom = options.order === 'custom';
  const auto: StepOptions = { order: custom ? DEFAULT_STEP_OPTIONS.order : options.order, partsPerStep: options.partsPerStep };
  return resolvePlan(custom ? plan : undefined, { bricks, lookup, options: auto });
}

const kindOf = (brick: Brick): string => `${brick.partId}|${brick.colorId}`;

/**
 * A step's bricks over as many pages as their parts boxes need, each page
 * listing at most `capacity` kinds of part (part and colour): bottom up,
 * keeping the step's order within a layer. Most steps fit on one.
 */
export function splitByKinds(bricks: readonly Brick[], capacity: number): Brick[][] {
  const most = Math.max(1, Math.floor(capacity));
  if (new Set(bricks.map(kindOf)).size <= most) return [[...bricks]];
  const chunks: Brick[][] = [];
  let chunk: Brick[] = [];
  let kinds = new Set<string>();
  for (const brick of [...bricks].sort((a, b) => a.y - b.y)) {
    const kind = kindOf(brick);
    if (!kinds.has(kind) && kinds.size === most) {
      chunks.push(chunk);
      chunk = [];
      kinds = new Set();
    }
    kinds.add(kind);
    chunk.push(brick);
  }
  return [...chunks, chunk];
}

/** A page before its number, and what was built before it, are known: whose page it is (the model's, or a sub-assembly's). */
interface PageSpec extends Omit<BookletStep, 'number' | 'built'> {
  readonly scope: string | null;
}

function pageSpecs(plan: InstructionPlan, bricks: ReadonlyMap<string, Brick>, capacity: number): PageSpec[] {
  const of = (ids: readonly string[]): Brick[] => ids.flatMap((id) => {
    const brick = bricks.get(id);
    return brick ? [brick] : [];
  });
  const whole = [...bricks.values()];
  const specs: PageSpec[] = [];
  for (const planned of plan.steps) {
    const assembly = planned.assembly === undefined ? undefined : plan.assemblies.find((a) => a.id === planned.assembly);
    const built = assembly ? of(assembly.steps.flatMap((s) => s.bricks)) : [];
    for (const own of assembly?.steps ?? []) {
      for (const added of splitByKinds(of(own.bricks), capacity)) {
        specs.push({ scope: assembly?.id ?? null, added, parts: added, frame: built, ...(own.view ? { view: own.view } : {}), ...(assembly ? { assembly: { name: assembly.name, adds: false } } : {}) });
      }
    }
    splitByKinds(of(planned.bricks), capacity).forEach((parts, i) => {
      // the sub-assembly goes on with the first of the step's pages
      const adds = assembly !== undefined && i === 0;
      specs.push({
        scope: null,
        added: adds ? [...built, ...parts] : parts,
        parts,
        frame: whole,
        ...(planned.view ? { view: planned.view } : {}),
        ...(adds ? { assembly: { name: assembly.name, adds: true } } : {}),
      });
    });
  }
  return specs;
}

/**
 * Pages in order: each sub-assembly's steps come just before the step of
 * the model that adds it, and a step adding more kinds of part than a parts
 * box shows (`capacity`) takes several pages (see splitByKinds).
 */
export function bookletSteps(plan: InstructionPlan, bricks: ReadonlyMap<string, Brick>, capacity = Infinity): BookletStep[] {
  const pages: BookletStep[] = [];
  let model: Brick[] = [];
  let sub: Brick[] = [];
  let scope: string | null = null;
  for (const { scope: of, ...spec } of pageSpecs(plan, bricks, capacity)) {
    if (of !== null && of !== scope) sub = [];
    pages.push({ ...spec, number: pages.length + 1, built: of === null ? model : sub });
    if (of === null) model = [...model, ...spec.added];
    else sub = [...sub, ...spec.added];
    scope = of;
  }
  return pages;
}

/** How many step pages the booklet has (see bookletSteps), without drawing up each one. */
export function bookletStepCount(plan: InstructionPlan, bricks: ReadonlyMap<string, Brick>, capacity = Infinity): number {
  return pageSpecs(plan, bricks, capacity).length;
}
