import { describe, expect, it } from 'bun:test';
import {
  compose,
  isRotation,
  multiplyTurns,
  nearestOrientation,
  orthonormalize,
  rotateBy,
  transposeTurn,
  turnAbout,
  FACINGS,
  facingOf,
  facingOfVector,
  facingVector,
  inverse,
  isOrientation,
  isUpright,
  ORIENTATIONS,
  orientationFacing,
  orientationOfTurn,
  quarterTurn,
  rotateVector,
  spinOf,
  turnOf,
} from './orientation';

const ALL = Array.from({ length: ORIENTATIONS }, (_, o) => o);
const UP = { x: 0, y: 1, z: 0 };

function determinant([a, b, c, d, e, f, g, h, i]: readonly number[]): number {
  return a! * (e! * i! - f! * h!) - b! * (d! * i! - f! * g!) + c! * (d! * h! - e! * g!);
}

describe('orientations', () => {
  it('are the 24 turns that keep a part square to the grid, each a true rotation', () => {
    const turns = new Set(ALL.map((o) => turnOf(o).join(',')));
    expect(turns.size).toBe(24);
    for (const o of ALL) {
      expect(determinant(turnOf(o))).toBe(1);
      expect(turnOf(o).every((v) => v === -1 || v === 0 || v === 1)).toBe(true);
      expect(orientationOfTurn(turnOf(o))).toBe(o);
    }
  });

  it('turn the first four about the vertical, as bricks have always turned', () => {
    // a quarter turn takes +X to -Z, as three.js rotation.y = π/2 does
    expect(rotateVector(1, { x: 1, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: -1 });
    expect(rotateVector(2, { x: 1, y: 0, z: 0 })).toEqual({ x: -1, y: 0, z: 0 });
    for (const o of [0, 1, 2, 3]) {
      expect(isUpright(o)).toBe(true);
      expect(rotateVector(o, UP)).toEqual(UP);
    }
    expect(isUpright(4)).toBe(false);
  });

  it('point the part’s top along their facing, with their spin', () => {
    for (const o of ALL) {
      const top = rotateVector(o, UP);
      expect(facingOfVector(top)).toBe(facingOf(o));
      expect(orientationFacing(facingOf(o), spinOf(o))).toBe(o);
    }
    expect(FACINGS.map((facing) => facingVector(facing))).toContainEqual({ x: 0, y: 0, z: -1 });
    expect(orientationFacing('+y', -1)).toBe(3);
  });

  it('compose and undo', () => {
    for (const a of ALL) {
      expect(compose(a, inverse(a))).toBe(0);
      for (const b of [0, 5, 13, 22]) {
        const v = { x: 1, y: 2, z: 3 };
        expect(rotateVector(compose(a, b), v)).toEqual(rotateVector(a, rotateVector(b, v)));
      }
    }
  });

  it('come from rotations close enough to square, and only those', () => {
    expect(orientationOfTurn([1.000015, 0, 0, 0, 1, 0, 0, 0, 1], 1e-3)).toBe(0);
    expect(orientationOfTurn([0.707, 0, 0.707, 0, 1, 0, -0.707, 0, 0.707], 1e-3)).toBeNull();
    // mirrored
    expect(orientationOfTurn([-1, 0, 0, 0, 1, 0, 0, 0, 1])).toBeNull();
    expect(facingOfVector({ x: 0.6, y: 0.8, z: 0 })).toBeNull();
  });

  it('make quarter turns about each world axis that come round in four', () => {
    expect(quarterTurn('y', 1)).toBe(1);
    expect(quarterTurn('y', -1)).toBe(3);
    for (const axis of ['x', 'y', 'z'] as const) {
      let o = 0;
      for (let i = 0; i < 4; i++) o = compose(quarterTurn(axis, 1), o);
      expect(o).toBe(0);
      expect(compose(quarterTurn(axis, 1), quarterTurn(axis, -1))).toBe(0);
    }
    // a quarter turn about X tips the top towards +Z
    expect(rotateVector(quarterTurn('x', 1), UP)).toEqual({ x: 0, y: 0, z: 1 });
    expect(isOrientation(23)).toBe(true);
    expect(isOrientation(24)).toBe(false);
    expect(isOrientation(1.5)).toBe(false);
  });
});

describe('rotations at any angle', () => {
  it('turn about an axis, undo by their transpose, and stay rotations', () => {
    const eighth = turnAbout({ x: 0, y: 1, z: 0 }, Math.PI / 4);
    expect(isRotation(eighth)).toBe(true);
    const v = rotateBy(eighth, { x: 1, y: 0, z: 0 });
    expect(v.x).toBeCloseTo(Math.SQRT1_2);
    expect(v.z).toBeCloseTo(-Math.SQRT1_2);
    const back = rotateBy(transposeTurn(eighth), v);
    expect(back.x).toBeCloseTo(1);
    expect(back.z).toBeCloseTo(0);
    // two eighths make a quarter turn, as orientation 1 is
    const quarter = multiplyTurns(eighth, eighth);
    expect(orientationOfTurn(quarter, 1e-9)).toBe(1);
  });

  it('tell rotations from mirror images and other matrices', () => {
    expect(isRotation([1, 0, 0, 0, 1, 0, 0, 0, 1])).toBe(true);
    expect(isRotation([-1, 0, 0, 0, 1, 0, 0, 0, 1])).toBe(false);
    expect(isRotation([2, 0, 0, 0, 1, 0, 0, 0, 1])).toBe(false);
    expect(isRotation([1, 0.1, 0, 0, 1, 0, 0, 0, 1])).toBe(false);
    expect(isRotation([1, 0, 0])).toBe(false);
  });

  it('find the square orientation nearest any rotation', () => {
    for (const o of [0, 1, 6, 13, 22]) expect(nearestOrientation(turnOf(o))).toBe(o);
    // a little past a quarter turn about the vertical is nearest a quarter turn
    expect(nearestOrientation(turnAbout({ x: 0, y: 1, z: 0 }, Math.PI / 2 + 0.2))).toBe(1);
    expect(isUpright(nearestOrientation(turnAbout({ x: 1, y: 0, z: 0 }, 0.3)))).toBe(true);
  });

  it('square up rotations rounded in files', () => {
    const rounded = [0.7071, 0, 0.7071, 0, 1, 0, -0.7071, 0, 0.7071];
    const squared = orthonormalize(rounded);
    expect(isRotation(squared, 1e-12)).toBe(true);
    expect(squared[0]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(Object.is(squared[1], -0)).toBe(false);
  });
});
