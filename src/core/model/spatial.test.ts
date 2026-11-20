import { describe, expect, it } from 'bun:test';
import { getPart } from '../parts/catalog';
import { GRID_LIMIT } from '../grid';
import { buildSpatialIndex, collides, createOccupancy, isOutOfBounds } from './spatial';
import { allStuds, visibleStuds } from './studs';
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

describe('bricks half a stud over', () => {
  // 1 × 2 plates along x: one half a stud over, from 0.5 to 2.5, and the next from 2.5 to 4.5
  const left = makeBrick({ id: 'left', partId: 'plate-1x2', x: 0.5 });
  const right = makeBrick({ id: 'right', partId: 'plate-1x2', x: 2.5 });
  const index = buildSpatialIndex([left, right], lookup);

  it('share the cell between them without colliding, and collide with what overlaps them by half a stud', () => {
    expect(collides(buildSpatialIndex([left], lookup), [right], lookup)).toBe(false);
    expect(collides(index, [makeBrick({ id: 'n', partId: 'plate-1x2', x: 2 })], lookup)).toBe(true);
    expect(collides(index, [makeBrick({ id: 'n', partId: 'plate-1x2', x: 4.5 })], lookup)).toBe(false);
    expect(collides(index, [makeBrick({ id: 'n', partId: 'plate-1x2', x: 4 })], lookup)).toBe(true);
    // a brick on whole studs beside one half a stud over: from -1.5 to 0.5 overlaps nothing, from -1 to 1 does
    expect(collides(index, [makeBrick({ id: 'n', partId: 'plate-1x2', x: -1.5 })], lookup)).toBe(false);
    expect(collides(index, [makeBrick({ id: 'n', partId: 'plate-1x2', x: -1 })], lookup)).toBe(true);
  });

  it('say which brick fills a point, and any brick in a cell they share', () => {
    expect(index.ownerAt(2.25, 0, 0.5)).toBe('left');
    expect(index.ownerAt(2.75, 0, 0.5)).toBe('right');
    expect(index.ownerAt(0.25, 0, 0.5)).toBeUndefined();
    expect(index.ownersIn(2, 0, 0, 0b1111)).toEqual(['left', 'right']);
    expect(index.ownersIn(2, 0, 0, 0b0101)).toEqual(['left']);
    expect(index.owner(2, 0, 0)).toBe('left');
    expect(index.owner(0, 0, 0)).toBe('left');
    // a cell filled whole by one brick in the end is one owner again
    const whole = buildSpatialIndex([makeBrick({ id: 'under', partId: 'plate-1x2', x: 1 }), makeBrick({ id: 'w', partId: 'plate-1x2', x: 1 })], lookup);
    expect(whole.ownersIn(1, 0, 0, 0b1111)).toEqual(['w']);
  });

  it('fill a model file one at a time, refusing one that overlaps', () => {
    const occupancy = createOccupancy(lookup);
    expect(occupancy.tryAdd(left)).toBe(true);
    expect(occupancy.tryAdd(right)).toBe(true);
    expect(occupancy.tryAdd(makeBrick({ id: 'n', partId: 'plate-1x2', x: 1 }))).toBe(false);
    // cells 0 to 4, the one between them shared
    expect(occupancy.cells).toBe(5);
  });

  it('cover the studs under them by where each stud stands', () => {
    // a 1 × 1 plate half a stud over a 1 × 2 brick's studs, at 0.5 and 1.5, sits on the first one's half
    const studs = visibleStuds(
      [makeBrick({ id: 'b', partId: 'brick-1x2' })],
      buildSpatialIndex([makeBrick({ id: 'b', partId: 'brick-1x2' }), makeBrick({ id: 'p', partId: 'plate-1x1', x: 0.5, y: 3 })], lookup),
      lookup,
    );
    expect(studs.map((s) => s.x)).toEqual([1]);
    // a half-over plate's own studs stand half a stud over too
    expect(allStuds([left], lookup).map((s) => s.x)).toEqual([0.5, 1.5]);
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
