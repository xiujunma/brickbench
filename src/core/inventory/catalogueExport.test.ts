import { describe, expect, it } from 'bun:test';
import type { LDrawIndexEntry } from '../ldraw/format';
import { brickLinkWantedList, catalogueColour, catalogueNumber, rebrickableCsv, toCatalogue, type WantedLot } from './catalogueExport';
import { matchList, partNumbersOf } from './match';
import { MAX_QUANTITY, readPartsList } from './read';

const RED = 4;
const BLACK = 0;

/** Library parts as the index lists them, with the catalogue numbers LDraw notes. */
const entry = (id: string, keywords: string[] = []): LDrawIndexEntry => ({ id, name: id, category: 'Brick', w: 1, d: 1, h: 3, origin: [0, 0, 0], snug: true, keywords });
const ENTRIES = [entry('3001'), entry('3040b', ['BrickLink 3040']), entry('6141', ['BrickLink 4073', 'Rebrickable 4073'])];
const KEYWORDS = new Map(ENTRIES.map((e) => [e.id, e.keywords ?? []]));
const keywordsOf = (part: string): readonly string[] => KEYWORDS.get(part) ?? [];

const lot = (part: string, colour: number, quantity: number): WantedLot => ({ part, colour, quantity, label: `${part} in ${colour}` });

describe('catalogue colours', () => {
  it('turn LDraw colour codes into each catalogue’s ids', () => {
    expect(catalogueColour(RED, 'bricklink')).toBe(5);
    expect(catalogueColour(BLACK, 'bricklink')).toBe(11);
    expect(catalogueColour(RED, 'rebrickable')).toBe(4);
  });

  it('prefer the id equal to the code, then the lowest, where several ids share a colour', () => {
    // Rebrickable files LDraw 132 under 76 and 132; BrickLink under 111 and 117
    expect(catalogueColour(132, 'rebrickable')).toBe(132);
    expect(catalogueColour(216, 'rebrickable')).toBe(216);
    expect(catalogueColour(132, 'bricklink')).toBe(111);
  });

  it('are null where the catalogue has no such colour', () => {
    expect(catalogueColour(99_999, 'bricklink')).toBeNull();
  });
});

describe('catalogue part numbers', () => {
  it('are the numbers LDraw notes for a part, or its own', () => {
    expect(catalogueNumber('3040b', keywordsOf('3040b'), 'bricklink')).toBe('3040');
    expect(catalogueNumber('3040b', keywordsOf('3040b'), 'rebrickable')).toBe('3040b');
    expect(catalogueNumber('6141', keywordsOf('6141'), 'rebrickable')).toBe('4073');
    expect(catalogueNumber('3001', [], 'bricklink')).toBe('3001');
  });

  it('ignore keywords that only start like a note', () => {
    expect(catalogueNumber('3001', ['BrickLink', 'BrickLink 3001 old', 'bricks'], 'bricklink')).toBe('3001');
  });
});

describe('lists to buy from', () => {
  it('add up lots the catalogue numbers alike, and leave out colours it does not have', () => {
    const list = toCatalogue([lot('3040b', RED, 2), lot('3040b', RED, 3), lot('3001', 99_999, 1), lot('3001', BLACK, MAX_QUANTITY)], 'bricklink', keywordsOf);
    expect(list.lines).toEqual([
      { part: '3040', colour: 5, quantity: 5 },
      { part: '3001', colour: 11, quantity: MAX_QUANTITY },
    ]);
    expect(list.leftOut.map((left) => left.label)).toEqual(['3001 in 99999']);
    expect(toCatalogue([lot('3001', BLACK, MAX_QUANTITY), lot('3001', BLACK, 1)], 'bricklink', keywordsOf).lines[0]?.quantity).toBe(MAX_QUANTITY);
  });

  it('write a BrickLink wanted list, escaping what XML must', () => {
    expect(brickLinkWantedList([{ part: '3001', colour: 11, quantity: 4 }])).toBe(
      '<INVENTORY>\n  <ITEM>\n    <ITEMTYPE>P</ITEMTYPE>\n    <ITEMID>3001</ITEMID>\n    <COLOR>11</COLOR>\n    <MINQTY>4</MINQTY>\n  </ITEM>\n</INVENTORY>\n',
    );
    expect(brickLinkWantedList([{ part: 'a<b&"c', colour: 1, quantity: 1 }])).toContain('<ITEMID>a&lt;b&amp;&quot;c</ITEMID>');
  });

  it('write a Rebrickable parts list, keeping only what a part number holds', () => {
    expect(rebrickableCsv([{ part: '3001', colour: 0, quantity: 4 }, { part: '=SUM(1)', colour: 4, quantity: 1 }])).toBe('Part,Color,Quantity\r\n3001,0,4\r\nSUM1,4,1\r\n');
  });

  it.each(['bricklink', 'rebrickable'] as const)('come back as the same parts and colours when read as a %s list', (catalogue) => {
    const lots = [lot('3001', BLACK, 4), lot('3040b', RED, 2), lot('6141', RED, 6)];
    const list = toCatalogue(lots, catalogue, keywordsOf);
    const text = catalogue === 'bricklink' ? brickLinkWantedList(list.lines) : rebrickableCsv(list.lines);
    const read = matchList(readPartsList(text), partNumbersOf([], ENTRIES, new Map()));
    expect(read.unmatched).toEqual([]);
    expect(read.lots).toEqual(lots.map(({ part, colour, quantity }) => ({ part, colour, quantity })));
  });
});
