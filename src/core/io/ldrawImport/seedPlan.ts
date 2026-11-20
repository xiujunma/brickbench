/**
 * Building steps for an opened LDraw model, from what its file says: its
 * own steps (`0 STEP` lines), and each use of a submodel as a sub-assembly,
 * built on pages of its own and added whole at the step of the model whose
 * line uses it. A file without steps has its bricks planned bottom up; a
 * model with neither steps nor submodels gets no plan, so it is planned
 * like any other.
 */
import type { Assembly, InstructionPlan, PlanStep } from '../../instructions/plan';
import { MAX_ASSEMBLY_NAME } from '../../instructions/planEdits';
import { DEFAULT_STEP_OPTIONS, planSteps } from '../../instructions/steps';
import type { Brick } from '../../model/types';
import type { PartLookup } from '../../parts/types';
import { MAX_ASSEMBLIES } from '../planFile';

/** A brick that came in, and where its line was among the model's steps and submodels (see Placement). */
export interface SteppedBrick {
  readonly id: string;
  /** The uses of submodels leading to it, by their lines' places: "" in the model itself, "3/12" two deep. */
  readonly group: string;
  /** Those submodels' names, as the model writes them, outermost first. */
  readonly submodels: readonly string[];
  /** The step of each line on the way to it, the model's first: one more than its submodels. */
  readonly steps: readonly number[];
}

export interface SeedContext {
  readonly bricks: ReadonlyMap<string, Brick>;
  readonly lookup: PartLookup;
}

/** A brick, by the uses of submodels around it. */
interface Entry {
  readonly id: string;
  readonly uses: readonly string[];
  readonly submodels: readonly string[];
  readonly steps: readonly number[];
}

/** A use of a submodel to build as a sub-assembly, and its bricks. */
interface Use {
  readonly key: string;
  readonly name: string;
  readonly entries: Entry[];
}

/** What a step of the model adds, in the file's order: bricks of its own, and sub-assemblies. */
type Item = { readonly brick: string } | { readonly use: string };

/** A use of a submodel needs this many bricks to be worth pages of its own. */
const SMALLEST_ASSEMBLY = 2;

/** The bricks by the uses around them; a model that is a single submodel used once is that submodel. */
function entriesOf(bricks: readonly SteppedBrick[]): Entry[] {
  let entries: Entry[] = bricks.map(({ id, group, submodels, steps }) => ({ id, uses: group === '' ? [] : group.split('/'), submodels, steps }));
  const first = (): string | undefined => entries[0]?.uses[0];
  while (entries.length > 0 && first() !== undefined && entries.every((e) => e.uses[0] === first())) {
    entries = entries.map((e) => ({ id: e.id, uses: e.uses.slice(1), submodels: e.submodels.slice(1), steps: e.steps.slice(1) }));
  }
  return entries;
}

/** "10156 - TRUCK.LDR" → "10156 - TRUCK", short enough for a sub-assembly's name. */
function assemblyName(file: string): string {
  const name = file.trim().replace(/\.(?:ldr|mpd|l3b|dat)$/i, '').trim().slice(0, MAX_ASSEMBLY_NAME).trim();
  return name || 'Sub-assembly';
}

/** Names, a second use of one numbered: "Wheel", "Wheel 2". */
function numbered(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name.slice(0, MAX_ASSEMBLY_NAME - String(n).length - 1).trim()} ${n}`;
  });
}

/** Uses of submodels with bricks enough to build on their own, as many as a file can keep, in the model's order. */
function usesOf(entries: readonly Entry[]): Map<string, Use> {
  const uses = new Map<string, Use>();
  for (const entry of entries) {
    const key = entry.uses[0];
    if (key === undefined) continue;
    const use = uses.get(key);
    if (use) use.entries.push(entry);
    else uses.set(key, { key, name: assemblyName(entry.submodels[0] ?? ''), entries: [entry] });
  }
  const kept = [...uses.values()].filter((use) => use.entries.length >= SMALLEST_ASSEMBLY).slice(0, MAX_ASSEMBLIES);
  return new Map(kept.map((use) => [use.key, use]));
}

/** Groups values by a number, keeping their order. */
function groupBy<T>(values: readonly T[], keyOf: (value: T) => number): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    const group = groups.get(key);
    if (group) group.push(value);
    else groups.set(key, [value]);
  }
  return groups;
}

/** What each step of the model adds, by step, in the file's order: a brick of a use not kept goes in loose. */
function itemsByStep(entries: readonly Entry[], uses: ReadonlyMap<string, Use>): Map<number, Item[]> {
  const added = new Set<string>();
  const items = entries.flatMap((entry): { readonly step: number; readonly item: Item }[] => {
    const key = entry.uses[0];
    const use = key === undefined ? undefined : uses.get(key);
    if (use && added.has(use.key)) return [];
    if (use) added.add(use.key);
    return [{ step: entry.steps[0] ?? 0, item: use ? { use: use.key } : { brick: entry.id } }];
  });
  return new Map([...groupBy(items, (i) => i.step)].map(([step, group]) => [step, group.map((i) => i.item)]));
}

/** Bricks planned bottom up, as BrickBench plans a model's steps. */
function bottomUp(ids: readonly string[], context: SeedContext): string[][] {
  const bricks = ids.flatMap((id) => {
    const brick = context.bricks.get(id);
    return brick ? [brick] : [];
  });
  return planSteps(bricks, context.lookup, DEFAULT_STEP_OPTIONS).map((step) => step.added.map((b) => b.id));
}

const bricksOf = (items: readonly Item[]): string[] => items.flatMap((item) => ('brick' in item ? [item.brick] : []));
const usesIn = (items: readonly Item[]): string[] => items.flatMap((item) => ('use' in item ? [item.use] : []));

/**
 * The model's steps: one for each of its own, adding its bricks and the
 * first sub-assembly it uses, the others each in a step just after. In a
 * model without steps, its bricks are planned bottom up between the
 * sub-assemblies, in the file's order.
 */
function modelSteps(byStep: ReadonlyMap<number, readonly Item[]>, context: SeedContext): PlanStep[] {
  const order = [...byStep.keys()].sort((a, b) => a - b);
  if (order.length > 1) {
    return order.flatMap((step) => {
      const items = byStep.get(step) ?? [];
      const [first, ...rest] = usesIn(items);
      const own: PlanStep = first === undefined ? { bricks: bricksOf(items) } : { bricks: bricksOf(items), assembly: first };
      return [own, ...rest.map((assembly): PlanStep => ({ bricks: [], assembly }))];
    });
  }
  const steps: PlanStep[] = [];
  let run: string[] = [];
  const endRun = (): void => {
    steps.push(...bottomUp(run, context).map((bricks): PlanStep => ({ bricks })));
    run = [];
  };
  for (const item of byStep.get(order[0] ?? 0) ?? []) {
    if ('brick' in item) {
      run.push(item.brick);
      continue;
    }
    endRun();
    steps.push({ bricks: [], assembly: item.use });
  }
  endRun();
  return steps;
}

/** A sub-assembly's steps: the submodel's own (its own submodels built within them), or planned bottom up. */
function assemblySteps(use: Use, context: SeedContext): PlanStep[] {
  const byStep = groupBy(use.entries, (entry) => entry.steps[1] ?? 0);
  if (byStep.size === 1) return bottomUp(use.entries.map((e) => e.id), context).map((bricks) => ({ bricks }));
  return [...byStep.keys()].sort((a, b) => a - b).map((step) => ({ bricks: (byStep.get(step) ?? []).map((e) => e.id) }));
}

/** The plan an LDraw model's steps and submodels make, or none when it has neither. */
export function seedPlan(bricks: readonly SteppedBrick[], context: SeedContext): InstructionPlan | undefined {
  const entries = entriesOf(bricks);
  const uses = usesOf(entries);
  const byStep = itemsByStep(entries, uses);
  if (byStep.size < 2 && uses.size === 0) return undefined;
  const kept = [...uses.values()];
  const names = numbered(kept.map((use) => use.name));
  const assemblies: Assembly[] = kept.map((use, i) => ({ id: `assembly-${i + 1}`, name: names[i] ?? use.name, steps: assemblySteps(use, context) }));
  const ids = new Map(kept.map((use, i) => [use.key, assemblies[i]?.id ?? '']));
  const steps = modelSteps(byStep, context).map((step) => (step.assembly === undefined ? step : { ...step, assembly: ids.get(step.assembly) ?? step.assembly }));
  return { steps: steps.filter((step) => step.bricks.length > 0 || step.assembly !== undefined), assemblies };
}
