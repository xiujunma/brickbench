import { describe, expect, it } from 'bun:test';
import { modelFromBricks } from '../../model/model';
import { ORIENTATIONS, type Orientation } from '../../orientation';
import { PARTS, getPart } from '../../parts/catalog';
import { toLDraw } from '../ldraw';
import type { M3, V3 } from './read';
import { gridSpotOf, latticeOf, orientationOf, snapExactly, snapToLattice } from './toGrid';

const ALL: readonly Orientation[] = Array.from({ length: ORIENTATIONS }, (_, o) => o);

/** The position and matrix of the one part line an export writes. */
function exported(partId: string, x: number, y: number, z: number, r: Orientation): { position: V3; matrix: M3 } {
  const model = modelFromBricks([{ id: 'b', partId, colorId: 4, x, y, z, r }]);
  const line = toLDraw('t', model, getPart).text.split('\r\n').find((l) => l.startsWith('1 '));
  const numbers = (line ?? '').split(' ').slice(2, 14).map(Number);
  return { position: numbers.slice(0, 3) as unknown as V3, matrix: numbers.slice(3) as unknown as M3 };
}

describe('orientationOf', () => {
  it('reads back each of the 24 ways the exporter turns a part', () => {
    for (const r of ALL) expect(orientationOf(exported('brick-2x4', 0, 0, 0, r).matrix)).toBe(r);
  });

  it('reads parts upside down and on their sides', () => {
    // LDraw's y points down: flipping it and z turns a part upside down; this one lies on its back
    expect(orientationOf([1, 0, 0, 0, -1, 0, 0, 0, -1])).toBe(4);
    expect(orientationOf([1, 0, 0, 0, 0, -1, 0, 1, 0])).toBe(16);
  });

  it('allows for the rounding editors leave in their numbers', () => {
    expect(orientationOf([0.99999, 0, 0.0002, 0, 1.000015, 0, -0.0001, 0, 1])).toBe(0);
  });

  it('refuses parts mirrored or at an angle', () => {
    const half = Math.SQRT1_2;
    const matrices: M3[] = [
      [-1, 0, 0, 0, 1, 0, 0, 0, 1],
      [half, 0, -half, 0, 1, 0, half, 0, half],
      [1, 0, 0, 0, half, -half, 0, half, half],
    ];
    for (const matrix of matrices) expect(orientationOf(matrix)).toBeNull();
  });
});

describe('gridSpotOf', () => {
  it('undoes the export for every built-in part, turned every way', () => {
    for (const part of PARTS.filter((p) => p.ldraw)) {
      for (const r of ALL) {
        const { position } = exported(part.id, 3, 7, -5, r);
        const spot = gridSpotOf(part, position, r);
        expect(spot?.x, `${part.id} r${r}`).toBeCloseTo(3, 9);
        expect(spot?.y, `${part.id} r${r}`).toBeCloseTo(7, 9);
        expect(spot?.z, `${part.id} r${r}`).toBeCloseTo(-5, 9);
      }
    }
  });

  it('has no spot for parts without an LDraw origin', () => {
    const part = getPart('brick-2x4');
    if (!part) throw new Error('missing part');
    expect(gridSpotOf({ ...part, ldraw: undefined }, [0, 0, 0], 0)).toBeNull();
  });
});

describe('lattice', () => {
  it('finds the grid most parts share, a quarter stud and a few LDU over, half studs on it as well', () => {
    const spots = [
      { x: 0.25, y: 0.005, z: 2 },
      // half a stud along: the same grid, as on a jumper plate's stud
      { x: 3.75, y: 3.005, z: -1 },
      { x: -1.7500001, y: 1.005, z: 4.9999999 },
      { x: 0.5, y: 0.5, z: 0.5 },
    ];
    const lattice = latticeOf(spots);
    expect(lattice).toEqual({ x: 0.25, y: 0, z: 0 });
    expect(snapToLattice(spots[0]!, lattice)).toEqual({ x: 0, y: 0, z: 2 });
    expect(snapToLattice(spots[1]!, lattice)).toEqual({ x: 3.5, y: 3, z: -1 });
    expect(snapToLattice(spots[2]!, lattice)).toEqual({ x: -2, y: 1, z: 5 });
    // a quarter stud off the grid, and half a plate up
    expect(snapToLattice(spots[3]!, lattice)).toBeNull();
  });

  it('keeps parts half a stud over, and leaves parts off whole and half studs, or half a plate up, off the grid', () => {
    const lattice = { x: 0, y: 0, z: 0 };
    expect(snapToLattice({ x: 0.5, y: 0, z: -1.5 }, lattice)).toEqual({ x: 0.5, y: 0, z: -1.5 });
    expect(snapToLattice({ x: 0.25, y: 0, z: 0 }, lattice)).toBeNull();
    expect(snapToLattice({ x: 0, y: 0.5, z: 0 }, lattice)).toBeNull();
    expect(snapToLattice({ x: 0, y: 0, z: 0.53 }, lattice)).toBeNull();
    expect(snapToLattice({ x: 0, y: 0, z: 0.02 }, lattice)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('places parts off the grid on the nearest whole LDraw unit along it', () => {
    const lattice = { x: 0.25, y: 0, z: 0 };
    // 1.2 studs is 24 LDU; 2.5 plates is 20 LDU; off by a hair, as editors write numbers
    expect(snapExactly({ x: 1.45000001, y: 2.5, z: -0.6 }, lattice)).toEqual({ x: 1.2, y: 2.5, z: -0.6 });
    expect(snapExactly({ x: 0.26, y: 0.06, z: 0.02 }, lattice)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('starts at whole cells for an empty model', () => {
    expect(latticeOf([])).toEqual({ x: 0, y: 0, z: 0 });
  });
});
