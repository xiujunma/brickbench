import { describe, expect, it } from 'bun:test';
import {
  BRICK_HEIGHT,
  PLATE_HEIGHT,
  normalizeRotation,
  rotateCell,
  rotatePoint,
  rotatedSize,
  type Rotation,
} from './grid';

const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];

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

describe('rotatedSize', () => {
  it('keeps the footprint for half turns and swaps it for quarter turns', () => {
    expect(rotatedSize(4, 2, 0)).toEqual({ w: 4, d: 2 });
    expect(rotatedSize(4, 2, 1)).toEqual({ w: 2, d: 4 });
    expect(rotatedSize(4, 2, 2)).toEqual({ w: 4, d: 2 });
    expect(rotatedSize(4, 2, 3)).toEqual({ w: 2, d: 4 });
  });
});

describe('rotateCell', () => {
  it('matches a quarter turn of the part about +Y', () => {
    expect(rotateCell(0, 0, 4, 2, 1)).toEqual([0, 3]);
    expect(rotateCell(3, 0, 4, 2, 1)).toEqual([0, 0]);
    expect(rotateCell(3, 1, 4, 2, 1)).toEqual([1, 0]);
  });

  it('maps every cell to a unique cell inside the rotated footprint', () => {
    for (const r of ROTATIONS) {
      const size = rotatedSize(3, 2, r);
      const seen = new Set<string>();
      for (let x = 0; x < 3; x++) {
        for (let z = 0; z < 2; z++) {
          const [rx, rz] = rotateCell(x, z, 3, 2, r);
          expect(rx).toBeGreaterThanOrEqual(0);
          expect(rx).toBeLessThan(size.w);
          expect(rz).toBeGreaterThanOrEqual(0);
          expect(rz).toBeLessThan(size.d);
          seen.add(`${rx},${rz}`);
        }
      }
      expect(seen.size).toBe(6);
    }
  });

  it('agrees with rotatePoint on cell centres', () => {
    const w = 3;
    const d = 2;
    for (const r of ROTATIONS) {
      const size = rotatedSize(w, d, r);
      for (let x = 0; x < w; x++) {
        for (let z = 0; z < d; z++) {
          const [px, pz] = rotatePoint(x + 0.5 - w / 2, z + 0.5 - d / 2, r);
          const [rx, rz] = rotateCell(x, z, w, d, r);
          expect(px).toBeCloseTo(rx + 0.5 - size.w / 2);
          expect(pz).toBeCloseTo(rz + 0.5 - size.d / 2);
        }
      }
    }
  });
});
