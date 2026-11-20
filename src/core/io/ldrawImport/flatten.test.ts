import { describe, expect, it } from 'bun:test';
import { flatten, isSubmodel, multiply, squareUp, transformPoint, type Placement } from './flatten';
import { readLDraw, type M3 } from './read';

const LIMITS = { maxParts: 1000, maxReferences: 10_000 };
const TURN: M3 = [0, 0, -1, 0, 1, 0, 1, 0, 0];
const isDat = (file: string): boolean => file.toLowerCase().endsWith('.dat') && !file.startsWith('custom');

function placements(lines: readonly string[], isPart = isDat, limits = LIMITS): readonly Placement[] {
  const result = flatten(readLDraw(lines.join('\n'), 'm.mpd'), isPart, limits);
  if (!result.ok) throw new Error(result.error);
  return result.value.placements;
}

describe('flatten', () => {
  it('passes the parts of a single-file model through as they are', () => {
    expect(placements(['1 4 40 -24 -20 1 0 0 0 1 0 0 0 1 3001.dat'])).toEqual([
      {
        file: '3001.dat',
        group: '',
        groupName: 'm.mpd',
        squared: null,
        submodels: [],
        steps: [0],
        colour: { code: 4 },
        position: [40, -24, -20],
        matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      },
    ]);
  });

  it('places the parts of a submodel wherever and however the model places it', () => {
    const parts = placements([
      '0 FILE main.ldr',
      '1 16 100 0 0 1 0 0 0 1 0 0 0 1 Bogie',
      '1 16 0 -24 0 0 0 -1 0 1 0 1 0 0 Bogie',
      '0 FILE bogie',
      '1 72 20 0 0 1 0 0 0 1 0 0 0 1 3001.dat',
    ]);
    expect(parts.map((p) => p.position)).toEqual([
      [120, 0, 0],
      [0, -24, 20],
    ]);
    expect(parts[1]?.matrix).toEqual(TURN);
    // each use of the submodel is a piece of its own
    expect(parts.map((p) => [p.group, p.groupName])).toEqual([
      ['0', 'Bogie'],
      ['1', 'Bogie'],
    ]);
  });

  it('tells each part the steps of the lines leading to it, and the submodels they use', () => {
    const parts = placements([
      '0 FILE main.ldr',
      '1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat',
      '0 STEP',
      '1 16 0 0 0 1 0 0 0 1 0 0 0 1 car.ldr',
      '0 FILE car.ldr',
      '0 STEP',
      '1 16 0 0 0 1 0 0 0 1 0 0 0 1 Wheels.ldr',
      '0 FILE wheels.ldr',
      '0 STEP',
      '0 STEP',
      '1 0 0 0 0 1 0 0 0 1 0 0 0 1 3003.dat',
    ]);
    expect(parts.map((p) => [p.steps, p.submodels])).toEqual([
      [[0], []],
      [[1, 1, 2], ['car.ldr', 'Wheels.ldr']],
    ]);
  });

  it('names nested uses of submodels by the lines leading to them', () => {
    const parts = placements(['0 FILE main.ldr', '1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat', '1 16 0 0 0 1 0 0 0 1 0 0 0 1 car.ldr', '0 FILE car.ldr', '1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat', '1 16 0 0 0 1 0 0 0 1 0 0 0 1 Wheels.ldr', '0 FILE wheels.ldr', '1 0 0 0 0 1 0 0 0 1 0 0 0 1 3003.dat']);
    expect(parts.map((p) => [p.group, p.groupName])).toEqual([
      ['', 'main.ldr'],
      ['1', 'car.ldr'],
      ['1/1', 'Wheels.ldr'],
    ]);
  });

  it('gives parts in the main colour the colour of the submodel holding them', () => {
    const parts = placements([
      '0 FILE main.ldr',
      '1 4 0 0 0 1 0 0 0 1 0 0 0 1 wall.ldr',
      '1 16 0 0 0 1 0 0 0 1 0 0 0 1 3003.dat',
      '0 FILE wall.ldr',
      '1 16 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat',
      '1 1 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat',
      '1 24 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat',
    ]);
    expect(parts.map((p) => p.colour)).toEqual([{ code: 4 }, { code: 1 }, { code: 4 }, { code: 16 }]);
  });

  it('skips submodels that lead back into themselves', () => {
    const result = flatten(
      readLDraw(['0 FILE a.ldr', '1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat', '1 16 0 0 0 1 0 0 0 1 0 0 0 1 b.ldr', '0 FILE b.ldr', '1 16 0 0 0 1 0 0 0 1 0 0 0 1 a.ldr', '1 16 0 0 0 1 0 0 0 1 0 0 0 1 3003.dat'].join('\n'), 'm.mpd'),
      isDat,
      LIMITS,
    );
    expect(result).toMatchObject({ ok: true, value: { skipped: 1 } });
    if (result.ok) expect(result.value.placements.map((p) => p.file)).toEqual(['3001.dat', '3003.dat']);
  });

  it('takes a part the library knows over a file of the same name in the model', () => {
    const parts = placements(['0 FILE main.ldr', '1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat', '0 FILE 3001.dat', '1 4 0 0 0 1 0 0 0 1 0 0 0 1 3003.dat']);
    expect(parts.map((p) => p.file)).toEqual(['3001.dat']);
  });

  it('turns a submodel stood at an angle square, about its own origin, and says so', () => {
    const parts = placements([
      '0 FILE main.ldr',
      // the truck stands at 30° for show; its cab is a submodel of its own
      '1 14 100 0 50 0.86603 0 -0.5 0 1 0 0.5 0 0.86603 Truck.ldr',
      '0 FILE truck.ldr',
      '1 16 40 0 0 1 0 0 0 1 0 0 0 1 3001.dat',
      '1 16 0 0 0 1 0 0 0 1 0 0 0 1 cab.ldr',
      '0 FILE cab.ldr',
      '1 16 0 -24 0 0 0 -1 0 1 0 1 0 0 3003.dat',
    ]);
    expect(parts.map((p) => [p.position, p.matrix, p.squared])).toEqual([
      [[140, 0, 50], [1, 0, 0, 0, 1, 0, 0, 0, 1], 'Truck.ldr'],
      [[100, -24, 50], TURN, 'Truck.ldr'],
    ]);
  });

  it('places custom parts the model draws itself, and nothing for empty submodels', () => {
    const parts = placements([
      '0 FILE main.ldr',
      '1 4 0 0 0 1 0 0 0 1 0 0 0 1 custom.dat',
      '1 4 0 0 0 1 0 0 0 1 0 0 0 1 empty.ldr',
      '0 FILE custom.dat',
      '0 !LDRAW_ORG Unofficial_Part',
      '1 16 0 0 0 1 0 0 0 1 0 0 0 1 stud.dat',
      '3 16 0 0 0 1 0 0 0 0 1',
      '0 FILE empty.ldr',
      '0 Nothing here',
    ]);
    // the custom part is one part, not the pieces it is drawn with
    expect(parts.map((p) => p.file)).toEqual(['custom.dat']);
  });

  it('builds a submodel with a stray line drawn into it, part by part', () => {
    const parts = placements(['0 FILE main.ldr', '1 16 0 0 0 1 0 0 0 1 0 0 0 1 Sub.ldr', '1 16 0 0 0 1 0 0 0 1 0 0 0 1 Tower', '0 FILE Sub.ldr', '1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat', '2 24 0 0 0 40 0 0', '0 FILE Tower', '1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat', '1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat', '2 24 0 0 0 40 0 0']);
    expect(parts.map((p) => [p.file, p.groupName])).toEqual([
      ['3001.dat', 'Sub.ldr'],
      ['3001.dat', 'Tower'],
      ['3001.dat', 'Tower'],
    ]);
  });

  it('places references to files the model does not hold, for matching to report', () => {
    expect(placements(['1 4 0 0 0 1 0 0 0 1 0 0 0 1 wheels.ldr']).map((p) => p.file)).toEqual(['wheels.ldr']);
  });

  it('refuses models with more parts than the limit', () => {
    const lines = Array.from({ length: 4 }, () => '1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat');
    expect(flatten(readLDraw(lines.join('\n'), 'm.ldr'), isDat, { maxParts: 3, maxReferences: 100 })).toEqual({
      ok: false,
      error: 'This model is too big to open: it has more than 3 parts.',
    });
  });

  it('stops models that nest empty submodels over and over', () => {
    const lines = ['0 FILE m0.ldr'];
    for (let level = 0; level < 30; level++) {
      lines.push(`1 16 0 0 0 1 0 0 0 1 0 0 0 1 m${level + 1}.ldr`, `1 16 0 0 0 1 0 0 0 1 0 0 0 1 m${level + 1}.ldr`, `0 FILE m${level + 1}.ldr`);
    }
    lines.push('0 the deepest file is empty');
    const result = flatten(readLDraw(lines.join('\n'), 'm.mpd'), isDat, LIMITS);
    expect(result).toEqual({ ok: false, error: 'This model nests its submodels too many times over to open.' });
  });
});

describe('isSubmodel', () => {
  const file = (over: Partial<Parameters<typeof isSubmodel>[0]>) => ({ name: 'f', title: '', lines: [], drawsShapes: false, declared: null, ...over });
  const line = (name: string) => ({ colour: { code: 16 }, position: [0, 0, 0] as const, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] as M3, file: name, step: 0 });
  const known = (name: string): boolean => name === '3001.dat';

  it('goes by what the file declares itself to be', () => {
    expect(isSubmodel(file({ lines: [line('3001.dat')], declared: 'part' }), 'u1.dat', known)).toBe(false);
    expect(isSubmodel(file({ lines: [line('stud.dat')], drawsShapes: true, declared: 'model' }), 'x.dat', known)).toBe(true);
  });

  it('then by a model file name, or by drawing no shapes', () => {
    expect(isSubmodel(file({ lines: [line('stud.dat')], drawsShapes: true }), 'wing.ldr', known)).toBe(true);
    expect(isSubmodel(file({ lines: [line('stud.dat')] }), 'wing', known)).toBe(true);
  });

  it('then by whether it mostly places parts it knows', () => {
    expect(isSubmodel(file({ lines: [line('3001.dat'), line('3001.dat'), line('stud.dat')], drawsShapes: true }), 'wing', known)).toBe(true);
    expect(isSubmodel(file({ lines: [line('3001.dat'), line('stud.dat')], drawsShapes: true }), 'u2.dat', known)).toBe(false);
  });

  it('never takes an empty file for one', () => {
    expect(isSubmodel(file({ declared: 'model' }), 'empty.ldr', known)).toBe(false);
  });
});

describe('squareUp', () => {
  it('turns upright matrices at any angle to the nearest quarter turn', () => {
    const at = (degrees: number): M3 => {
      const a = (degrees * Math.PI) / 180;
      return [Math.cos(a), 0, -Math.sin(a), 0, 1, 0, Math.sin(a), 0, Math.cos(a)];
    };
    expect(squareUp(at(30))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(squareUp(at(60))).toEqual(TURN);
    expect(squareUp(at(-100))).toEqual([0, 0, 1, 0, 1, 0, -1, 0, 0]);
    expect(squareUp(at(179))).toEqual([-1, 0, 0, 0, 1, 0, 0, 0, -1]);
  });

  it('leaves square matrices, and tipped ones, alone', () => {
    expect(squareUp([1, 0, 0, 0, 1, 0, 0, 0, 1])).toBeNull();
    expect(squareUp(TURN)).toBeNull();
    expect(squareUp([0.996, -0.087, 0, 0.087, 0.996, 0, 0, 0, 1])).toBeNull();
    expect(squareUp([1, 0, 0, 0, -1, 0, 0, 0, -1])).toBeNull();
    expect(squareUp([2, 0, 0, 0, 1, 0, 0, 0, 2])).toBeNull();
  });
});

describe('transforms', () => {
  it('turns and moves points', () => {
    expect(transformPoint(TURN, [20, 0, 0], [1, 2, 3])).toEqual([1, 2, 23]);
  });

  it('multiplies matrices: four quarter turns are no turn', () => {
    const twice = multiply(TURN, TURN);
    expect(multiply(twice, twice)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
});
