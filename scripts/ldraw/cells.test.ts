import { describe, expect, it } from 'bun:test';
import type { SolidBox } from '../../src/core/ldraw/format.ts';
import { filledCells } from './cells.ts';
import type { MeshTriangle } from './mesh.ts';
import type { V3 } from './parse.ts';

/** A plate's height, in studs. */
const P = 0.4;

/** The twelve triangles of a closed box between two corners, in editor units. */
function box([x0, y0, z0]: V3, [x1, y1, z1]: V3): MeshTriangle[] {
  const v: V3[] = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]];
  return quads.flatMap(([a = 0, b = 0, c = 0, d = 0]) => [
    { a: v[a] as V3, b: v[b] as V3, c: v[c] as V3 },
    { a: v[a] as V3, b: v[c] as V3, c: v[d] as V3 },
  ]);
}

/** The cells boxes cover, as sorted "x,y,z" keys, to compare shapes however they are split into boxes. */
function cellsOf(boxes: readonly SolidBox[] | null): string[] {
  const keys: string[] = [];
  for (const [x0, y0, z0, x1, y1, z1] of boxes ?? []) {
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) keys.push(`${x},${y},${z}`);
  }
  return keys.sort();
}

/** Every cell of a w × h × d box but the ones listed. */
function allBut(w: number, h: number, d: number, ...free: string[]): string[] {
  const keys: string[] = [];
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) keys.push(`${x},${y},${z}`);
  return keys.filter((key) => !free.includes(key)).sort();
}

/** The four walls of a w × d box with walls t thick, from y0 to y1. */
function walls(w: number, d: number, t: number, y0: number, y1: number): MeshTriangle[] {
  const [x, z] = [w / 2, d / 2];
  return [
    ...box([-x, y0, -z], [x, y1, -z + t]),
    ...box([-x, y0, z - t], [x, y1, z]),
    ...box([-x, y0, -z + t], [-x + t, y1, z - t]),
    ...box([x - t, y0, -z + t], [x, y1, z - t]),
  ];
}

describe('filledCells', () => {
  it('fills every cell of a solid block, though no face runs through them', () => {
    expect(filledCells(box([-1, 0, -1], [1, 3 * P, 1]), { w: 2, d: 2, h: 3 })).toBeNull();
  });

  it('leaves the missing corner of an L-shaped plate free', () => {
    const plate = [...box([-1, 0, -1], [1, P, 0]), ...box([-1, 0, 0], [0, P, 1])];
    expect(filledCells(plate, { w: 2, d: 2, h: 1 })).toEqual([
      [0, 0, 0, 2, 1, 1],
      [0, 0, 1, 1, 1, 2],
    ]);
  });

  it('leaves the opening under an arch free', () => {
    const arch = [...box([-1.5, 0, -0.5], [-0.5, 2 * P, 0.5]), ...box([0.5, 0, -0.5], [1.5, 2 * P, 0.5]), ...box([-1.5, P, -0.5], [1.5, 2 * P, 0.5])];
    expect(cellsOf(filledCells(arch, { w: 3, d: 1, h: 2 }))).toEqual(allBut(3, 2, 1, '1,0,0'));
  });

  it('counts the hollow underside of a brick as filled', () => {
    const brick = [...walls(3, 3, 0.2, 0, 3 * P), ...box([-1.3, 3 * P - 0.2, -1.3], [1.3, 3 * P, 1.3])];
    expect(filledCells(brick, { w: 3, d: 3, h: 3 })).toBeNull();
  });

  it('leaves the inside of a box open at the top free', () => {
    const container = [...box([-1.5, 0, -1.5], [1.5, P, 1.5]), ...walls(3, 3, 0.2, P, 3 * P)];
    expect(cellsOf(filledCells(container, { w: 3, d: 3, h: 3 }))).toEqual(allBut(3, 3, 3, '1,1,1', '1,2,1'));
  });

  it('leaves the space under an overhang free when it is open to the side', () => {
    // a plate on one leg, like a bracket
    const bracket = [...box([-0.5, P, -1], [0.5, 2 * P, 1]), ...box([-0.5, 0, -1], [0.5, P, 0])];
    expect(cellsOf(filledCells(bracket, { w: 1, d: 2, h: 2 }))).toEqual(allBut(1, 2, 2, '0,0,1'));
  });

  it('fills the cells a thin wall stands in', () => {
    const panel = [...box([-0.5, 0, -0.5], [0.5, P, 0.5]), ...box([-0.5, P, -0.5], [0.5, 3 * P, -0.3])];
    expect(filledCells(panel, { w: 1, d: 1, h: 3 })).toBeNull();
  });

  it('fills the cells a single sheet crosses, such as a flag', () => {
    const flag: MeshTriangle[] = [
      { a: [0, P, -0.3], b: [0, 3 * P, -0.3], c: [0, 3 * P, 0.3], doubleSided: true },
      { a: [0, P, -0.3], b: [0, 3 * P, 0.3], c: [0, P, 0.3], doubleSided: true },
    ];
    expect(filledCells([...box([-0.5, 0, -0.5], [0.5, P, 0.5]), ...flag], { w: 1, d: 1, h: 3 })).toBeNull();
  });

  it('ignores a sliver reaching less than two LDraw units into the next cell', () => {
    expect(filledCells(box([-1, 0, -0.5], [0.08, P, 0.5]), { w: 2, d: 1, h: 1 })).toEqual([[0, 0, 0, 1, 1, 1]]);
    expect(filledCells(box([-1, 0, -0.5], [0.12, P, 0.5]), { w: 2, d: 1, h: 1 })).toBeNull();
  });

  it('treats mirror images alike, even exactly a sliver into a cell', () => {
    // a bar reaching exactly two LDraw units either side of the line between two rows of cells
    expect(filledCells(box([-1, 0, -0.1], [1, P, 0.1]), { w: 2, d: 2, h: 1 })).toBeNull();
    expect(filledCells(box([-0.1, 0, -1], [0.1, P, 1]), { w: 2, d: 2, h: 1 })).toBeNull();
  });

  it('keeps a solid body solid where it overhangs its box', () => {
    // a block sticking out 0.15 studs on every side (fit.ts allows 0.2), with a small hollow inside
    const block = [...box([-1.65, 0, -1.65], [1.65, 3 * P, 1.65]), ...box([-0.2, 0.5, -0.2], [0.2, 0.7, 0.2])];
    expect(filledCells(block, { w: 3, d: 3, h: 3 })).toBeNull();
  });

  it('ignores the studs on top and anything else outside the box', () => {
    const plate = [...box([-1, 0, -0.5], [0, P, 0.5]), ...box([-0.8, P, -0.3], [-0.2, P + 0.2, 0.3]), ...box([-1.1, 0, -0.5], [-1, P, 0.5])];
    expect(filledCells(plate, { w: 2, d: 1, h: 1 })).toEqual([[0, 0, 0, 1, 1, 1]]);
  });

  it('keeps the whole box when there is nothing to measure or too much', () => {
    expect(filledCells([], { w: 2, d: 2, h: 1 })).toBeNull();
    expect(filledCells(box([0, 0, 0], [1, P, 1]), { w: 256, d: 256, h: 1023 })).toBeNull();
  });
});
