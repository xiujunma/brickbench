import { describe, expect, it } from 'bun:test';
import { getPart } from '../parts/catalog';
import { GRID_LIMIT } from '../grid';
import { buildSpatialIndex, collides, isOutOfBounds } from './spatial';
import { makeBrick } from './testUtils';

const lookup = getPart;

describe('spatial index', () => {
  const base = makeBrick({ id: 'base' });
  const index = buildSpatialIndex([base], lookup);

  it('reports the owner of occupied cells', () => {
    expect(index.owner(0, 0, 0)).toBe('base');
    expect(index.owner(3, 2, 1)).toBe('base');
    expect(index.owner(4, 0, 0)).toBeUndefined();
    expect(index.owner(0, 3, 0)).toBeUndefined();
  });

  it('detects overlapping bricks', () => {
    expect(collides(index, [makeBrick({ id: 'n', x: 3, z: 1 })], lookup)).toBe(true);
    expect(collides(index, [makeBrick({ id: 'n', y: 3 })], lookup)).toBe(false);
    expect(collides(index, [makeBrick({ id: 'n', x: 4 })], lookup)).toBe(false);
  });

  it('ignores bricks that are being moved', () => {
    expect(collides(index, [makeBrick({ id: 'n', x: 1 })], lookup, new Set(['base']))).toBe(false);
  });

  it('lets a plate sit inside an arch opening', () => {
    const arch = buildSpatialIndex([makeBrick({ id: 'arch', partId: 'arch-1x4' })], lookup);
    expect(collides(arch, [makeBrick({ id: 'p', partId: 'plate-1x2', x: 1 })], lookup)).toBe(false);
    expect(collides(arch, [makeBrick({ id: 'p', partId: 'brick-1x2', x: 1 })], lookup)).toBe(true);
  });
});

describe('isOutOfBounds', () => {
  it('accepts bricks on the grid', () => {
    expect(isOutOfBounds(makeBrick(), lookup)).toBe(false);
  });

  it('rejects bricks below the ground or past the grid edge', () => {
    expect(isOutOfBounds(makeBrick({ y: -1 }), lookup)).toBe(true);
    expect(isOutOfBounds(makeBrick({ x: GRID_LIMIT - 1 }), lookup)).toBe(true);
    expect(isOutOfBounds(makeBrick({ z: -GRID_LIMIT - 1 }), lookup)).toBe(true);
  });
});
