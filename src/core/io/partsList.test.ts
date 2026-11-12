import { describe, expect, it } from 'bun:test';
import { getPart } from '../parts/catalog';
import { makeBrick } from '../model/testUtils';
import { buildPartsList, csvCell, partsListCsv } from './partsList';

const bricks = [
  makeBrick({ id: 'a' }),
  makeBrick({ id: 'b', x: 4 }),
  makeBrick({ id: 'c', colorId: 15 }),
  makeBrick({ id: 'd', partId: 'plate-1x1', colorId: 4 }),
];

describe('parts list', () => {
  it('counts each part and colour combination', () => {
    const rows = buildPartsList(bricks, getPart);
    expect(rows).toEqual([
      expect.objectContaining({ partId: 'brick-2x4', colorName: 'Red', quantity: 2, ldraw: '3001' }),
      expect.objectContaining({ partId: 'brick-2x4', colorName: 'White', quantity: 1 }),
      expect.objectContaining({ partId: 'plate-1x1', colorName: 'Red', quantity: 1, ldraw: '3024' }),
    ]);
  });

  it('writes CSV with a header and quoted cells', () => {
    const csv = partsListCsv(buildPartsList(bricks, getPart));
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Quantity,Part,LDraw ID,Colour,LDraw colour');
    expect(lines[1]).toBe('2,"Brick 2 × 4","3001","Red",4');
    expect(lines).toHaveLength(4);
  });

  it('escapes quotes and neutralises spreadsheet formulas', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe('"\'=SUM(A1)"');
  });
});
