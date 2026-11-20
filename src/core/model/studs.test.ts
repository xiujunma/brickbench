import { describe, expect, it } from 'bun:test';
import { getPart } from '../parts/catalog';
import { isOpaqueColor } from '../colors';
import { buildSpatialIndex } from './spatial';
import { allStuds, visibleStuds } from './studs';
import { makeBrick } from './testUtils';
import type { Brick } from './types';

const lookup = getPart;

function studsFor(bricks: readonly Brick[], exclude?: ReadonlySet<string>) {
  const index = buildSpatialIndex(bricks, lookup);
  const byId = new Map(bricks.map((b) => [b.id, b]));
  const isOpaque = (id: string) => isOpaqueColor(byId.get(id)?.colorId ?? -1);
  return visibleStuds(bricks, index, lookup, isOpaque, exclude);
}

describe('visibleStuds', () => {
  it('shows every stud of a lone brick on its top face', () => {
    const studs = studsFor([makeBrick({ partId: 'brick-2x2', x: 5, y: 3, z: -1 })]);
    expect(studs).toHaveLength(4);
    // where each stud's base stands, in world units: the middle of its cell, on top of the brick's sixth plate
    expect(studs.every((s) => s.y === 2.4 && s.r === 0 && s.colorId === 4)).toBe(true);
    expect(studs.map((s) => `${s.x},${s.z}`).sort()).toEqual(['5.5,-0.5', '5.5,0.5', '6.5,-0.5', '6.5,0.5']);
  });

  it('hides studs covered by an opaque brick', () => {
    const studs = studsFor([
      makeBrick({ id: 'low', partId: 'brick-2x2' }),
      makeBrick({ id: 'high', partId: 'brick-2x2', y: 3, colorId: 1 }),
    ]);
    expect(studs).toHaveLength(4);
    expect(studs.every((s) => s.colorId === 1)).toBe(true);
  });

  it('keeps studs visible under transparent bricks', () => {
    const studs = studsFor([
      makeBrick({ id: 'low', partId: 'brick-2x2' }),
      makeBrick({ id: 'glass', partId: 'brick-2x2', y: 3, colorId: 47 }),
    ]);
    expect(studs).toHaveLength(8);
  });

  it('skips excluded bricks and their cover', () => {
    const bricks = [
      makeBrick({ id: 'low', partId: 'brick-2x2' }),
      makeBrick({ id: 'high', partId: 'brick-2x2', y: 3, colorId: 1 }),
    ];
    const studs = studsFor(bricks, new Set(['high']));
    expect(studs).toHaveLength(4);
    expect(studs.every((s) => s.colorId === 4)).toBe(true);
  });

  it('lists every stud, covered or not, for previews and selections', () => {
    const stacked = [
      makeBrick({ id: 'low', partId: 'brick-2x2' }),
      makeBrick({ id: 'high', partId: 'brick-2x2', y: 3 }),
    ];
    expect(allStuds(stacked, lookup)).toHaveLength(8);
  });

  it('gives tiles no studs and slopes only their back row, wherever they turn', () => {
    expect(studsFor([makeBrick({ partId: 'tile-2x2' })])).toHaveLength(0);
    const slope = studsFor([makeBrick({ partId: 'slope45-2x2', r: 1, x: 0, z: 0 })]);
    // a quarter turn moves the back row from -Z to -X
    expect(slope.map((s) => `${s.x},${s.z}`).sort()).toEqual(['0.5,0.5', '0.5,1.5']);
  });
});
