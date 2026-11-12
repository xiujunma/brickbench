import type { Brick } from './types';

/** Builds a brick for tests; defaults to a red 2×4 brick at the origin. */
export function makeBrick(overrides: Partial<Brick> = {}): Brick {
  return {
    id: 'b1',
    partId: 'brick-2x4',
    colorId: 4,
    x: 0,
    y: 0,
    z: 0,
    r: 0,
    ...overrides,
  };
}
