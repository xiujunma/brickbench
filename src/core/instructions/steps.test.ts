import { describe, expect, it } from 'bun:test';
import { makeBrick } from '../model/testUtils';
import type { Brick } from '../model/types';
import { getPart } from '../parts/catalog';
import { planSteps, type StepOptions } from './steps';

const layers: StepOptions = { order: 'layers', partsPerStep: 4 };
const ids = (steps: ReturnType<typeof planSteps>) => steps.map((step) => step.added.map((b) => b.id));

describe('planSteps', () => {
  it('returns no steps for an empty model', () => {
    expect(planSteps([], getPart, layers)).toEqual([]);
  });

  it('builds the bottom layer first, whatever order the bricks were placed in', () => {
    const steps = planSteps(
      [makeBrick({ id: 'top', y: 3 }), makeBrick({ id: 'bottom', y: 0 })],
      getPart,
      { order: 'layers', partsPerStep: 1 },
    );
    expect(ids(steps)).toEqual([['bottom'], ['top']]);
  });

  it('uses every brick exactly once and never overfills a step', () => {
    const bricks: Brick[] = Array.from({ length: 23 }, (_, i) =>
      makeBrick({ id: `b${i}`, x: (i % 6) * 4, y: Math.floor(i / 6) * 3 }),
    );
    const steps = planSteps(bricks, getPart, layers);
    const used = steps.flatMap((step) => step.added.map((b) => b.id));
    expect([...used].sort()).toEqual(bricks.map((b) => b.id).sort());
    expect(steps.every((step) => step.added.length >= 1 && step.added.length <= 4)).toBe(true);
  });

  it('keeps bricks that sit near each other in the same step', () => {
    const bricks = [
      makeBrick({ id: 'nearA', x: 0 }),
      makeBrick({ id: 'farA', x: 40 }),
      makeBrick({ id: 'nearB', x: 4 }),
      makeBrick({ id: 'farB', x: 44 }),
    ];
    const steps = planSteps(bricks, getPart, { order: 'layers', partsPerStep: 2 });
    expect(ids(steps)).toEqual([['nearA', 'nearB'], ['farA', 'farB']]);
  });

  it('merges small layers into one step when they fit', () => {
    const bricks = [
      makeBrick({ id: 'a', y: 0 }),
      makeBrick({ id: 'b', y: 0, x: 4 }),
      makeBrick({ id: 'c', y: 3 }),
      makeBrick({ id: 'd', y: 6 }),
    ];
    expect(ids(planSteps(bricks, getPart, { order: 'layers', partsPerStep: 3 }))).toEqual([['a', 'b', 'c'], ['d']]);
  });

  it('follows the build order when asked', () => {
    const bricks = ['e', 'a', 'd', 'b', 'c'].map((id, i) => makeBrick({ id, y: 12 - i * 3 }));
    const steps = planSteps(bricks, getPart, { order: 'build-order', partsPerStep: 2 });
    expect(ids(steps)).toEqual([['e', 'a'], ['d', 'b'], ['c']]);
  });

  it('plans a large single-layer mosaic quickly', () => {
    const tiles: Brick[] = [];
    for (let z = 0; z < 140; z++) {
      for (let x = 0; x < 140; x++) tiles.push(makeBrick({ id: `t${x}-${z}`, partId: 'plate-1x1', x: x - 70, z: z - 70 }));
    }
    const started = performance.now();
    const steps = planSteps(tiles, getPart, { order: 'layers', partsPerStep: 20 });
    expect(performance.now() - started).toBeLessThan(1500);
    expect(steps.reduce((sum, step) => sum + step.added.length, 0)).toBe(tiles.length);
    // each step stays compact: no group spans more than a few studs
    for (const step of steps.slice(0, 50)) {
      const xs = step.added.map((b) => b.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(25);
    }
  });

  it('treats a step size below one as one', () => {
    const steps = planSteps([makeBrick({ id: 'a' }), makeBrick({ id: 'b', x: 4 })], getPart, { order: 'layers', partsPerStep: 0 });
    expect(steps).toHaveLength(2);
  });
});
