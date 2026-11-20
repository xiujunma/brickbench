/**
 * Edits to a resolved plan (see resolvePlan), as the step editor makes
 * them. Each returns a new plan, and where the step it made, moved to or
 * kept now is; none changes the plan it is given.
 */
import type { Vec3 } from '../grid';
import { drawableDirection } from './camera';
import { resolvePlan, stepsOf, type Assembly, type InstructionPlan, type PlanContext, type PlanStep, type StepRef } from './plan';

export interface Edited {
  readonly plan: InstructionPlan;
  /** The step the edit made, moved bricks to, or stayed on. */
  readonly at: StepRef;
}

const unchanged = (plan: InstructionPlan, at: StepRef): Edited => ({ plan, at });

/** These bricks of the model, in the order given. */
function pick(context: PlanContext, ids: readonly string[]): PlanContext {
  const bricks = new Map(ids.flatMap((id) => {
    const brick = context.bricks.get(id);
    return brick ? [[id, brick] as const] : [];
  }));
  return { ...context, bricks };
}

/** Replaces the steps of the model (assembly null) or of a sub-assembly. */
function withSteps(plan: InstructionPlan, assembly: string | null, steps: readonly PlanStep[]): InstructionPlan {
  if (assembly === null) return { ...plan, steps };
  return { ...plan, assemblies: plan.assemblies.map((a) => (a.id === assembly ? { ...a, steps } : a)) };
}

/** The plan with these bricks taken out of every step; steps left empty stay, for tidy to drop. */
function without(plan: InstructionPlan, ids: ReadonlySet<string>): InstructionPlan {
  const take = (s: PlanStep): PlanStep => (s.bricks.some((id) => ids.has(id)) ? { ...s, bricks: s.bricks.filter((id) => !ids.has(id)) } : s);
  return { steps: plan.steps.map(take), assemblies: plan.assemblies.map((a) => ({ ...a, steps: a.steps.map(take) })) };
}

/**
 * Drops steps left empty, and sub-assemblies with nothing left in them,
 * except for the step `keep`; says where that step is now.
 */
function tidy(plan: InstructionPlan, keep: StepRef): Edited {
  const keepIn = (assembly: string | null, steps: readonly PlanStep[]): { steps: PlanStep[]; at: number } => {
    const kept: PlanStep[] = [];
    let at = -1;
    steps.forEach((s, index) => {
      const isKeep = keep.assembly === assembly && keep.index === index;
      if (isKeep) at = kept.length;
      if (isKeep || s.bricks.length > 0 || s.assembly !== undefined) kept.push(s);
    });
    return { steps: kept, at };
  };
  const assemblies: Assembly[] = [];
  let at: StepRef = keep;
  for (const assembly of plan.assemblies) {
    const tidied = keepIn(assembly.id, assembly.steps);
    if (tidied.at !== -1) at = { assembly: assembly.id, index: tidied.at };
    if (tidied.steps.length > 0) assemblies.push({ ...assembly, steps: tidied.steps });
  }
  const remaining = new Set(assemblies.map((a) => a.id));
  // a step adding a sub-assembly that is gone adds just its own bricks
  const steps = plan.steps.map((s) => (s.assembly !== undefined && !remaining.has(s.assembly) ? { bricks: s.bricks, ...(s.view ? { view: s.view } : {}) } : s));
  const main = keepIn(null, steps);
  if (main.at !== -1) at = { assembly: null, index: main.at };
  return { plan: { steps: main.steps, assemblies }, at };
}

/** Moves bricks, from wherever they are, into a step. */
export function moveToStep(plan: InstructionPlan, ids: readonly string[], to: StepRef): Edited {
  const target = stepsOf(plan, to.assembly)[to.index];
  if (!target || ids.length === 0) return unchanged(plan, to);
  const moving = new Set(ids);
  const emptied = without(plan, moving);
  const steps = stepsOf(emptied, to.assembly).map((s, index) => (index === to.index ? { ...s, bricks: [...s.bricks, ...ids] } : s));
  return tidy(withSteps(emptied, to.assembly, steps), to);
}

/** Makes a new step of these bricks, just after `after`: splitting a step, or pulling bricks forward. */
export function newStepAfter(plan: InstructionPlan, ids: readonly string[], after: StepRef): Edited {
  if (ids.length === 0 || !stepsOf(plan, after.assembly)[after.index]) return unchanged(plan, after);
  const emptied = without(plan, new Set(ids));
  const steps = [...stepsOf(emptied, after.assembly)];
  steps.splice(after.index + 1, 0, { bricks: [...ids] });
  return tidy(withSteps(emptied, after.assembly, steps), { assembly: after.assembly, index: after.index + 1 });
}

/** Joins a step and the next one. Two steps that each add a sub-assembly stay apart: a step adds one at most. */
export function mergeWithNext(plan: InstructionPlan, at: StepRef): Edited {
  const steps = stepsOf(plan, at.assembly);
  const first = steps[at.index];
  const second = steps[at.index + 1];
  if (!first || !second || (first.assembly !== undefined && second.assembly !== undefined)) return unchanged(plan, at);
  const assembly = first.assembly ?? second.assembly;
  const view = first.view ?? second.view;
  const merged: PlanStep = { bricks: [...first.bricks, ...second.bricks], ...(assembly === undefined ? {} : { assembly }), ...(view ? { view } : {}) };
  return { plan: withSteps(plan, at.assembly, [...steps.slice(0, at.index), merged, ...steps.slice(at.index + 2)]), at };
}

/**
 * Sets the direction a step is drawn from (as the booklet can draw it: see
 * drawableDirection), or with null, gives it the booklet's own again.
 */
export function setStepView(plan: InstructionPlan, at: StepRef, view: Vec3 | null): Edited {
  const steps = stepsOf(plan, at.assembly);
  const target = steps[at.index];
  const drawable = view === null ? null : drawableDirection(view);
  if (!target || (view !== null && !drawable)) return unchanged(plan, at);
  const { view: _old, ...rest } = target;
  const updated: PlanStep = drawable === null ? rest : { ...rest, view: drawable };
  return { plan: withSteps(plan, at.assembly, steps.map((s, index) => (index === at.index ? updated : s))), at };
}

/** A name no sub-assembly has yet: "Sub-assembly 1", 2, … */
export function freshAssemblyName(plan: InstructionPlan): string {
  const names = new Set(plan.assemblies.map((a) => a.name));
  let n = 1;
  while (names.has(`Sub-assembly ${n}`)) n += 1;
  return `Sub-assembly ${n}`;
}

/**
 * Makes these bricks a sub-assembly, built on pages of its own (its steps
 * planned automatically) and added whole at the model's step `at`, or in a
 * step of its own just after when that step adds one already. Bricks of a
 * sub-assembly's own steps cannot make one: sub-assemblies do not nest.
 */
export function makeAssembly(plan: InstructionPlan, ids: readonly string[], at: StepRef, id: string, context: PlanContext): Edited {
  const target = plan.steps[at.index];
  if (at.assembly !== null || !target || ids.length === 0) return unchanged(plan, at);
  const emptied = without(plan, new Set(ids));
  const own = resolvePlan(undefined, pick(context, ids)).steps;
  if (own.length === 0) return unchanged(plan, at);
  const assembly: Assembly = { id, name: freshAssemblyName(plan), steps: own };
  const steps = [...emptied.steps];
  const index = target.assembly === undefined ? at.index : at.index + 1;
  if (target.assembly === undefined) steps[at.index] = { ...(steps[at.index] as PlanStep), assembly: id };
  else steps.splice(index, 0, { bricks: [], assembly: id });
  return tidy({ steps, assemblies: [...emptied.assemblies, assembly] }, { assembly: null, index });
}

/** Undoes a sub-assembly: its bricks join the model's step that added it. */
export function dissolveAssembly(plan: InstructionPlan, id: string): Edited {
  const index = plan.steps.findIndex((s) => s.assembly === id);
  const assembly = plan.assemblies.find((a) => a.id === id);
  if (index === -1 || !assembly) return unchanged(plan, { assembly: null, index: 0 });
  const adding = plan.steps[index] as PlanStep;
  const bricks = [...assembly.steps.flatMap((s) => s.bricks), ...adding.bricks];
  const steps = plan.steps.map((s, i) => (i === index ? { bricks, ...(adding.view ? { view: adding.view } : {}) } : s));
  return { plan: { steps, assemblies: plan.assemblies.filter((a) => a.id !== id) }, at: { assembly: null, index } };
}

/** Most characters in a sub-assembly's name. */
export const MAX_ASSEMBLY_NAME = 60;

/** A sub-assembly's name as it would be kept: trimmed and cut short; empty when there is none. */
export function assemblyNameOf(name: string): string {
  return name.trim().slice(0, MAX_ASSEMBLY_NAME).trim();
}

/** Renames a sub-assembly; the same plan when the name is empty or unchanged, so no undo step is made of it. */
export function renameAssembly(plan: InstructionPlan, id: string, name: string): InstructionPlan {
  const kept = assemblyNameOf(name);
  const assembly = plan.assemblies.find((a) => a.id === id);
  if (!kept || !assembly || assembly.name === kept) return plan;
  return { ...plan, assemblies: plan.assemblies.map((a) => (a === assembly ? { ...a, name: kept } : a)) };
}
