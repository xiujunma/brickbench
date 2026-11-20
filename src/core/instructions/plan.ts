/**
 * Building instructions as the user arranges them: steps of bricks,
 * sub-assemblies built on pages of their own and added whole in one step,
 * and a view for any step. A model keeps its plan; bricks it does not place
 * yet (added since) are planned after its steps, and bricks the model no
 * longer has drop out, so no other edit has to keep the plan up to date.
 */
import type { Vec3 } from '../grid';
import type { Brick } from '../model/types';
import type { PartLookup } from '../parts/types';
import { planSteps, type StepOptions } from './steps';

export interface PlanStep {
  /** Bricks this step adds, by id. */
  readonly bricks: readonly string[];
  /** A sub-assembly the step adds whole, by id, built first on pages of its own. */
  readonly assembly?: string;
  /** The direction the step is drawn from; the booklet's own when absent. */
  readonly view?: Vec3;
}

export interface Assembly {
  readonly id: string;
  readonly name: string;
  /** Its own steps, which add bricks only. */
  readonly steps: readonly PlanStep[];
}

export interface InstructionPlan {
  readonly steps: readonly PlanStep[];
  readonly assemblies: readonly Assembly[];
}

/** A step of the model (assembly null), or of one of its sub-assemblies. */
export interface StepRef {
  readonly assembly: string | null;
  readonly index: number;
}

/** How bricks a plan does not place are planned, and how sub-assemblies' own steps are. */
export interface PlanContext {
  readonly bricks: ReadonlyMap<string, Brick>;
  readonly lookup: PartLookup;
  readonly options: StepOptions;
}

export const EMPTY_PLAN: InstructionPlan = { steps: [], assemblies: [] };

const step = (bricks: readonly string[], assembly?: string, view?: Vec3): PlanStep => ({
  bricks,
  ...(assembly === undefined ? {} : { assembly }),
  ...(view === undefined ? {} : { view }),
});

/** Steps, planned automatically, for these bricks. */
function autoSteps(ids: readonly string[], context: PlanContext): PlanStep[] {
  const bricks = ids.flatMap((id) => {
    const brick = context.bricks.get(id);
    return brick ? [brick] : [];
  });
  return planSteps(bricks, context.lookup, context.options).map((planned) => step(planned.added.map((b) => b.id)));
}

/**
 * The plan for the bricks a model has: those it no longer has dropped, each
 * brick in one step only (the first that names it), no empty steps, and
 * each sub-assembly added by one step of the model. Bricks it does not
 * place stay unplanned.
 */
export function prunePlan(plan: InstructionPlan, has: (id: string) => boolean): InstructionPlan {
  const placed = new Set<string>();
  const claim = (ids: readonly string[]): string[] => {
    const mine: string[] = [];
    for (const id of ids) {
      if (!has(id) || placed.has(id)) continue;
      placed.add(id);
      mine.push(id);
    }
    return mine;
  };
  const known = new Map(plan.assemblies.map((assembly) => [assembly.id, assembly]));
  const assemblies: Assembly[] = [];
  const steps: PlanStep[] = [];
  for (const planned of plan.steps) {
    const assembly = planned.assembly === undefined ? undefined : known.get(planned.assembly);
    // a sub-assembly is added once; one added twice, or never built, is no longer one
    known.delete(planned.assembly ?? '');
    const ownSteps = (assembly?.steps ?? []).map((s) => step(claim(s.bricks), undefined, s.view)).filter((s) => s.bricks.length > 0);
    if (assembly && ownSteps.length > 0) assemblies.push({ id: assembly.id, name: assembly.name, steps: ownSteps });
    const bricks = claim(planned.bricks);
    const adds = assembly && ownSteps.length > 0 ? assembly.id : undefined;
    if (bricks.length > 0 || adds !== undefined) steps.push(step(bricks, adds, planned.view));
  }
  return { steps, assemblies };
}

/** The ids of the bricks a plan places, sub-assemblies' included. */
export function plannedBricks(plan: InstructionPlan): Set<string> {
  return new Set([...plan.steps.flatMap((s) => s.bricks), ...plan.assemblies.flatMap((a) => a.steps.flatMap((s) => s.bricks))]);
}

/** How many of the model's bricks a plan leaves to be planned automatically: those added since, mostly. */
export function leftOutCount(plan: InstructionPlan | undefined, bricks: ReadonlyMap<string, unknown>): number {
  if (!plan) return bricks.size;
  return bricks.size - plannedBricks(prunePlan(plan, (id) => bricks.has(id))).size;
}

/**
 * The plan as it stands for the model's bricks now (see prunePlan), with
 * the bricks it does not place (those added since, mostly) planned bottom
 * up after its steps. Without a plan, every step is planned automatically,
 * the way the context says.
 */
export function resolvePlan(plan: InstructionPlan | undefined, context: PlanContext): InstructionPlan {
  if (!plan) return { steps: autoSteps([...context.bricks.keys()], context), assemblies: [] };
  const pruned = prunePlan(plan, (id) => context.bricks.has(id));
  const placed = plannedBricks(pruned);
  const unplanned = [...context.bricks.keys()].filter((id) => !placed.has(id));
  const bottomUp: PlanContext = { ...context, options: { ...context.options, order: 'layers' } };
  return { steps: [...pruned.steps, ...autoSteps(unplanned, bottomUp)], assemblies: pruned.assemblies };
}

/** The steps of the model, or of one of its sub-assemblies. */
export function stepsOf(plan: InstructionPlan, assembly: string | null): readonly PlanStep[] {
  return assembly === null ? plan.steps : (plan.assemblies.find((a) => a.id === assembly)?.steps ?? []);
}

/** A ref that points at a step: in range, in a sub-assembly that still is one, else the model's. */
export function clampRef(plan: InstructionPlan, ref: StepRef): StepRef {
  const assembly = ref.assembly !== null && plan.assemblies.some((a) => a.id === ref.assembly) ? ref.assembly : null;
  const count = stepsOf(plan, assembly).length;
  return { assembly, index: Math.max(0, Math.min(ref.index, count - 1)) };
}

/** Bricks a model step adds, its sub-assembly's included. */
export function bricksAddedBy(plan: InstructionPlan, planned: PlanStep): string[] {
  const assembly = planned.assembly === undefined ? undefined : plan.assemblies.find((a) => a.id === planned.assembly);
  return [...(assembly?.steps.flatMap((s) => s.bricks) ?? []), ...planned.bricks];
}
