import { describe, expect, it } from 'bun:test';
import { BRICK_HEIGHT, PLATE_HEIGHT, normalizeRotation, onLduLattice, snapToLdu } from './grid';

describe('grid constants', () => {
  it('stacks three plates into one brick', () => {
    expect(BRICK_HEIGHT).toBeCloseTo(PLATE_HEIGHT * 3);
  });
});

describe('normalizeRotation', () => {
  it.each([
    [0, 0],
    [1, 1],
    [4, 0],
    [5, 1],
    [-1, 3],
    [-6, 2],
  ] as const)('normalizes %i to %i', (input, expected) => {
    expect(normalizeRotation(input)).toBe(expected);
  });
});

describe('the LDraw unit lattice', () => {
  it('holds every twentieth of a stud and eighth of a plate, and nothing between', () => {
    expect(onLduLattice(1.05, 20)).toBe(true);
    expect(onLduLattice(0.1 + 0.2, 20)).toBe(true);
    expect(onLduLattice(1 / 3, 20)).toBe(false);
    expect(onLduLattice(2.625, 8)).toBe(true);
    expect(snapToLdu(0.1 + 0.2, 20)).toBe(0.3);
    expect(snapToLdu(-0.01, 20)).toBe(0);
    expect(Object.is(snapToLdu(-0.01, 20), -0)).toBe(false);
  });
});
