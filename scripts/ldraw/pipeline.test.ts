import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';
import { convertPart, toEditor } from './convert.ts';
import { creditsText } from './credits.ts';
import { Flattener } from './flatten.ts';
import { directorySource, memorySource } from './library.ts';

/** A 1 × 1 brick: top and bottom faces 24 LDU apart, plus one stud. */
const BRICK = [
  '0 Test Brick 1 x 1',
  '0 BFC CERTIFY CCW',
  '4 16 -10 0 -10 10 0 -10 10 0 10 -10 0 10',
  '4 16 -10 24 -10 -10 24 10 10 24 10 10 24 -10',
  '1 16 0 0 0 1 0 0 0 1 0 0 0 1 stud.dat',
].join('\n');
const STUD = ['0 Stud', '0 BFC CERTIFY CCW', '3 16 -6 -4 0 6 -4 0 0 -4 6'].join('\n');

describe('converting a part', () => {
  const source = memorySource({
    'brick.dat': BRICK,
    'stud.dat': STUD,
    'twotone.dat': `${BRICK}\n3 4 0 0 0 1 0 0 0 0 1`,
    'empty.dat': '0 Nothing to see\n0 BFC CERTIFY CCW',
  });
  const flattener = new Flattener(source);

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

  it('skips parts drawn in several fixed colours and parts with no faces', () => {
    expect(convertPart('twotone.dat', flattener)).toEqual({ ok: false, reason: 'multicolour' });
    expect(convertPart('empty.dat', flattener)).toEqual({ ok: false, reason: 'empty' });
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
