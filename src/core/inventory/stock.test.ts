import { describe, expect, it } from 'bun:test';
import type { Brick } from '../model/types';
import type { PartDef } from '../parts/types';
import { getPart, PARTS } from '../parts/catalog';
import { partNumbersOf } from './match';
import { allotStock, lotKey, ownedCounts, partIdFor, rematchList, stockOf, usedCounts, type OwnedList } from './stock';

function list(id: string, copies: number, lots: OwnedList['lots']): OwnedList {
  return { id, name: id, catalogue: 'rebrickable', copies, lots, unmatched: [] };
}

function brick(id: string, partId: string, colorId: number): Brick {
  return { id, partId, colorId, x: 0, y: 0, z: 0, r: 0 };
}

const LIBRARY_BRICK: PartDef = { ...(getPart('brick-2x4') as PartDef), id: 'ldraw:3001' };
const NO_LDRAW: PartDef = { ...(getPart('brick-2x4') as PartDef), id: 'custom', ldraw: undefined };
const lookup = (id: string): PartDef | undefined => (id === 'ldraw:3001' ? LIBRARY_BRICK : id === 'custom' ? NO_LDRAW : getPart(id));

describe('the parts the user owns', () => {
  it('adds up every list, each lot counted once per copy of the set', () => {
    const owned = ownedCounts([
      list('a', 4, [{ part: '3001', colour: 4, quantity: 2 }]),
      list('b', 1, [
        { part: '3001', colour: 4, quantity: 1 },
        { part: '3023', colour: 15, quantity: 6 },
      ]),
    ]);
    expect(owned.get(lotKey('3001', 4))).toBe(9);
    expect(owned.get(lotKey('3023', 15))).toBe(6);
  });

  it('counts a basic part and its library twin as the same part', () => {
    const used = usedCounts([brick('1', 'brick-2x4', 4), brick('2', 'ldraw:3001', 4), brick('3', 'custom', 4), brick('4', 'plate-1x2', 0)], lookup);
    expect(used.get(lotKey('3001', 4))).toBe(2);
    expect(used.get(lotKey('3023b', 0))).toBe(1);
    expect(used.size).toBe(2);
  });

  it('says how many are left, below zero when the model uses more', () => {
    const owned = new Map([[lotKey('3001', 4), 3]]);
    const used = new Map([[lotKey('3001', 4), 5]]);
    expect(stockOf(owned, used, '3001', 4)).toEqual({ owned: 3, used: 5, left: -2 });
    expect(stockOf(owned, used, '3005', 1)).toEqual({ owned: 0, used: 0, left: 0 });
  });

  it('matches left-out parts again once BrickBench has them, adding to what matched before', () => {
    const before = {
      ...list('a', 1, [{ part: '3001', colour: 4, quantity: 2 }]),
      unmatched: [
        { part: '3001', colour: 4, quantity: 1, reason: 'part' as const },
        { part: '5903', colour: 85, quantity: 2, reason: 'part' as const },
      ],
    };
    // as when the library had not loaded: nothing known
    expect(rematchList(before, partNumbersOf([], [], new Map()))).toBe(before);
    const after = rematchList(before, partNumbersOf(PARTS, [], new Map()));
    expect(after.lots).toEqual([{ part: '3001', colour: 4, quantity: 3 }]);
    expect(after.unmatched).toEqual([{ part: '5903', colour: 85, quantity: 2, reason: 'part' }]);
    expect(rematchList(after, partNumbersOf(PARTS, [], new Map()))).toBe(after);
    const done = { ...after, unmatched: [] };
    expect(rematchList(done, partNumbersOf(PARTS, [], new Map()))).toBe(done);
  });

  it('shares what the user owns out over the rows of a parts list', () => {
    const rows = [
      { partId: 'brick-2x4', colorId: 4, quantity: 3 },
      { partId: 'ldraw:3001', colorId: 4, quantity: 2 },
      { partId: 'custom', colorId: 4, quantity: 1 },
      { partId: 'plate-1x2', colorId: 0, quantity: 1 },
    ];
    expect(allotStock(rows, new Map([[lotKey('3001', 4), 4]]), lookup).map((r) => [r.have, r.missing])).toEqual([
      [3, 0],
      [1, 1],
      [0, 1],
      [0, 1],
    ]);
  });

  it('builds with the basic part for a number when there is one', () => {
    expect(partIdFor('3001')).toBe('brick-2x4');
    expect(partIdFor('6141')).toBe('round-plate-1x1');
    expect(partIdFor('3684c')).toBe('ldraw:3684c');
  });
});
