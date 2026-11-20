import { describe, expect, it } from 'bun:test';
import { getColor } from '../../colors';
import type { InstructionPlan } from '../../instructions/plan';
import { partNumbersOf } from '../../inventory/match';
import { createIdFactory } from '../../model/ids';
import { makeBrick } from '../../model/testUtils';
import type { Brick, Model } from '../../model/types';
import { PARTS, getPart } from '../../parts/catalog';
import { MAX_ASSEMBLIES } from '../planFile';
import { importLDraw } from './importLDraw';
import { seedPlan, type SteppedBrick } from './seedPlan';

const NUMBERS = partNumbersOf(PARTS, [], new Map());

function opened(lines: readonly string[]): Model {
  const result = importLDraw(lines.join('\n'), 'model.mpd', { lookup: getPart, numbers: NUMBERS, nextId: createIdFactory('t') });
  if (!result.ok) throw new Error(result.error);
  return result.value.doc.model;
}

const line = (colour: number, x: number, y: number, file: string): string => `1 ${colour} ${x} ${y} 0 1 0 0 0 1 0 0 0 1 ${file}`;

/** A plan with each brick named by its colour, and its part when two share one. */
function named(model: Model, withParts = false) {
  const name = (id: string): string => {
    const brick = model.bricks.get(id);
    const colour = getColor(brick?.colorId ?? -1)?.name ?? '?';
    return withParts ? `${colour} ${brick?.partId}` : colour;
  };
  const steps = (list: InstructionPlan['steps']) => list.map((s) => [s.bricks.map(name), model.plan?.assemblies.find((a) => a.id === s.assembly)?.name ?? null]);
  return {
    steps: steps(model.plan?.steps ?? []),
    assemblies: (model.plan?.assemblies ?? []).map((a) => ({ name: a.name, steps: a.steps.map((s) => s.bricks.map(name)) })),
  };
}

describe('steps of an opened LDraw model', () => {
  it('follows the model’s own steps', () => {
    const model = opened([line(4, 0, 0, '3001.dat'), line(1, 100, 0, '3001.dat'), '0 STEP', line(14, 0, -24, '3001.dat'), '0 STEP']);
    expect(named(model)).toEqual({ steps: [[['Red', 'Blue'], null], [['Yellow'], null]], assemblies: [] });
  });

  it('leaves a model with neither steps nor submodels to be planned like any other', () => {
    expect(opened([line(4, 0, 0, '3001.dat'), line(1, 100, 0, '3001.dat')]).plan).toBeUndefined();
  });

  it('builds each use of a submodel on pages of its own, added at the step that uses it', () => {
    const model = opened([
      '0 FILE house.ldr',
      line(4, 0, 0, '3001.dat'),
      line(16, 0, -24, 'roof.ldr'),
      '0 STEP',
      line(0, 200, 0, 'wheel.ldr'),
      line(15, 300, 0, 'wheel.ldr'),
      // a submodel of one part is no sub-assembly
      line(2, 400, 0, 'pin.ldr'),
      '0 FILE roof.ldr',
      line(1, 0, 0, '3001.dat'),
      '0 STEP',
      line(14, 0, -24, '3001.dat'),
      '0 FILE wheel.ldr',
      line(16, 0, 0, '3003.dat'),
      line(16, 0, -24, '3003.dat'),
      '0 FILE pin.ldr',
      line(16, 0, 0, '3004.dat'),
    ]);
    expect(named(model, true)).toEqual({
      steps: [
        [['Red brick-2x4'], 'roof'],
        // a step using two sub-assemblies adds the second just after
        [['Green brick-1x2'], 'wheel'],
        [[], 'wheel 2'],
      ],
      assemblies: [
        { name: 'roof', steps: [['Blue brick-2x4'], ['Yellow brick-2x4']] },
        // a submodel without steps of its own has them planned bottom up
        { name: 'wheel', steps: [['Black brick-2x2', 'Black brick-2x2']] },
        { name: 'wheel 2', steps: [['White brick-2x2', 'White brick-2x2']] },
      ],
    });
  });

  it('builds a submodel’s own submodels within its steps', () => {
    const model = opened([
      '0 FILE main.ldr',
      line(4, 0, 0, '3001.dat'),
      '0 STEP',
      line(16, 200, 0, 'car.ldr'),
      '0 FILE car.ldr',
      line(1, 0, 0, '3001.dat'),
      '0 STEP',
      line(16, 0, -24, 'seat.ldr'),
      '0 FILE seat.ldr',
      line(14, 0, 0, '3003.dat'),
      line(15, 0, -24, '3003.dat'),
    ]);
    expect(named(model)).toEqual({
      steps: [[['Red'], null], [[], 'car']],
      assemblies: [{ name: 'car', steps: [['Blue'], ['Yellow', 'White']] }],
    });
  });

  it('takes a model that is a single submodel for that submodel', () => {
    const model = opened([
      '0 FILE main.ldr',
      line(16, 0, 0, 'tower.ldr'),
      '0 FILE tower.ldr',
      line(4, 0, 0, '3001.dat'),
      '0 STEP',
      line(1, 0, -24, '3001.dat'),
    ]);
    expect(named(model)).toEqual({ steps: [[['Red'], null], [['Blue'], null]], assemblies: [] });
  });

  it('plans the parts of a model without steps bottom up, between the sub-assemblies, in the file’s order', () => {
    const model = opened([
      '0 FILE main.ldr',
      line(4, 0, 0, '3001.dat'),
      line(1, 100, 0, '3001.dat'),
      line(16, 0, -24, 'roof.ldr'),
      line(14, 200, 0, '3001.dat'),
      '0 FILE roof.ldr',
      line(15, 0, 0, '3001.dat'),
      line(0, 0, -24, '3001.dat'),
    ]);
    expect(named(model)).toEqual({
      steps: [[['Red', 'Blue'], null], [[], 'roof'], [['Yellow'], null]],
      assemblies: [{ name: 'roof', steps: [['White', 'Black']] }],
    });
  });
});

describe('seedPlan', () => {
  const bricksFor = (stepped: readonly SteppedBrick[]): ReadonlyMap<string, Brick> =>
    new Map(stepped.map((s, i) => [s.id, makeBrick({ id: s.id, x: (i % 40) * 4, z: Math.floor(i / 40) * 2 })]));

  it('makes no more sub-assemblies than a file can keep, the rest of their bricks going in loose', () => {
    const stepped: SteppedBrick[] = Array.from({ length: (MAX_ASSEMBLIES + 2) * 2 }, (_, i) => ({
      id: `b${i}`,
      group: String(Math.floor(i / 2)),
      submodels: ['part.ldr'],
      steps: [0, 0],
    }));
    const plan = seedPlan(stepped, { bricks: bricksFor(stepped), lookup: getPart });
    expect(plan?.assemblies).toHaveLength(MAX_ASSEMBLIES);
    expect(plan?.steps.filter((s) => s.assembly !== undefined)).toHaveLength(MAX_ASSEMBLIES);
    expect(plan?.steps.at(-1)?.bricks).toEqual(['b2000', 'b2001', 'b2002', 'b2003']);
  });

  it('names sub-assemblies after their submodels, briefly, and numbers a name used again', () => {
    const long = `${'Very '.repeat(20)}long.ldr`;
    const uses = ['Wheel.LDR', 'Wheel.LDR', ' .ldr', long];
    const stepped: SteppedBrick[] = uses.flatMap((name, use) =>
      [0, 1].map((n) => ({ id: `u${use}-${n}`, group: String(use), submodels: [name], steps: [0, 0] })),
    );
    const names = seedPlan(stepped, { bricks: bricksFor(stepped), lookup: getPart })?.assemblies.map((a) => a.name);
    expect(names?.slice(0, 3)).toEqual(['Wheel', 'Wheel 2', 'Sub-assembly']);
    expect(names?.[3]).toHaveLength(59);
    expect(names?.[3]?.startsWith('Very Very')).toBe(true);
  });
});
