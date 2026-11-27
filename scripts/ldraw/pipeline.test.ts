import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';
import { convertPart, toEditor } from './convert.ts';
import { creditsText } from './credits.ts';
import { Flattener } from './flatten.ts';
import { directorySource, memorySource } from './library.ts';
import type { V3 } from './parse.ts';

/** A 1 × 1 brick: top and bottom faces 24 LDU apart, plus one stud. */
const BRICK = [
  '0 Test Brick 1 x 1',
  '0 BFC CERTIFY CCW',
  '4 16 -10 0 -10 10 0 -10 10 0 10 -10 0 10',
  '4 16 -10 24 -10 -10 24 10 10 24 10 10 24 -10',
  '1 16 0 0 0 1 0 0 0 1 0 0 0 1 stud.dat',
].join('\n');
const STUD = ['0 Stud', '0 BFC CERTIFY CCW', '3 16 -6 -4 0 6 -4 0 0 -4 6'].join('\n');

/** The six faces of a box between two corners, as LDraw quads. */
function ldrawBox([x0, y0, z0]: V3, [x1, y1, z1]: V3): string[] {
  const corners: V3[] = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]];
  return quads.map((quad) => `4 16 ${quad.map((i) => (corners[i] ?? [0, 0, 0]).join(' ')).join(' ')}`);
}

/** Plate 2 × 2 Corner: an L of two boxes, its missing quarter towards LDraw +x and +z. */
const CORNER_PLATE = ['0 Corner Plate', '0 BFC CERTIFY CCW', ...ldrawBox([-20, 0, -20], [20, 8, 0]), ...ldrawBox([-20, 0, 0], [0, 8, 20])].join('\n');

describe('converting a part', () => {
  const source = memorySource({
    'brick.dat': BRICK,
    // the 1 × 1 brick with a stud on its LDraw -z side, 10 LDU under its top, as 87087
    'side.dat': `${BRICK}\n1 16 0 10 -10 1 0 0 0 0 -1 0 1 0 stud.dat`,
    'stud.dat': STUD,
    'twotone.dat': `${BRICK}\n3 4 0 0 0 1 0 0 0 0 1`,
    'empty.dat': '0 Nothing to see\n0 BFC CERTIFY CCW',
    // a hole from LDraw's -z face to its +z face, 10 LDU under the top: a peg-hole end at each face
    'holed.dat': `${BRICK}\n1 16 0 10 -8 1 0 0 0 0 1 0 -1 0 peghole.dat\n1 16 0 10 8 1 0 0 0 0 -1 0 1 0 peghole.dat`,
    'peghole.dat': ['0 Peg Hole End', '0 BFC CERTIFY CCW', '3 16 -8 0 0 8 0 0 0 2 8'].join('\n'),
  });
  const flattener = new Flattener(source);

  it('keeps the studs on a part’s sides, where they stand on the placed part and the way they face', () => {
    const result = convertPart('side.dat', flattener);
    if (!result.ok) throw new Error(result.reason);
    // y up from the brick's bottom: 14 LDU, 0.7 studs; LDraw's -z is our +z, the front of a 1 × 1 cell, half a stud out
    expect(result.sideStuds).toEqual([[0, 0.7, 0.5, 4]]);
    const plain = convertPart('brick.dat', flattener);
    expect(plain.ok && plain.sideStuds).toEqual([]);
  });

  it('keeps its Technic holes, where they run on the placed part', () => {
    const result = convertPart('holed.dat', flattener);
    if (!result.ok) throw new Error(result.reason);
    // [pin hole, its middle 0.7 studs up, running front to back, a stud long]
    expect(result.connectors.map((entry) => entry.map((v) => Math.round(v * 1000) / 1000 + 0))).toEqual([[1, 0, 0.7, 0, 0, 0, 1, 1]]);
    const plain = convertPart('brick.dat', flattener);
    expect(plain.ok && plain.connectors).toEqual([]);
  });

  it('measures the box its whole shape fills, studs and all', () => {
    const result = convertPart('brick.dat', flattener);
    if (!result.ok) throw new Error(result.reason);
    // the 1 × 1 brick, its stud 0.2 above its 1.2 top
    expect(result.extent.map((v) => Math.round(v * 1000) / 1000 + 0)).toEqual([-0.5, 0, -0.5, 0.5, 1.4, 0.5]);
  });

  it('turns LDraw coordinates into studs with y up', () => {
    expect(toEditor([20, -24, 40])).toEqual([1, 1.2, -2]);
  });

  it('stands the body on the grid and keeps its studs on top', () => {
    const result = convertPart('brick.dat', flattener);
    if (!result.ok) throw new Error(result.reason);
    expect(result.fit).toMatchObject({ w: 1, d: 1, h: 3, offset: [0, 1.2, 0], snug: true });
    expect(result.triangles).toBe(5);
    const ys = [...result.mesh.positions].filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeCloseTo(0, 5);
    // the stud stands 4 LDU (0.2 studs) above the body
    expect(Math.max(...ys)).toBeCloseTo(1.4, 5);
  });

  it('measures the bottom from underside tubes, which are stud primitives too', () => {
    // a 1 × 1 round plate: a 3 LDU rim with a tube reaching down to 8 LDU
    const round = new Flattener(
      memorySource({
        'round.dat': ['0 Round Plate', '0 BFC CERTIFY CCW', '4 16 -10 0 -10 10 0 -10 10 0 10 -10 0 10', '4 16 -10 3 -10 -10 3 10 10 3 10 10 3 -10', '1 16 0 3 0 1 0 0 0 1 0 0 0 1 stud4.dat'].join('\n'),
        'stud4.dat': ['0 Underside tube', '0 BFC CERTIFY CCW', '3 16 -4 0 0 4 0 0 0 5 4'].join('\n'),
      }),
    );
    const result = convertPart('round.dat', round);
    if (!result.ok) throw new Error(result.reason);
    expect(result.fit).toMatchObject({ w: 1, d: 1, h: 1, offset: [0, 0.4, 0] });
  });

  it('records the cells a part leaves empty, such as the corner of a corner plate', () => {
    const result = convertPart('corner.dat', new Flattener(memorySource({ 'corner.dat': CORNER_PLATE })));
    if (!result.ok) throw new Error(result.reason);
    expect(result.fit).toMatchObject({ w: 2, d: 2, h: 1 });
    // LDraw's +z is the editor's -z: the free cell is at x 1, z 0
    expect(result.solids).toEqual([
      [0, 0, 0, 1, 1, 2],
      [1, 0, 1, 2, 1, 2],
    ]);
  });

  it('records no solids for a part that fills its whole box', () => {
    const result = convertPart('brick.dat', flattener);
    if (!result.ok) throw new Error(result.reason);
    expect(result.solids).toBeNull();
  });

  it('skips parts with no faces', () => {
    expect(convertPart('empty.dat', flattener)).toEqual({ ok: false, reason: 'empty' });
  });

  it("keeps the colours a part fixes, each in a layer after the brick's own", () => {
    const result = convertPart('twotone.dat', flattener, new Map([[4, { hex: '#b40000', finish: 'solid' }]]));
    if (!result.ok) throw new Error(result.reason);
    const layers = result.mesh.layers ?? [];
    expect(layers.map(({ code, hex, finish }) => ({ code, hex, finish }))).toEqual([
      { code: 16, hex: '#ffffff', finish: 'solid' },
      { code: 4, hex: '#b40000', finish: 'solid' },
    ]);
    // one run after the other, covering every index: the red layer is the one red triangle
    expect(layers.map(({ start, count }) => [start, count])).toEqual([
      [0, result.mesh.indices.length - 3],
      [result.mesh.indices.length - 3, 3],
    ]);
  });

  it("orders the colours a part fixes by code, after the brick's own", () => {
    const three = new Flattener(memorySource({ 'three.dat': `3 4 0 0 0 10 0 0 0 0 10\n${BRICK}\n3 0 0 0 0 0 0 10 10 0 0`, 'stud.dat': STUD }));
    const result = convertPart('three.dat', three);
    if (!result.ok) throw new Error(result.reason);
    expect(result.mesh.layers?.map((layer) => layer.code)).toEqual([16, 0, 4]);
  });

  it('drops a colour whose triangles all collapse', () => {
    // a red speck smaller than the welding distance: nothing is left in red, so the brick's colour is all there is
    const flat = new Flattener(memorySource({ 'flat.dat': `${BRICK}\n3 4 0 0 0 0.001 0 0 0 0 0.001`, 'stud.dat': STUD }));
    const result = convertPart('flat.dat', flat);
    if (!result.ok) throw new Error(result.reason);
    expect(result.mesh.layers).toBeUndefined();
  });

  it("lets a part drawn all in one fixed colour take the brick's colour", () => {
    const red = new Flattener(memorySource({ 'red.dat': BRICK.replaceAll(' 16 ', ' 4 '), 'stud.dat': STUD }));
    const result = convertPart('red.dat', red);
    if (!result.ok) throw new Error(result.reason);
    expect(result.mesh.layers).toBeUndefined();
  });
});

/** The sides and top of an upright n-sided prism, LDraw's -y up: from y1 up to y0, `r` from (x, z). */
function ldrawPrism(x: number, z: number, r: number, y0: number, y1: number, n = 8): string[] {
  const at = (i: number, y: number): string => `${x + r * Math.cos((2 * Math.PI * i) / n)} ${y} ${z + r * Math.sin((2 * Math.PI * i) / n)}`;
  const sides = Array.from({ length: n }, (_, i) => `4 16 ${at(i, y1)} ${at(i, y0)} ${at(i + 1, y0)} ${at(i + 1, y1)}`);
  const top = Array.from({ length: n }, (_, i) => `3 16 ${x} ${y0} ${z} ${at(i + 1, y0)} ${at(i, y0)}`);
  return [...sides, ...top];
}

describe('measuring a part’s height', () => {
  /** A 1 × 2 brick, its top at y 0 and its underside 24 LDU down, a stud primitive on its -x half; and what stands on its +x half. */
  const brickWith = (...top: string[]): string => ['0 Test Brick 1 x 2', '0 BFC CERTIFY CCW', ...ldrawBox([-20, 0, -10], [20, 24, 10]), '1 16 -10 0 0 1 0 0 0 1 0 0 0 1 stud.dat', ...top].join('\n');
  const heightOf = (text: string): number => {
    const result = convertPart('part.dat', new Flattener(memorySource({ 'part.dat': text, 'stud.dat': STUD })));
    if (!result.ok) throw new Error(result.reason);
    return result.fit.h;
  };

  it('leaves out a stud LDraw draws without a stud primitive, as on a door frame’s top, where its hinge turns', () => {
    // a plain cylinder a stud wide and a stud tall, where a stud would stand: the brick is still three plates
    expect(heightOf(brickWith(...ldrawPrism(10, 0, 6, -4, 0)))).toBe(3);
    // and on its own, three plates and the rise of its stud
    expect(heightOf(brickWith())).toBe(3);
  });

  it('keeps anything else that stands on a part’s top: a taller post, a narrow pin, a stud-sized nub off the grid', () => {
    // a post two studs tall: 32 LDU, four plates
    expect(heightOf(brickWith(...ldrawPrism(10, 0, 6, -8, 0)))).toBe(4);
    // a pin a stud tall but far narrower than a stud
    expect(heightOf(brickWith(...ldrawPrism(10, 0, 2, -4, 0)))).toBe(4);
    // a stud-sized nub between the stud grid's points, and one only 3 LDU off a point of it
    expect(heightOf(brickWith(...ldrawPrism(0, 0, 6, -4, 0)))).toBe(4);
    expect(heightOf(brickWith(...ldrawPrism(13, 0, 6, -4, 0)))).toBe(4);
  });

  it('stands a baseplate, thinner than a plate, at the top of its cell, so what is built on it sits on it', () => {
    // a 2 × 2 baseplate 4 LDU thick, studs on its top at y 0
    const baseplate = ['0 Baseplate 2 x 2', '0 BFC CERTIFY CCW', ...ldrawBox([-20, 0, -20], [20, 4, 20]), ...[-10, 10].flatMap((x) => [-10, 10].map((z) => `1 16 ${x} 0 ${z} 1 0 0 0 1 0 0 0 1 stud.dat`))].join('\n');
    const source = new Flattener(memorySource({ 'base.dat': baseplate, 'stud.dat': STUD }));
    const as = (category: string) => {
      const result = convertPart('base.dat', source, new Map(), category);
      if (!result.ok) throw new Error(result.reason);
      return result.fit;
    };
    // its top, LDraw's y 0, at the top of its one plate of cells
    expect(as('Baseplate')).toMatchObject({ w: 2, d: 2, h: 1, offset: [0, 0.4, 0] });
    // anything else that thin stands on y = 0 as every part does
    expect(as('Plate')).toMatchObject({ h: 1, offset: [0, 0.2, 0] });
  });
});

describe('reading a library folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'ldraw-'));
  mkdirSync(join(root, 'parts', 's'), { recursive: true });
  mkdirSync(join(root, 'p', '48'), { recursive: true });
  writeFileSync(join(root, 'parts', 'brick.dat'), BRICK);
  writeFileSync(join(root, 'parts', 's', 'brick-s01.dat'), STUD);
  writeFileSync(join(root, 'p', 'stud.dat'), STUD);
  writeFileSync(join(root, 'p', '48', 'ring.dat'), STUD);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('finds parts, subparts and primitives, and tells primitives apart', () => {
    const source = directorySource(root);
    expect(source.read('brick.dat')).toMatchObject({ primitive: false });
    expect(source.read('S\\BRICK-S01.DAT')).toMatchObject({ primitive: false });
    expect(source.read('stud.dat')).toMatchObject({ primitive: true });
    expect(source.read('48\\ring.dat')).toMatchObject({ primitive: true });
    expect(source.read('missing.dat')).toBeNull();
  });
});

describe('credits', () => {
  it('names every author, the licence and the changes made', () => {
    const text = creditsText(
      [
        { file: 'parts/3010.dat', description: 'Brick  1 x  4', author: 'James Jessiman' },
        { file: 'parts/3001.dat', description: 'Brick  2 x  4', author: '' },
      ],
      [{ file: 'p/stud.dat', description: 'Stud', author: 'James Jessiman' }],
      '2026-11-11T00:00:00Z',
    );
    expect(text).toContain('CC BY 4.0');
    expect(text).toContain('Modifications:');
    expect(text).toContain('Parts (2): file, description, author');
    expect(text.indexOf('parts/3001.dat')).toBeLessThan(text.indexOf('parts/3010.dat'));
    expect(text).toContain('parts/3001.dat\tBrick  2 x  4\tunknown');
    expect(text).toContain('p/stud.dat\tStud\tJames Jessiman');
  });
});
