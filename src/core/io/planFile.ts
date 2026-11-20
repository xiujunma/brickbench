/**
 * A model's building instructions in its file. Files do not keep brick ids,
 * so steps name bricks by their place in the file's list of bricks, and
 * sub-assemblies by their place in its list of sub-assemblies.
 */
import { z } from 'zod';
import type { Vec3 } from '../grid';
import { drawableDirection } from '../instructions/camera';
import { prunePlan, type InstructionPlan, type PlanStep } from '../instructions/plan';
import { MAX_ASSEMBLY_NAME } from '../instructions/planEdits';

/** More than any model's instructions have. */
export const MAX_ASSEMBLIES = 1000;
const MAX_ITEMS = 50_000;

const index = z.number().int().min(0).max(MAX_ITEMS);
/** A direction to look along: any length, not straight up or down, which pictures cannot keep upright (see drawableDirection). */
const viewSchema = z
  .tuple([z.number(), z.number(), z.number()])
  .refine(([x, y, z]) => drawableDirection({ x, y, z }) !== null, 'not a direction to look along');
const stepRecord = z.object({ bricks: z.array(index).max(MAX_ITEMS), view: viewSchema.optional() });

export const instructionsSchema = z.object({
  steps: z.array(stepRecord.extend({ assembly: z.number().int().min(0).max(MAX_ASSEMBLIES).optional() })).max(MAX_ITEMS),
  assemblies: z.array(z.object({ name: z.string().trim().min(1).max(MAX_ASSEMBLY_NAME), steps: z.array(stepRecord).max(MAX_ITEMS) })).max(MAX_ASSEMBLIES),
});

export type InstructionsRecord = z.infer<typeof instructionsSchema>;

/** A step's view for the file, if it is one a picture can be drawn from. */
const toView = (view: Vec3 | undefined): { view: [number, number, number] } | object => {
  const drawable = view && drawableDirection(view);
  return drawable ? { view: [drawable.x, drawable.y, drawable.z] } : {};
};
const fromView = ([x, y, z]: readonly [number, number, number]): Vec3 => drawableDirection({ x, y, z }) ?? { x, y, z };

/** The plan for a file whose bricks are in `order`; null when it places none of them. */
export function planToRecord(plan: InstructionPlan, order: readonly string[]): InstructionsRecord | null {
  const at = new Map(order.map((id, i) => [id, i]));
  const pruned = prunePlan(plan, (id) => at.has(id));
  if (pruned.steps.length === 0) return null;
  const place = new Map(pruned.assemblies.map((a, i) => [a.id, i]));
  const record = (s: PlanStep) => ({ bricks: s.bricks.map((id) => at.get(id) as number), ...toView(s.view) });
  return {
    steps: pruned.steps.map((s) => ({ ...record(s), ...(s.assembly === undefined ? {} : { assembly: place.get(s.assembly) as number }) })),
    assemblies: pruned.assemblies.map((a) => ({ name: a.name, steps: a.steps.map(record) })),
  };
}

/**
 * The plan a file stores, for the bricks it came in with: `ids` gives the
 * brick each of the file's bricks became, null for one that stayed out.
 */
export function planFromRecord(record: InstructionsRecord, ids: readonly (string | null)[]): InstructionPlan {
  const brick = (i: number): string[] => {
    const id = ids[i];
    return id ? [id] : [];
  };
  const assemblyId = (i: number): string => `assembly-${i + 1}`;
  const step = (s: { readonly bricks: readonly number[]; readonly view?: readonly [number, number, number] | undefined }, assembly?: number): PlanStep => ({
    bricks: s.bricks.flatMap(brick),
    ...(assembly === undefined || !record.assemblies[assembly] ? {} : { assembly: assemblyId(assembly) }),
    ...(s.view ? { view: fromView(s.view) } : {}),
  });
  const plan: InstructionPlan = {
    steps: record.steps.map((s) => step(s, s.assembly)),
    assemblies: record.assemblies.map((a, i) => ({ id: assemblyId(i), name: a.name, steps: a.steps.map((s) => step(s)) })),
  };
  const kept = new Set(ids.filter((id): id is string => id !== null));
  return prunePlan(plan, (id) => kept.has(id));
}
