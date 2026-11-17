import { describe, expect, it } from 'bun:test';
import { csvRows, MAX_LIST_BYTES, PartsListError, readBrickLinkXml, readPartsList, readRebrickableCsv, xmlItems } from './read';

describe('reading a Rebrickable CSV', () => {
  it('reads part, colour and quantity, whatever the line endings', () => {
    const list = readPartsList('﻿Part,Color,Quantity\r\n3001,4,6\r\n3023,15,12\n');
    expect(list).toEqual({
      catalogue: 'rebrickable',
      parts: [
        { part: '3001', colour: 4, quantity: 6 },
        { part: '3023', colour: 15, quantity: 12 },
      ],
      notParts: 0,
      unreadable: 0,
    });
  });

  it('finds its columns by name, in any order and with others around them', () => {
    const list = readRebrickableCsv('inventory_id,part_num,color_id,quantity,is_spare\n1,3069b,72,2,False\n1,3069b,72,1,True');
    expect(list.parts).toEqual([
      { part: '3069b', colour: 72, quantity: 2 },
      { part: '3069b', colour: 72, quantity: 1 },
    ]);
    expect(readRebrickableCsv('Quantity,Colour,Part Num\n3,0,3001').parts).toEqual([{ part: '3001', colour: 0, quantity: 3 }]);
  });

  it('keeps commas and quotes inside quoted cells', () => {
    expect(csvRows('a,"b, c","say ""hi"""\n')).toEqual([['a', 'b, c', 'say "hi"']]);
    expect(readRebrickableCsv('Part,Color,Quantity,Name\n3001,4,1,"Brick 2 x 4, ""classic"""').parts).toHaveLength(1);
  });

  it('counts lines it cannot read and keeps the rest', () => {
    const list = readRebrickableCsv('Part,Color,Quantity\n3001,4,0\n3001,red,1\n,4,1\n../x,4,1\n3001,4,-2\n3002,4,1\n\n');
    expect(list.parts).toEqual([{ part: '3002', colour: 4, quantity: 1 }]);
    expect(list.unreadable).toBe(5);
  });

  it('says what is wrong with a file it cannot use', () => {
    expect(() => readPartsList('')).toThrow(/empty/);
    expect(() => readPartsList('Name,Price\nBrick,1')).toThrow(/no Part, Color and Quantity columns/);
    expect(() => readPartsList('Part,Color,Quantity\nnope,x,y')).toThrow(/no parts in it/);
    expect(() => readPartsList('x'.repeat(MAX_LIST_BYTES + 1))).toThrow(/too large/);
    expect(() => csvRows('a\nb\nc\n', 2)).toThrow(PartsListError);
  });
});

const INVENTORY = `<?xml version="1.0" encoding="UTF-8"?>
<INVENTORY>
  <ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>3001</ITEMID><COLOR>5</COLOR><QTY>4</QTY><EXTRA>N</EXTRA></ITEM>
  <ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>4073</ITEMID><COLOR>11</COLOR><QTY>2</QTY><EXTRA>Y</EXTRA></ITEM>
  <ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>3002</ITEMID><COLOR>5</COLOR><QTY>1</QTY><ALTERNATE>Y</ALTERNATE></ITEM>
  <ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>3003</ITEMID><COLOR>5</COLOR><QTY>1</QTY><COUNTERPART>Y</COUNTERPART></ITEM>
  <ITEM><ITEMTYPE>M</ITEMTYPE><ITEMID>cty0001</ITEMID><QTY>1</QTY></ITEM>
  <ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID></ITEMID><COLOR>5</COLOR><QTY>1</QTY></ITEM>
</INVENTORY>`;

describe('reading a BrickLink XML list', () => {
  it('reads parts, extras included, and leaves out alternates, counterparts and minifigures', () => {
    expect(readPartsList(INVENTORY)).toEqual({
      catalogue: 'bricklink',
      parts: [
        { part: '3001', colour: 5, quantity: 4 },
        { part: '4073', colour: 11, quantity: 2 },
      ],
      notParts: 3,
      unreadable: 1,
    });
  });

  it('reads wanted lists, whose quantities are minimums and may be left out', () => {
    const wanted = '<INVENTORY><ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>3020</ITEMID><COLOR>86</COLOR><MINQTY>8</MINQTY></ITEM><ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>3021</ITEMID><COLOR>86</COLOR></ITEM></INVENTORY>';
    expect(readBrickLinkXml(wanted).parts).toEqual([
      { part: '3020', colour: 86, quantity: 8 },
      { part: '3021', colour: 86, quantity: 1 },
    ]);
  });

  it("reads BrickStore's files, which use BrickLink's numbers", () => {
    const bsx = `<?xml version="1.0"?><!DOCTYPE BrickStoreXML>
<BrickStoreXML><Inventory>
<Item><ItemID>3666</ItemID><ItemTypeID>P</ItemTypeID><ColorID>7</ColorID><ItemName>Plate 1 x 6</ItemName><Qty>3</Qty></Item>
</Inventory></BrickStoreXML>`;
    expect(readPartsList(bsx).parts).toEqual([{ part: '3666', colour: 7, quantity: 3 }]);
  });

  it('decodes escaped characters and ignores tags it does not know', () => {
    const items = xmlItems('<INVENTORY><ITEM><REMARKS>a &lt;b&gt; &amp; c</REMARKS><ITEMID>3001</ITEMID><ITEMID>9999</ITEMID></ITEM></INVENTORY>');
    expect(items).toEqual([new Map([['REMARKS', 'a <b> & c'], ['ITEMID', '3001']])]);
  });

  it('copes with broken XML without hanging', () => {
    expect(xmlItems('<ITEM><ITEMID>3001')).toEqual([]);
    expect(xmlItems('<'.repeat(100_000))).toEqual([]);
    expect(xmlItems(`<INVENTORY>${'<ITEM><QTY>1</QTY></ITEM>'.repeat(50_000)}`)).toHaveLength(50_000);
    expect(() => xmlItems('<ITEM></ITEM><ITEM></ITEM><ITEM></ITEM>', 2)).toThrow(PartsListError);
  });

  it('refuses XML that is not a BrickLink list, or lists only minifigures', () => {
    expect(() => readPartsList('<html><body>hi</body></html>')).toThrow(/not a BrickLink inventory/);
    expect(() => readPartsList('<INVENTORY><ITEM><ITEMTYPE>M</ITEMTYPE><ITEMID>sw0001</ITEMID></ITEM></INVENTORY>')).toThrow(/only minifigures/);
  });
});
