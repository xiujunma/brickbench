import { describe, expect, it } from 'bun:test';
import type { Rotation } from '../../grid';
import { partNumbersOf } from '../../inventory/match';
import { createIdFactory } from '../../model/ids';
import { allBricks, modelFromBricks } from '../../model/model';
import type { Brick } from '../../model/types';
import { PARTS, getPart } from '../../parts/catalog';
import type { PartDef, PartLookup } from '../../parts/types';
import { toLDraw } from '../ldraw';
import { parseDocument, serializeDocument } from '../modelFile';
import { importLDraw, modelName, type ImportContext, type ImportedModel } from './importLDraw';

const NUMBERS = partNumbersOf(PARTS, [], new Map());
const context = (lookup: PartLookup = getPart, numbers = NUMBERS): ImportContext => ({ lookup, numbers, nextId: createIdFactory('t') });

function imported(lines: readonly string[], fileName = 'model.ldr', ctx = context()): ImportedModel {
  const result = importLDraw(lines.join('\r\n'), fileName, ctx);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/** Bricks as comparable rows, positions counted from the model's own corner. */
function shape(bricks: readonly Brick[]): string[] {
  const x0 = Math.min(...bricks.map((b) => b.x));
  const y0 = Math.min(...bricks.map((b) => b.y));
  const z0 = Math.min(...bricks.map((b) => b.z));
  return bricks.map((b) => `${b.partId} ${b.colorId} ${b.x - x0} ${b.y - y0} ${b.z - z0} r${b.r}`).sort();
}

const line = (colour: number | string, x: number, y: number, z: number, file: string, matrix = '1 0 0 0 1 0 0 0 1'): string => `1 ${colour} ${x} ${y} ${z} ${matrix} ${file}`;

/** A library part, as the parts library would make it known. */
const BASEPLATE: PartDef = {
  id: 'ldraw:3811',
  name: 'Baseplate 32 × 32',
  category: 'library',
  w: 32,
  d: 32,
  h: 1,
  studs: [],
  solids: [{ x0: 0, y0: 0, z0: 0, x1: 32, y1: 1, z1: 32 }],
  shape: { kind: 'mesh' },
  // the library stands a baseplate, 4 LDU thick, with its top at the top of its cell
  ldraw: { file: '3811.dat', origin: [0, 0.4, 0] },
  keywords: ['baseplate'],
};
const R1 = '0 0 -1 0 1 0 1 0 0';

describe('importLDraw', () => {
  it('opens what the LDraw export writes as the same model', () => {
    const rotations: readonly Rotation[] = [0, 1, 2, 3];
    const bricks: Brick[] = PARTS.filter((p) => p.ldraw).map((part, i) => ({
      id: `b${i}`,
      partId: part.id,
      colorId: [4, 1, 14, 15, 0][i % 5] ?? 4,
      // 17 studs apart, more than the widest part, so no two overlap
      x: (i % 8) * 17,
      y: (i % 5) * 4,
      z: -Math.floor(i / 8) * 17,
      r: rotations[i % 4] ?? 0,
    }));
    const text = toLDraw('Round trip', modelFromBricks(bricks), getPart).text;
    const result = importLDraw(text, 'round-trip.ldr', context());
    if (!result.ok) throw new Error(result.error);
    expect(shape(allBricks(result.value.doc.model))).toEqual(shape(bricks));
    expect(result.value.report).toMatchObject({ parts: bricks.length, placed: bricks.length, leftOut: [], plain: [], recoloured: [] });
    expect(result.value.doc.name).toBe('Round trip');
  });

  it('finds the grid a model was built on, wherever the editor put it', () => {
    // half a stud over and 0.04 LDU up, with the rounding Studio leaves
    const { doc, report } = imported([
      line(4, 10.00001, -24.04, 0, '3001.dat'),
      line(4, 10, -48.04, 19.99998, '3001.dat'),
      line(1, 69.999, -32.04, 0, '3003.dat', R1),
    ]);
    expect(report.placed).toBe(3);
    expect(shape(allBricks(doc.model))).toEqual(['brick-2x2 1 4 1 1 r1', 'brick-2x4 4 0 0 1 r0', 'brick-2x4 4 0 3 0 r0']);
  });

  it('stands the model on the ground in the middle of the scene, on a baseplate that holds it', () => {
    const { doc } = imported([line(4, 400, -1000, 400, '3001.dat'), line(4, 440, -1024, 400, '3001.dat')]);
    const bricks = allBricks(doc.model);
    expect(Math.min(...bricks.map((b) => b.y))).toBe(0);
    // the two bricks span six studs, so they sit from -3 to 3
    expect(bricks.map((b) => [b.x, b.z])).toEqual([
      [-3, -1],
      [-1, -1],
    ]);
    expect(doc.settings).toEqual({ baseplateSize: 16, baseplateColor: 2 });
  });

  it('reports parts it leaves out, and why', () => {
    const { report } = imported([
      line(4, 0, -24, 0, '3001.dat'),
      line(4, 0, -48, 0, '71427c01.dat'),
      line(4, 0, -48, 0, '71427c01.dat'),
      line(4, 0, -48, 0, 'wheels.ldr'),
      // mirrored, as no real part is
      line(4, 80, -24, 0, '3001.dat', '-1 0 0 0 1 0 0 0 1'),
    ]);
    expect(report.parts).toBe(5);
    expect(report.placed).toBe(1);
    expect(report.leftOut).toEqual([
      { reason: 'missing', count: 2, parts: [{ label: '71427c01', count: 2 }] },
      { reason: 'missing-file', count: 1, parts: [{ label: 'wheels.ldr', count: 1 }] },
      { reason: 'mirrored', count: 1, parts: [{ label: 'Brick 2 × 4 (3001)', count: 1 }] },
    ]);
  });

  it('brings parts in at an angle, and parts that fit into others, loose, and gives them back to LDraw as they were', () => {
    const angle = '0.7071 0 0.7071 0 1 0 -0.7071 0 0.7071';
    const { doc, report } = imported([
      line(4, 0, -24, 0, '3001.dat'),
      // turned an eighth about the vertical
      line(1, 120, -24, 0, '3001.dat', angle),
      // right in the first, as a pin sits in its beam
      line(2, 0, -24, 0, '3001.dat'),
    ]);
    expect(report.leftOut).toEqual([]);
    expect(report.placed).toBe(3);
    const [square, angled, inside] = allBricks(doc.model);
    expect(square?.m).toBeUndefined();
    expect(angled?.m?.map((v) => Math.round(v * 1e4) / 1e4)).toEqual([0.7071, 0, -0.7071, 0, 1, 0, 0.7071, 0, 0.7071]);
    expect(inside?.m).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const lines = toLDraw('loose', doc.model, getPart).text.split('\r\n').filter((l) => l.startsWith('1 '));
    expect(lines[1]).toEndWith(` ${angle} 3001.dat`);
    // and a file saved with them opens with them, in place
    const again = parseDocument(serializeDocument(doc), getPart, createIdFactory('a'));
    if (!again.ok) throw new Error(again.error);
    expect(allBricks(again.value.doc.model).map((b) => [b.x, b.y, b.z, b.m !== undefined])).toEqual(allBricks(doc.model).map((b) => [b.x, b.y, b.z, b.m !== undefined]));
  });

  it('brings parts in upside down and on their sides, and parts between studs, where they stand', () => {
    const { doc, report } = imported([
      line(4, 0, -24, 0, '3001.dat'),
      // upside down beside it, its studs pointing at the ground
      line(1, 80, 0, 0, '3001.dat', '1 0 0 0 -1 0 0 0 -1'),
      // on its back, its studs facing the front, its back against the first brick's front, 2 LDU above its top
      line(2, 0, -36, -28, '3024.dat', '1 0 0 0 0 -1 0 1 0'),
      // a quarter stud over: on neither whole nor half studs
      line(14, 165, -24, 0, '3001.dat'),
    ]);
    expect(report.leftOut).toEqual([]);
    expect(report.placed).toBe(4);
    const [brick, upsideDown, onBack, between] = allBricks(doc.model);
    expect(upsideDown?.r).toBe(4);
    expect(upsideDown?.x).toBe((brick?.x ?? 0) + 4);
    expect(onBack?.r).toBe(16);
    // 20 LDU tall on its back: from 2 LDU over the brick's top, a quarter plate up, to 2.5 plates higher
    expect(onBack?.y).toBe((brick?.y ?? 0) + 3.25);
    expect(between?.x).toBe((brick?.x ?? 0) + 8.25);
    // and back out where they came from
    const lines = toLDraw('round trip', doc.model, getPart).text.split('\r\n').filter((l) => l.startsWith('1 '));
    expect(lines[1]).toMatch(/ 1 0 0 0 -1 0 0 0 -1 3001\.dat$/);
    expect(lines[2]).toMatch(/ 1 0 0 0 0 -1 0 1 0 3024\.dat$/);
  });

  it('builds printed parts plain and brings other colours in as the nearest', () => {
    const { doc, report } = imported([line(7, 0, -24, 0, '3001p01.dat'), line(7, 0, -48, 0, '3001.dat'), line(15, 0, -72, 0, '3001.dat')]);
    expect(allBricks(doc.model).map((b) => [b.partId, b.colorId])).toEqual([
      ['brick-2x4', 71],
      ['brick-2x4', 71],
      ['brick-2x4', 15],
    ]);
    expect(report.plain).toEqual([{ label: 'Brick 2 × 4 (3001p01)', count: 1 }]);
    expect(report.recoloured).toEqual([{ from: 'Light Grey', to: 'Light Bluish Grey', count: 2 }]);
  });

  it('builds submodels where the model puts them, in their parent colour', () => {
    const { doc } = imported(['0 FILE main.ldr', '1 1 0 0 0 1 0 0 0 1 0 0 0 1 Wall', '1 4 0 -24 0 1 0 0 0 1 0 0 0 1 Wall', '0 FILE Wall', line(16, 0, -24, 0, '3001.dat')], 'house.mpd');
    expect(shape(allBricks(doc.model))).toEqual(['brick-2x4 1 0 0 0 r0', 'brick-2x4 4 0 3 0 r0']);
  });

  it('moves a submodel built on a grid of its own onto the model grid as one piece', () => {
    const { doc, report } = imported(
      [
        '0 FILE loco.ldr',
        line(4, 0, -24, 0, '3001.dat'),
        line(4, 0, -48, 0, '3001.dat'),
        line(4, 0, -72, 0, '3001.dat'),
        // the cab sits 1 LDU up, off the model's grid but whole among itself, and half a stud over, as it may
        '1 1 10 -97 0 1 0 0 0 1 0 0 0 1 Cab',
        '0 FILE Cab',
        line(16, 0, 0, 0, '3001.dat'),
        line(16, 0, -24, 0, '3001.dat'),
      ],
      'loco.mpd',
    );
    expect(report.placed).toBe(5);
    expect(report.leftOut).toEqual([]);
    expect(report.moved).toEqual([{ label: 'Cab', count: 2 }]);
    expect(report.squared).toEqual([]);
    // three plates to a brick: the cab's bricks still stand one on the other, on the body, half a stud along it
    expect(shape(allBricks(doc.model))).toEqual(['brick-2x4 1 0.5 12 0 r0', 'brick-2x4 1 0.5 9 0 r0', 'brick-2x4 4 0 0 0 r0', 'brick-2x4 4 0 3 0 r0', 'brick-2x4 4 0 6 0 r0']);
  });

  it('turns submodels stood at an angle square, and leaves drawing shapes out as shapes', () => {
    const { doc, report } = imported(['0 FILE m.ldr', '1 14 0 0 0 0.86603 0 -0.5 0 1 0 0.5 0 0.86603 10156 - TRUCK.LDR', '1 0 0 0 0 1 0 0 0 1 0 0 0 1 48\\4-4cyli.dat', '0 FILE 10156 - truck.ldr', line(16, 0, -24, 0, '3001.dat'), line(16, 0, -48, 0, '3001.dat')]);
    expect(allBricks(doc.model).map((b) => [b.colorId, b.r])).toEqual([
      [14, 0],
      [14, 0],
    ]);
    expect(report.squared).toEqual([{ label: '10156 - TRUCK', count: 2 }]);
    expect(report.leftOut).toEqual([{ reason: 'shapes', count: 1, parts: [{ label: '48\\4-4cyli', count: 1 }] }]);
  });

  it('keeps a submodel where it is when more of its parts fit the model grid as they are', () => {
    // its last part a quarter stud over, on neither whole nor half studs: it comes in where it is
    const { doc, report } = imported(['0 FILE m.ldr', line(4, 0, -24, 0, '3001.dat'), '1 1 0 -48 0 1 0 0 0 1 0 0 0 1 Top', '0 FILE Top', line(16, 0, 0, 0, '3001.dat'), line(16, 0, -24, 0, '3001.dat'), line(16, 5, -48, 0, '3001.dat')]);
    expect(report.moved).toEqual([]);
    expect(report.leftOut).toEqual([]);
    const bricks = allBricks(doc.model);
    expect(bricks.map((b) => b.x - (bricks[0]?.x ?? 0))).toEqual([0, 0, 0, 0.25]);
  });

  it('keeps a part half a stud over where it is, as on a jumper plate, and gives it back to LDraw there', () => {
    // a 1 × 1 plate on a 2 × 4 brick, centred on the line between two of its studs
    const { doc, report } = imported([line(4, 0, -24, 0, '3001.dat'), line(1, 20, -32, 10, '3024.dat')]);
    expect(report.leftOut).toEqual([]);
    const [brick, plate] = allBricks(doc.model);
    expect((plate?.x ?? 0) - (brick?.x ?? 0)).toBe(2.5);
    expect(plate?.y).toBe(3);
    const again = importLDraw(toLDraw('Again', doc.model, getPart).text, 'again.ldr', context());
    if (!again.ok) throw new Error(again.error);
    expect(shape(allBricks(again.value.doc.model))).toEqual(shape(allBricks(doc.model)));
  });

  it('counts lines it could not read, and submodels that contain themselves', () => {
    const { report } = imported(['0 FILE a.ldr', line(4, 0, -24, 0, '3001.dat'), '1 4 0 0 0 1 0 0 0 1 3001.dat', '1 16 0 0 0 1 0 0 0 1 0 0 0 1 a.ldr']);
    expect(report).toMatchObject({ unreadable: 1, looping: 1 });
  });

  it('opens the same library parts it exports, wherever their origin sits', () => {
    // a library part whose LDraw origin is off its footprint's centre and off whole studs and plates
    const odd: PartDef = { ...BASEPLATE, id: 'ldraw:odd', name: 'Odd', w: 3, d: 2, h: 2, solids: [{ x0: 0, y0: 0, z0: 0, x1: 3, y1: 2, z1: 2 }], ldraw: { file: 'odd.dat', origin: [0.25, 0.3, -0.5] }, keywords: [] };
    const lookup: PartLookup = (id) => (id === odd.id ? odd : getPart(id));
    const numbers = { ...NUMBERS, known: new Set([...NUMBERS.known, 'odd']) };
    const rotations: readonly Rotation[] = [0, 1, 2, 3];
    const bricks: Brick[] = rotations.flatMap((r) => [
      { id: `a${r}`, partId: odd.id, colorId: 4, x: r * 5, y: r, z: -3, r },
      { id: `b${r}`, partId: 'plate-1x2', colorId: 1, x: r * 5 - 1, y: 0, z: 4, r },
    ]);
    const text = toLDraw('Odd', modelFromBricks(bricks), lookup).text;
    const result = importLDraw(text, 'odd.ldr', context(lookup, numbers));
    if (!result.ok) throw new Error(result.error);
    expect(shape(allBricks(result.value.doc.model))).toEqual(shape(bricks));
  });

  it('keeps the model when one stray part sits far beyond it', () => {
    const { doc, report } = imported([line(4, 0, -24, 0, '3001.dat'), line(4, 80, -24, 0, '3001.dat'), line(4, 0, -48, 40, '3001.dat'), line(4, 22000, -24, 0, '3001.dat')]);
    expect(report.placed).toBe(3);
    expect(report.leftOut).toEqual([{ reason: 'outside', count: 1, parts: [{ label: 'Brick 2 × 4 (3001)', count: 1 }] }]);
    expect(Math.max(...allBricks(doc.model).map((b) => Math.abs(b.x)))).toBeLessThan(10);
  });

  it('writes whole cells without negative zeros, whatever rounding the file has', () => {
    // a 1 × 1 plate a hair short of its cell rounds to -0 along x and z
    const { doc } = imported([line(4, 9.99999, -8, -9.99999, '3024.dat')]);
    const [brick] = allBricks(doc.model);
    expect([brick?.x, brick?.y, brick?.z].some((v) => Object.is(v, -0))).toBe(false);
  });

  it('says so when the only parts are in submodels that contain themselves', () => {
    expect(importLDraw(['0 FILE a.ldr', '1 16 0 0 0 1 0 0 0 1 0 0 0 1 b.ldr', '0 FILE b.ldr', '1 16 0 0 0 1 0 0 0 1 0 0 0 1 a.ldr'].join('\n'), 'a.mpd', context())).toEqual({
      ok: false,
      error: 'This model’s submodels contain themselves, so there are no parts to open.',
    });
  });

  it('stands a model on the baseplate it brings, every part on the grid, and leaves the scene’s own baseplate out', () => {
    const baseplate = BASEPLATE;
    const lookup: PartLookup = (id) => (id === baseplate.id ? baseplate : getPart(id));
    const numbers = { ...NUMBERS, known: new Set([...NUMBERS.known, '3811']) };
    // as LDraw models have it: the baseplate's top at y 0, a brick on it, its underside there too, and another on that
    const { doc, report } = imported([line(2, 0, 0, 0, '3811.dat'), line(4, 10, -24, 20, '3001.dat'), line(1, 10, -48, 20, '3001.dat')], 'town.ldr', context(lookup, numbers));
    expect(doc.settings.baseplateSize).toBe(0);
    expect(report.placed).toBe(3);
    const bricks = allBricks(doc.model);
    // none loose: the baseplate's plate of cells on the ground, the bricks on whole plates over it
    expect(bricks.filter((b) => b.m)).toEqual([]);
    expect(bricks.map((b) => `${b.partId} ${b.y}`).sort()).toEqual(['brick-2x4 1', 'brick-2x4 4', 'ldraw:3811 0']);
  });

  it('opens a model where nothing fits as an empty one, with the report saying why', () => {
    const { doc, report } = imported([line(4, 0, -24, 0, '71427c01.dat')]);
    expect(doc.model.bricks.size).toBe(0);
    expect(doc.settings.baseplateSize).toBe(0);
    expect(report).toMatchObject({ parts: 1, placed: 0 });
  });

  it('refuses files without parts', () => {
    expect(importLDraw('0 Just a title\n0 STEP\n', 'empty.ldr', context())).toEqual({ ok: false, error: 'There are no parts in this file.' });
    expect(importLDraw('1 4 0 0 3001.dat\n', 'bad.ldr', context())).toEqual({ ok: false, error: 'BrickBench could not read the parts in this file.' });
  });

  it('passes on the limits of the walk through submodels', () => {
    const lines = ['0 FILE m0.ldr'];
    for (let level = 0; level < 30; level++) lines.push(`1 16 0 0 0 1 0 0 0 1 0 0 0 1 m${level + 1}.ldr`, `1 16 0 0 0 1 0 0 0 1 0 0 0 1 m${level + 1}.ldr`, `0 FILE m${level + 1}.ldr`);
    lines.push(line(4, 0, -24, 0, '3001.dat'));
    expect(importLDraw(lines.join('\n'), 'deep.mpd', context()).ok).toBe(false);
  });
});

describe('modelName', () => {
  const file = (title: string) => ({ name: 'm', title, lines: [], drawsShapes: false, declared: null });

  it('takes the title, unless an editor made it up', () => {
    expect(modelName(file('King’s Castle'), '6080.mpd')).toBe('King’s Castle');
    expect(modelName(file('Untitled Model'), 'C:\\models\\whale.io')).toBe('whale');
    expect(modelName(file('Main'), '31153-1.mpd')).toBe('31153-1');
    expect(modelName(file('Main Street'), 'm.mpd')).toBe('Main Street');
    expect(modelName(file(''), 'train.ldr')).toBe('train');
    expect(modelName(file(''), '.ldr')).toBe('Imported model');
    expect(modelName(file('x'.repeat(200)), 'a.ldr')).toHaveLength(120);
  });
});
