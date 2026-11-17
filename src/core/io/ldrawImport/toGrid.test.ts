import { describe, expect, it } from 'bun:test';
import type { Rotation } from '../../grid';
import { modelFromBricks } from '../../model/model';
import { PARTS, getPart } from '../../parts/catalog';
import { toLDraw } from '../ldraw';
import type { M3, V3 } from './read';
import { gridSpotOf, latticeOf, quarterTurnOf, snapToLattice } from './toGrid';

const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];

/** The position and matrix of the one part line an export writes. */
function exported(partId: string, x: number, y: number, z: number, r: Rotation): { position: V3; matrix: M3 } {
  const model = modelFromBricks([{ id: 'b', partId, colorId: 4, x, y, z, r }]);
  const line = toLDraw('t', model, getPart).text.split('\r\n').find((l) => l.startsWith('1 '));
  const numbers = (line ?? '').split(' ').slice(2, 14).map(Number);
  return { position: numbers.slice(0, 3) as unknown as V3, matrix: numbers.slice(3) as unknown as M3 };
}

describe('quarterTurnOf', () => {
  it('reads back each quarter turn the exporter writes', () => {
    for (const r of ROTATIONS) expect(quarterTurnOf(exported('brick-2x4', 0, 0, 0, r).matrix)).toBe(r);
  });

  it('allows for the rounding editors leave in their numbers', () => {
    expect(quarterTurnOf([0.99999, 0, 0.0002, 0, 1.000015, 0, -0.0001, 0, 1])).toBe(0);
  });

  it('refuses parts tipped over, on their side, mirrored or at an angle', () => {
    const half = Math.SQRT1_2;
    const matrices: M3[] = [
      [1, 0, 0, 0, -1, 0, 0, 0, -1],
      [1, 0, 0, 0, 0, -1, 0, 1, 0],
      [-1, 0, 0, 0, 1, 0, 0, 0, 1],
      [half, 0, -half, 0, 1, 0, half, 0, half],
    ];
    for (const matrix of matrices) expect(quarterTurnOf(matrix)).toBeNull();
  });
});

describe('gridSpotOf', () => {
  it('undoes the export for every built-in part, turned every way', () => {
    for (const part of PARTS.filter((p) => p.ldraw)) {
      for (const r of ROTATIONS) {
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
  it('finds the grid most parts share, even half a stud and a few LDU over', () => {
    const spots = [
      { x: 0.5, y: 0.005, z: 2 },
      { x: 3.5, y: 3.005, z: -1 },
      { x: -1.5000001, y: 1.005, z: 4.9999999 },
      { x: 0.25, y: 0.5, z: 0.5 },
    ];
    const lattice = latticeOf(spots);
    expect(lattice).toEqual({ x: 0.5, y: 0, z: 0 });
    expect(snapToLattice(spots[0]!, lattice)).toEqual({ x: 0, y: 0, z: 2 });
    expect(snapToLattice(spots[2]!, lattice)).toEqual({ x: -2, y: 1, z: 5 });
  });

  it('leaves parts between cells off the grid', () => {
    const lattice = { x: 0, y: 0, z: 0 };
    expect(snapToLattice({ x: 0.5, y: 0, z: 0 }, lattice)).toBeNull();
    expect(snapToLattice({ x: 0, y: 0.5, z: 0 }, lattice)).toBeNull();
    expect(snapToLattice({ x: 0, y: 0, z: 0.03 }, lattice)).toBeNull();
    expect(snapToLattice({ x: 0, y: 0, z: 0.02 }, lattice)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('starts at whole cells for an empty model', () => {
    expect(latticeOf([])).toEqual({ x: 0, y: 0, z: 0 });
  });
});
