/**
 * The step editor's view of the model: the plan as it stands (cached per
 * model, as the 3D view and the panel both ask for it on every change), and
 * the step on show.
 */
import { clampRef, resolvePlan, stepsOf, type InstructionPlan, type PlanContext, type PlanStep, type StepRef } from '../core/instructions/plan';
import { stepView, type StepView } from '../core/instructions/planView';
import type { StepOptions } from '../core/instructions/steps';
import type { Model } from '../core/model/types';
import type { PartLookup } from '../core/parts/types';
import type { StepEditor } from './types';

const resolved = new WeakMap<Model, { readonly auto: StepOptions; readonly plan: InstructionPlan }>();

export function planContext(model: Model, lookup: PartLookup, auto: StepOptions): PlanContext {
  return { bricks: model.bricks, lookup, options: auto };
}

/** The model's plan as it stands, the steps it leaves out planned with `auto`. */
export function resolvedPlan(model: Model, lookup: PartLookup, auto: StepOptions): InstructionPlan {
  const hit = resolved.get(model);
  if (hit && hit.auto.order === auto.order && hit.auto.partsPerStep === auto.partsPerStep) return hit.plan;
  const plan = resolvePlan(model.plan, planContext(model, lookup, auto));
  resolved.set(model, { auto, plan });
  return plan;
}

/** The step on show: where it is in the plan, how many steps are there, and the model at it. */
export interface ShownStep {
  readonly plan: InstructionPlan;
  readonly at: StepRef;
  readonly step: PlanStep | undefined;
  /** Steps in the model, or in the sub-assembly on show. */
  readonly count: number;
  readonly view: StepView;
}

export function shownStep(model: Model, editor: StepEditor, lookup: PartLookup): ShownStep {
  const plan = resolvedPlan(model, lookup, editor.auto);
  const at = clampRef(plan, editor.at);
  const steps = stepsOf(plan, at.assembly);
  return { plan, at, step: steps[at.index], count: steps.length, view: stepView(plan, at) };
}

/**
 * The selected bricks the step editor shows: inside a sub-assembly, the
 * rest of the model is hidden, and no edit should reach what cannot be
 * seen. The same selection when it shows them all.
 */
export function selectionOnShow(selection: ReadonlySet<string>, model: Model, editor: StepEditor, lookup: PartLookup): ReadonlySet<string> {
  if (selection.size === 0) return selection;
  const { at, view } = shownStep(model, editor, lookup);
  if (at.assembly === null) return selection;
  const shown = new Set([...view.before, ...view.current, ...view.after]);
  const kept = [...selection].filter((id) => shown.has(id));
  return kept.length === selection.size ? selection : new Set(kept);
}
