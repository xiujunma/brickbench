import { describe, expect, it } from 'bun:test';
import { flattenPart } from './flatten.ts';
import { memorySource } from './library.ts';
import { parseLDraw } from './parse.ts';

const certified = (body: string, winding = 'CCW') => `0 Test\n0 BFC CERTIFY ${winding}\n${body}\n`;
/** One counter-clockwise triangle facing +Z (towards a viewer at +Z). */
const TRI = '3 16 0 0 0 1 0 0 0 1 0';

function normalZ(t: { a: readonly number[]; b: readonly number[]; c: readonly number[] }): number {
  const [ax = 0, ay = 0] = t.a;
  const [bx = 0, by = 0] = t.b;
  const [cx = 0, cy = 0] = t.c;
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

describe('parseLDraw', () => {
  it('reads references, triangles, quads and hex colours, and skips lines', () => {
    const lines = parseLDraw(
      ['0 Name: x.dat', '1 4 1 2 3 1 0 0 0 1 0 0 0 1 s\\sub.dat', '2 24 0 0 0 1 1 1', '3 0x2FF0000 0 0 0 1 0 0 0 1 0', '4 16 0 0 0 1 0 0 1 1 0 0 1 0', '5 24 0 0 0 1 1 1 2 2 2 3 3 3'].join('\r\n'),
    );
    expect(lines.map((l) => l.kind)).toEqual(['meta', 'ref', 'tri', 'quad']);
    expect(lines[1]).toMatchObject({ kind: 'ref', color: 4, file: 's\\sub.dat', matrix: { t: [1, 2, 3] } });
    expect(lines[2]).toMatchObject({ kind: 'tri', color: 0x2ff0000 });
  });
});

describe('flattenPart', () => {
  it('keeps counter-clockwise triangles and turns clockwise files around', () => {
    const ccw = flattenPart('a.dat', memorySource({ 'a.dat': certified(TRI) }));
    const cw = flattenPart('b.dat', memorySource({ 'b.dat': certified(TRI, 'CW') }));
    expect(normalZ(ccw.triangles[0]!)).toBeGreaterThan(0);
    expect(normalZ(cw.triangles[0]!)).toBeLessThan(0);
  });

  it('flips sub-files after INVERTNEXT or a mirroring matrix, and both together cancel out', () => {
    const files = {
      'tri.dat': certified(TRI),
      'inv.dat': certified('0 BFC INVERTNEXT\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 tri.dat'),
      'mirror.dat': certified('1 16 0 0 0 1 0 0 0 1 0 0 0 -1 tri.dat'),
      'both.dat': certified('0 BFC INVERTNEXT\n1 16 0 0 0 1 0 0 0 1 0 0 0 -1 tri.dat'),
    };
    const source = memorySource(files);
    expect(normalZ(flattenPart('inv.dat', source).triangles[0]!)).toBeLessThan(0);
    expect(normalZ(flattenPart('mirror.dat', source).triangles[0]!)).toBeLessThan(0);
    expect(normalZ(flattenPart('both.dat', source).triangles[0]!)).toBeGreaterThan(0);
  });

  it('applies the reference transform and inherits the reference colour', () => {
    const source = memorySource({
      'tri.dat': certified(`${TRI}\n3 14 0 0 0 1 0 0 0 1 0`),
      'part.dat': certified('1 16 10 20 30 2 0 0 0 2 0 0 0 2 tri.dat\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 tri.dat'),
    });
    const { triangles } = flattenPart('part.dat', source);
    expect(triangles).toHaveLength(4);
    expect(triangles[0]?.b).toEqual([12, 20, 30]);
    expect(triangles.map((t) => t.color)).toEqual([16, 14, 4, 14]);
  });

  it('splits quads and marks NOCLIP geometry as double-sided', () => {
    const source = memorySource({ 'q.dat': certified('0 BFC NOCLIP\n4 16 0 0 0 1 0 0 1 1 0 0 1 0\n0 BFC CLIP\n' + TRI) });
    const { triangles } = flattenPart('q.dat', source);
    expect(triangles.map((t) => t.doubleSided)).toEqual([true, true, false]);
  });

  it('tags stud geometry and finds upward-facing top studs', () => {
    const source = memorySource({
      'stud.dat': certified(TRI),
      'stud4.dat': certified(TRI),
      'brick.dat': certified(
        [
          TRI,
          '1 16 10 0 0 1 0 0 0 1 0 0 0 1 stud.dat',
          '1 16 -10 0 0 1 0 0 0 1 0 0 0 1 stud.dat',
          '1 16 0 4 0 1 0 0 0 1 0 0 0 1 stud4.dat',
          '1 16 20 -8 0 0 1 0 -1 0 0 0 0 1 stud.dat',
        ].join('\n'),
      ),
    });
    const part = flattenPart('brick.dat', source);
    expect(part.triangles.filter((t) => t.stud)).toHaveLength(4);
    expect(part.topStuds).toEqual([
      [10, 0, 0],
      [-10, 0, 0],
    ]);
  });

  it('reports missing files instead of failing silently', () => {
    expect(() => flattenPart('a.dat', memorySource({ 'a.dat': certified('1 16 0 0 0 1 0 0 0 1 0 0 0 1 gone.dat') }))).toThrow(/gone\.dat/);
  });
});
