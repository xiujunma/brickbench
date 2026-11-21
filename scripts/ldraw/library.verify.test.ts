/**
 * Converts real parts from the LDraw library and checks they land on the grid
 * exactly where the built-in catalogue (itself verified against LDraw) puts
 * them, so library parts and built-in parts line up and export identically.
 *
 * Opt-in because it needs the library on disk:
 *   LDRAW_DIR=/path/to/ldraw bun test scripts/ldraw/library.verify.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { decodePartMesh, encodePartMesh } from '../../src/core/ldraw/format.ts';
import { readColourTable } from './colours.ts';
import { allConnectors, finishConnectors, HINGE_PRIMITIVES, ROD_PRIMITIVES, type FlatConnector } from './connectors.ts';
import { HINGE_JOINTS } from './hingeJoints.ts';
import { convertPart } from './convert.ts';
import { Flattener } from './flatten.ts';
import { directorySource, memorySource, type LibrarySource } from './library.ts';
import { parseLDraw, type Transform } from './parse.ts';

const LDRAW_DIR = process.env['LDRAW_DIR'];

/** [file, w, d, h, origin] as in src/core/parts/catalog.ts. */
const CATALOGUE: readonly (readonly [string, number, number, number, readonly [number, number, number]])[] = [
  ['3001.dat', 4, 2, 3, [0, 1.2, 0]],
  ['3024.dat', 1, 1, 1, [0, 0.4, 0]],
  ['2453b.dat', 1, 1, 15, [0, 6, 0]],
  ['3068b.dat', 2, 2, 1, [0, 0.4, 0]],
  ['3040b.dat', 1, 2, 3, [0, 1.2, -0.5]],
  ['3039.dat', 2, 2, 3, [0, 1.2, -0.5]],
  ['4286.dat', 1, 3, 3, [0, 1.2, -1]],
  ['3665b.dat', 1, 2, 3, [0, 1.2, -0.5]],
  ['54200.dat', 1, 1, 2, [0, 0, 0]],
  ['3062b.dat', 1, 1, 3, [0, 1.2, 0]],
  ['3941.dat', 2, 2, 3, [0, 1.2, 0]],
  ['4589.dat', 1, 1, 3, [0, 1.2, 0]],
  ['3659.dat', 4, 1, 3, [0, 1.2, 0]],
  ['3307.dat', 6, 1, 6, [0, 2.4, 0]],
];

describe.skipIf(!LDRAW_DIR)('converting the real LDraw library', () => {
  const flattener = new Flattener(directorySource(LDRAW_DIR ?? ''));
  const library = directorySource(LDRAW_DIR ?? '');

  /** A source with LDraw's files, and one more of our own on top. */
  const withModel = (name: string, text: string): LibrarySource => {
    const extra = memorySource({ [name]: text });
    return { read: (file) => extra.read(file) ?? library.read(file) };
  };
  /** Every connection a file is drawn with, in LDraw's frame: those an assembly's own halves take among them. */
  const joinsOf = (file: string, source: LibrarySource = library): FlatConnector[] => allConnectors(new Flattener(source).flatten(file).connectors);
  /** The kinds of connection a file's part ends up with: where another part can plug in. */
  const freeOf = (file: string): string => finishConnectors(new Flattener(library).flatten(file).connectors).map((j) => j.kind).join(' ');
  /** Pairs of joints of these kinds that sit together (to half an LDraw unit) along one line; pointing the same way along it, when `sameWay`. */
  const together = (joints: readonly FlatConnector[], a: FlatConnector['kind'], b: FlatConnector['kind'], sameWay = false): number =>
    joints
      .filter((j) => j.kind === a)
      .filter((j) =>
        joints.some((k) => {
          const along = j.axis[0] * k.axis[0] + j.axis[1] * k.axis[1] + j.axis[2] * k.axis[2];
          return k.kind === b && Math.hypot(j.at[0] - k.at[0], j.at[1] - k.at[1], j.at[2] - k.at[2]) < 0.5 && (sameWay ? along : Math.abs(along)) > 0.999;
        }),
      ).length;

  const ROUND = /^(?:48\\|8\\)?\d+-\d+(?:edge|cyli|cylc|cylo|cyls|disc|ndis|con\d+|ring\d*|chrd|tndis|sphe)\.dat$/i;
  const STUDS = /^(?:48\\|8\\)?stu/i;
  /** One LDraw reference inside another: where the inner one lands. */
  const compose = (p: Transform, c: Transform): Transform => {
    const [a, b, cc, d, e, f, g, h, i] = p.m;
    const [A, B, C, D, E, F, G, H, I] = c.m;
    const [x, y, z] = c.t;
    return {
      t: [p.t[0] + a * x + b * y + cc * z, p.t[1] + d * x + e * y + f * z, p.t[2] + g * x + h * y + i * z],
      m: [a * A + b * D + cc * G, a * B + b * E + cc * H, a * C + b * F + cc * I, d * A + e * D + f * G, d * B + e * E + f * H, d * C + e * F + f * I, g * A + h * D + i * G, g * B + h * E + i * H, g * C + h * F + i * I],
    };
  };
  /** A point's line along `axis`, as the point of it nearest the origin, to a hundredth: "x,y,z". */
  const lineThrough = ([x, y, z]: readonly [number, number, number], [ux, uy, uz]: readonly [number, number, number]): string => {
    const along = x * ux + y * uy + z * uz;
    return [x - along * ux, y - along * uy, z - along * uz].map((v) => Math.round(v * 100) / 100 + 0).join(',');
  };
  /**
   * The lines the round surfaces a file is drawn with turn about, among
   * those along `axis` (of radius `radius` only, when given), the line of
   * the most surfaces first; studs are left out. This is how a pivot is
   * read off a part's drawing.
   */
  const pivotsOf = (file: string, axis: readonly [number, number, number], radius?: number): string[] => {
    const found = new Map<string, number>();
    const walk = (name: string, at: Transform): void => {
      for (const line of parseLDraw(library.read(name)?.text ?? '')) {
        if (line.kind !== 'ref' || STUDS.test(line.file)) continue;
        const placed = compose(at, line.matrix);
        if (!ROUND.test(line.file)) {
          walk(line.file, placed);
          continue;
        }
        const [a, b, , d, e, , g, h] = placed.m;
        if (Math.abs(b * axis[0] + e * axis[1] + h * axis[2]) / Math.hypot(b, e, h) < 0.999) continue;
        if (radius !== undefined && Math.abs(Math.hypot(a, d, g) - radius) > 0.1) continue;
        const key = lineThrough(placed.t, axis);
        found.set(key, (found.get(key) ?? 0) + 1);
      }
    };
    walk(file, { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] });
    return [...found.entries()].sort((p, q) => q[1] - p[1]).map(([line]) => line);
  };
  const pivotOf = (file: string, axis: readonly [number, number, number], radius?: number): string | undefined => pivotsOf(file, axis, radius)[0];
  /**
   * Whether a file is drawn with a rod at `s` along a joint's line from its
   * middle: a surface `radius` from the line, facing out from it. A seat a
   * rod turns in is that far from the line too, and faces in.
   */
  const rodAt = (file: string, joint: FlatConnector, s: number, radius = 4): boolean => {
    let out = 0;
    for (const { a, b, c } of new Flattener(library).flatten(file).triangles) {
      const corners = [a, b, c].map((p) => {
        const off = [p[0] - joint.at[0], p[1] - joint.at[1], p[2] - joint.at[2]] as const;
        const along = off[0] * joint.axis[0] + off[1] * joint.axis[1] + off[2] * joint.axis[2];
        return { along, radial: [off[0] - along * joint.axis[0], off[1] - along * joint.axis[1], off[2] - along * joint.axis[2]] as const };
      });
      if (corners.some(({ radial }) => Math.abs(Math.hypot(...radial) - radius) > 0.3)) continue;
      if (Math.min(...corners.map(({ along }) => along)) > s || Math.max(...corners.map(({ along }) => along)) < s) continue;
      const [u, v] = [[b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const, [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const];
      const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]] as const;
      for (const { radial } of corners) out += normal[0] * radial[0] + normal[1] * radial[1] + normal[2] * radial[2];
    }
    return out > 0;
  };

  it.each(CATALOGUE)('%s fits the grid like the built-in part', (file, w, d, h, origin) => {
    const result = convertPart(file, flattener);
    if (!result.ok) throw new Error(`${file} was skipped: ${result.reason}`);
    expect([result.fit.w, result.fit.d, result.fit.h]).toEqual([w, d, h]);
    result.fit.offset.forEach((value, k) => expect(value).toBeCloseTo(origin[k] ?? 0, 3));
    expect(result.fit.snug).toBe(true);
  });

  it('finds the studs on parts’ sides, and none on plain bricks', () => {
    const sideOf = (file: string) => {
      const result = convertPart(file, flattener);
      if (!result.ok) throw new Error(`${file} was skipped: ${result.reason}`);
      return result.sideStuds;
    };
    // facing index 4 is +Z: the studs stand 14 LDU (0.7 studs) up a brick, out of its front half a stud from its middle
    expect(sideOf('87087.dat')).toEqual([[0, 0.7, 0.5, 4]]);
    expect(sideOf('11211.dat')).toEqual([
      [-0.5, 0.7, 0.5, 4],
      [0.5, 0.7, 0.5, 4],
    ]);
    // a bracket's four, on the face of its upright plate
    expect(sideOf('99207.dat')).toHaveLength(4);
    expect(sideOf('99207.dat').every(([, , z, facing]) => z === 0.7 && facing === 4)).toBe(true);
    for (const file of ['3001.dat', '3024.dat', '3794b.dat']) expect(sideOf(file)).toEqual([]);
  });

  it('finds the Technic and click-hinge connections of real parts', () => {
    const connectorsOf = (file: string) => {
      const result = convertPart(file, flattener);
      if (!result.ok) throw new Error(`${file} was skipped: ${result.reason}`);
      // [kind, x, y, z, ax, ay, az, length], to two places, with axes as they lie
      return result.connectors.map((entry) => entry.map((v) => Math.round(v * 100) / 100 + 0));
    };
    const kinds = (file: string) => connectorsOf(file).map(([kind]) => ['pin', 'pinhole', 'axle', 'axlehole', 'finger', 'fork'][kind ?? 0]);
    // a Technic brick's one hole runs through it from front to back, 0.7 studs (14 LDU) up from its bottom
    expect(connectorsOf('3700.dat')[0]).toEqual([1, 0, 0.7, 0, 0, 0, 1, 1]);
    // and its studs are open: a bar stands in each
    expect(connectorsOf('3700.dat').slice(1).map(([kind]) => kind)).toEqual([18, 18]);
    // a beam's three holes, upright, a stud apart
    expect(
      connectorsOf('32523.dat')
        .map(([, x, , z, , ay]) => [x, z, Math.abs(ay ?? 0)])
        .sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0)),
    ).toEqual([
      [0, -1, 1],
      [0, 0, 1],
      [0, 1, 1],
    ]);
    // a pin's two ends, each a stud long, pointing away from its middle; a long pin's three sections
    expect(connectorsOf('3673.dat').map(([kind, x, , , ax, , , length]) => [kind, x, ax, length])).toEqual([
      [0, -0.5, -1, 1],
      [0, 0.5, 1, 1],
    ]);
    expect(kinds('6558.dat')).toEqual(['pin', 'pin', 'pin']);
    // an axle 4 is four studs long, near enough (its bevelled ends are drawn a little short)
    expect(kinds('3705.dat')).toEqual(['axle']);
    expect(connectorsOf('3705.dat')[0]?.[7]).toBeCloseTo(4, 1);
    // a bush, a gear and a half bush take an axle; an axle pin is a pin at one end and an axle at the other
    for (const file of ['3713.dat', '3647.dat', '4265c.dat']) expect(kinds(file)).toEqual(['axlehole']);
    expect(kinds('43093.dat')).toEqual(['pin', 'axle']);
    // click hinges: one finger on a plate, and the fork of two it fits
    expect(kinds('44301.dat')).toEqual(['finger']);
    expect(kinds('44302.dat')).toEqual(['fork']);
    expect(connectorsOf('44301.dat')[0]?.slice(1, 4)).toEqual(connectorsOf('44302.dat')[0]?.slice(1, 4));
    // plain bricks and plates have none; a brick's open side stud holds a bar, facing out of its side
    for (const file of ['3001.dat', '3024.dat']) expect(connectorsOf(file)).toEqual([]);
    expect(connectorsOf('87087.dat')).toEqual([[18, 0, 0.7, 0.6, 0, 0, 1, 0.2]]);
  });

  it('turns each hinge primitive, click hinges and the older fingers, about where its round surfaces are centred', () => {
    for (const [name, primitive] of Object.entries(HINGE_PRIMITIVES)) {
      expect(`${name} ${pivotOf(`${name}.dat`, primitive.axis)}`).toBe(`${name} ${lineThrough(primitive.through, primitive.axis)}`);
    }
  });

  it('sets the older hinges and the turntables turning where their parts’ round surfaces are centred, and where LDraw’s assembled ones put their halves', () => {
    for (const [file, joints] of Object.entries(HINGE_JOINTS)) {
      // a file with two pivots (a canopy extender's fingers at one end, its holder's at the other, both across it) turns about those two lines
      const [first] = joints;
      if (!first) throw new Error(file);
      const set = joints.map((joint) => lineThrough(joint.at, joint.axis)).sort();
      expect(`${file} ${pivotsOf(file, first.axis).slice(0, joints.length).sort().join(' | ')}`).toBe(`${file} ${set.join(' | ')}`);
    }
    // LDraw's own assembled hinges and turntables: each brings its two halves' joints together, pointing the same way, which is how one
    // half goes onto the other at rest. A complete 1 × 8 hinge brick's second half is turned half round, a complete control stick's
    // stick set 2 LDU up its base
    const assembled: readonly (readonly [string, FlatConnector['kind'], FlatConnector['kind']])[] = [
      ['3937c01.dat', 'hingebase', 'hingetop'],
      ['73983.dat', 'swivelbase', 'swiveltop'],
      ['3680c01.dat', 'turnbase', 'turntop'],
      ['4508c01.dat', 'turnbase', 'turntop'],
      ['3403c01.dat', 'turnbase4', 'turntop4'],
      ['30516c01.dat', 'turnbase4', 'turntop4'],
      ['61485c01.dat', 'turnflat', 'turnsnap'],
      ['3149ec01.dat', 'foldbase', 'foldtop'],
      ['3149dc01.dat', 'foldbase', 'foldtop'],
      ['3324ec01.dat', 'foldbase', 'foldtop'],
      ['3324dc01.dat', 'foldbase', 'foldtop'],
      ['73587a.dat', 'stickbase', 'stick'],
      ['652c01.dat', 'tongue', 'yoke'],
    ];
    for (const [file, base, top] of assembled) expect(`${file} ${together(joinsOf(file), base, top, true)}`).toBe(`${file} 1`);
    // the 2 × 2 hinge top and the locking 4 × 4 turntable top are drawn from the plain ones, and turn as they do
    expect(joinsOf('6134.dat').map((j) => j.kind)).toContain('hingetop');
    expect(joinsOf('30658.dat').map((j) => j.kind)).toContain('turntop4');
    // a 1 × 4 hinge brick's top swivels on a pin in its base's hole: put together about one origin, the pin is in the hole
    const brick = joinsOf('hinge.ldr', withModel('hinge.ldr', '1 16 0 0 0 1 0 0 0 1 0 0 0 1 3831.dat\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 3830.dat'));
    expect(together(brick, 'pin', 'pinhole')).toBe(1);
    // a 1 × 4 hinge plate's small pivot is drawn with a Technic pin's primitive at two thirds its size: it is no Technic pin
    expect(joinsOf('2430.dat').map((j) => j.kind)).toEqual(['swiveltop']);
  });

  it('tells the four fingers of roofs, canopies and panels from the five of their holders, by where each is a rod about its pivot', () => {
    // along the pivot from its middle: the holder's fingers at 0, ±20 and ±38 LDU, the roof's between them at ±10 and ±29. Where the
    // other half's fingers go, a part is drawn with nothing, or with the seat they turn in
    const places = [-38, -29, -20, -10, 0, 10, 20, 29, 38];
    const drawn = { fingers4: '.+.+.+.+.', fingers5: '+.+.+.+.+' };
    let checked = 0;
    for (const [file, joints] of Object.entries(HINGE_JOINTS)) {
      for (const joint of joints) {
        if (joint.kind !== 'fingers4' && joint.kind !== 'fingers5') continue;
        expect(`${file} ${joint.kind} ${places.map((s) => (rodAt(file, joint, s) ? '+' : '.')).join('')}`).toBe(`${file} ${joint.kind} ${drawn[joint.kind]}`);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(15);
    // every part of the kind has them: roofs, a hinged tile and slope, a panel and a canopy half, windscreens and canopies, and the
    // extender, which has a holder's five as well; and the three holders
    const withFingers = ['4213', '2349a', '2349b', '2873', '4857', '2582', '6084', '30161', '2620', '2483', '4474', '2507', '30083', '2337'];
    for (const id of withFingers) expect(`${id} ${freeOf(`${id}.dat`).split(' ').filter((kind) => kind === 'fingers4').length}`).toBe(`${id} 1`);
    for (const id of ['4214', '4625', '4315', '2337']) expect(`${id} ${freeOf(`${id}.dat`).split(' ').filter((kind) => kind === 'fingers5').length}`).toBe(`${id} 1`);
    // a part's fingers point -X with the part behind them (towards -Z), as a roof is, and +X with it before them, as a panel is: so
    // each goes onto a holder reaching on from it. A screen that stands on its fingers, no more to one side than the other, may point either way
    for (const [file, joints] of Object.entries(HINGE_JOINTS)) {
      for (const joint of joints.filter((j) => j.kind === 'fingers4')) {
        const depths = new Flattener(library).flatten(file).triangles.flatMap((t) => [t.a[2], t.b[2], t.c[2]]);
        const middle = (Math.min(...depths) + Math.max(...depths)) / 2 - joint.at[2];
        if (Math.abs(middle) > 5) expect(`${file} ${Math.sign(middle)}`).toBe(`${file} ${Math.sign(joint.axis[0])}`);
      }
    }
    // a hinge tile's two fingers are where a hinge plate's two are, which LDraw draws with a primitive
    const [tile] = joinsOf('4531.dat').filter((j) => j.kind === 'fingers2');
    const [plate] = joinsOf('4276b.dat').filter((j) => j.kind === 'fingers2');
    expect(tile).toEqual(plate as FlatConnector);
    for (const s of [-8, -4, 0, 4, 8]) expect(`4531 ${s} ${rodAt('4531.dat', tile as FlatConnector, s)}`).toBe(`4531 ${s} ${rodAt('4276b.dat', plate as FlatConnector, s)}`);
    // the halves keep their joints, and a canopy extender both of its
    expect(freeOf('4213.dat')).toBe('fingers4');
    expect(freeOf('4315.dat')).toBe('fingers5');
    expect(freeOf('2337.dat')).toBe('fingers4 fingers5');
    // patterned roofs and tiles are drawn from the plain ones, and hinge as they do
    expect(joinsOf('2873d01.dat').map((j) => j.kind)).toContain('fingers4');
    // printed canopies, panels and windscreens are drawn from the file the plain one's shape is in, not from the plain one: each has
    // the plain one's fingers, once, pointing the same way
    const printed: Readonly<Record<string, readonly string[]>> = {
      '2507.dat': ['2507p01.dat', '2507p61.dat', '2507p6u.dat', '2507pa1.dat', '2507pa2.dat'],
      '2582.dat': ['2582p68.dat', '2582p6u.dat', '2582pa0.dat', '2582pa1.dat', '2582ps0.dat'],
      '4474.dat': ['4474p61.dat'],
      '2483.dat': ['2483p50.dat'],
      '30083.dat': ['30083ps0.dat'],
      '30161.dat': ['30161pa1.dat'],
      '2349a.dat': ['2349b.dat'],
    };
    const fingersOf = (file: string) => joinsOf(file).filter((j) => j.kind === 'fingers4');
    for (const [plain, prints] of Object.entries(printed)) {
      expect(`${plain} ${fingersOf(plain).length}`).toBe(`${plain} 1`);
      for (const print of prints) expect(`${print} ${JSON.stringify(fingersOf(print))}`).toBe(`${print} ${JSON.stringify(fingersOf(plain))}`);
    }
  });

  it('leaves a ready-made assembly without the joints its own halves take', () => {
    // a complete hinge brick keeps only its top's two open studs; complete swivelling hinge plates and turntables keep nothing
    expect(freeOf('3937c01.dat')).toBe('barhole barhole');
    for (const file of ['73983.dat', '3680c01.dat', '3403c01.dat', '30516c01.dat', '61485c01.dat']) expect(`${file}: ${freeOf(file)}`).toBe(`${file}: `);
    // the turntable on a hinge plate keeps the plate's fingers
    expect(freeOf('4508c01.dat')).toBe('fingers3');
    // complete folding hinge plates, 1 × 8 hinge bricks and control sticks keep nothing: they stack like any part
    for (const file of ['3149ec01.dat', '3324dc01.dat', '652c01.dat', '73587a.dat']) expect(`${file}: ${freeOf(file)}`).toBe(`${file}: `);
    // a torso with its arms and hands on keeps its neck, its waist and its hands' grips; hips with their legs on, the two studs a torso goes on
    expect(freeOf('76382.dat')).toBe('neck waist waist clip clip');
    expect(freeOf('73200b-f1.dat')).toBe('hips hips');
    // a lightsaber's blade stands in its hilt: that end of the hilt is taken, the blade is still a bar to hold
    expect(freeOf('64567ac01.dat')).toBe('bar bar barhole');
    // the halves on their own keep theirs
    expect(freeOf('3937.dat')).toBe('hingebase');
    expect(freeOf('3938.dat')).toBe('barhole barhole hingetop');
    expect(freeOf('973.dat')).toBe('neck waist waist shoulder shoulder');
  });

  it('finds the older hinge plates’ fingers, two to go between three, about one pivot', () => {
    const fingersOf = (file: string) => joinsOf(file).filter((j) => j.kind === 'fingers2' || j.kind === 'fingers3');
    const [three] = fingersOf('4275b.dat');
    const [two] = fingersOf('4276b.dat');
    expect([three?.kind, two?.kind]).toEqual(['fingers3', 'fingers2']);
    // each 10 LDU beyond its plate's end, half way up it, across its width: turned half a turn, one's fingers go between the other's
    for (const hinge of [three, two]) expect(hinge?.at.map((v) => Math.round(v * 100) / 100 + 0)).toEqual([30, 4, 0]);
    expect(Math.abs(three?.axis[2] ?? 0)).toBeCloseTo(1, 6);
    // a plate with both, one at each end
    expect(fingersOf('4504.dat').map((j) => j.kind).sort()).toEqual(['fingers2', 'fingers3']);
  });

  it('joins minifigures where LDraw’s own assembled minifigures put their parts', () => {
    // a torso with arms and hands: both shoulders hold an arm, both wrists a hand
    const torsoWithArms = joinsOf('76382.dat');
    expect(together(torsoWithArms, 'shoulder', 'arm')).toBe(2);
    expect(together(torsoWithArms, 'wrist', 'hand')).toBe(2);
    // hips with legs: the legs on the hips' axle (both legs' joints are one place, so kept once)
    expect(together(joinsOf('73200b-f1.dat'), 'hip', 'leg')).toBe(1);
    // a head sitting on the torso's shoulders, its neck in it, and the hips under the torso by their two studs
    const figure = ['1 16 0 0 0 1 0 0 0 1 0 0 0 1 973.dat', '1 16 0 -24 0 1 0 0 0 1 0 0 0 1 3626b.dat', '1 16 0 32 0 1 0 0 0 1 0 0 0 1 3815b.dat'].join('\n');
    const whole = joinsOf('figure.ldr', withModel('figure.ldr', figure));
    expect(together(whole, 'neck', 'head')).toBe(1);
    expect(together(whole, 'waist', 'hips')).toBe(2);
    // the head's joint is at its underside, which rests on the torso's top
    const head = new Flattener(directorySource(LDRAW_DIR ?? '')).flatten('3626b.dat');
    expect(Math.max(...head.triangles.flatMap((t) => [t.a[1], t.b[1], t.c[1]]))).toBeCloseTo(joinsOf('3626b.dat')[0]?.at[1] ?? NaN, 1);
    // printed variants carry their part's joints: a printed torso, a head with the other hollow stud, a right leg
    expect(joinsOf('973p01.dat').map((j) => j.kind)).toEqual(['neck', 'waist', 'waist', 'shoulder', 'shoulder']);
    // (its hollow stud holds a bar)
    expect(joinsOf('3626c.dat').map((j) => j.kind)).toEqual(['head', 'barhole']);
    expect(joinsOf('3816c.dat').map((j) => j.kind)).toEqual(['leg']);
  });

  it('finds bars, and the clips and minifigure hands that hold them', () => {
    const kindsOf = (file: string) => finishConnectors(new Flattener(directorySource(LDRAW_DIR ?? '')).flatten(file).connectors).map((c) => [c.kind, Math.round(c.length)]);
    // a bar 3 studs long; a plate with a handle along it; a lightsaber blade
    expect(kindsOf('87994.dat')).toEqual([['bar', 60]]);
    expect(kindsOf('48336.dat')).toEqual([['bar', 40]]);
    expect(kindsOf('30374.dat')).toEqual([['bar', 80]]);
    // plates with clips; a minifigure's hand, by its pin and its grip
    expect(kindsOf('61252.dat').map(([kind]) => kind)).toEqual(['clip']);
    expect(kindsOf('63868.dat').map(([kind]) => kind)).toEqual(['clip']);
    expect(kindsOf('3820.dat').map(([kind]) => kind)).toEqual(['hand', 'clip']);
    // a round brick's open stud holds a bar; a plain brick's stud does not
    expect(kindsOf('3062b.dat').map(([kind]) => kind)).toEqual(['barhole']);
    expect(kindsOf('3005.dat')).toEqual([]);
    // the cylinders studs and minifigure torsos are drawn with are not bars
    for (const file of ['3001.dat', '3024.dat', '3023.dat', '973.dat', '3062b.dat']) expect(kindsOf(file).filter(([kind]) => kind === 'bar')).toEqual([]);
  });

  it('takes for open studs the stud primitives with a bar-sized hole right down their middle', () => {
    const flattener = new Flattener(directorySource(LDRAW_DIR ?? ''));
    /** How near its own axis a primitive is drawn: 4 LDU, a bar's radius, for an open stud; 0 for one with a top across it. */
    const bore = (file: string): number => Math.min(...flattener.flatten(file).triangles.flatMap((t) => [t.a, t.b, t.c].map(([x, , z]) => Math.hypot(x, z))));
    for (const name of ['stud2', 'stud2a', 'stud6', 'stud6a', 'stud17', 'stud17a']) {
      expect(`${name} ${bore(`${name}.dat`).toFixed(2)}`).toBe(`${name} 4.00`);
      const [hole] = finishConnectors(flattener.flatten(`${name}.dat`).connectors);
      // from the stud's base to its top, 4 LDU up, its axis pointing out of it
      expect([hole?.kind, hole?.at, hole?.axis, hole?.length]).toEqual(['barhole', [0, -2, 0], [0, -1, 0], 4]);
    }
    // a solid stud, and one with small holes, hold no bar
    for (const name of ['stud', 'stud9', 'stud10', 'stud15']) {
      expect(bore(`${name}.dat`)).toBeLessThan(3.9);
      expect(finishConnectors(flattener.flatten(`${name}.dat`).connectors)).toEqual([]);
    }
    // an inverted dome's four open studs, drawn with stud6a for its round top, hold bars too
    expect(finishConnectors(flattener.flatten('24947.dat').connectors).filter((c) => c.kind === 'barhole')).toHaveLength(4);
    // a round 2 × 2 brick's studs are solid ones cut to its curve: none
    expect(finishConnectors(flattener.flatten('3941.dat').connectors).filter((c) => c.kind === 'barhole')).toEqual([]);
  });

  it('holds bars on the line each clip primitive’s bar-sized round surfaces run round', () => {
    for (const [name, primitive] of Object.entries(ROD_PRIMITIVES)) {
      expect(`${name} ${pivotOf(`${name}.dat`, primitive.axis, 4)}`).toBe(`${name} ${lineThrough(primitive.through, primitive.axis)}`);
    }
  });

  it('says which way a jumper plate’s stud sits between cells, and that a plain plate’s do not', () => {
    const offsetOf = (file: string) => {
      const result = convertPart(file, flattener);
      if (!result.ok) throw new Error(`${file} was skipped: ${result.reason}`);
      return result.fit.studOffset;
    };
    // 1 × 2 jumpers, with and without groove or understud; a 2 × 2 with one centre stud; a 1 × 3 with two studs offset
    for (const file of ['3794a.dat', '3794b.dat', '15573.dat', '34103.dat']) expect(offsetOf(file)).toEqual([0.5, 0]);
    expect(offsetOf('87580.dat')).toEqual([0.5, 0.5]);
    for (const file of ['3023.dat', '3024.dat', '3001.dat']) expect(offsetOf(file)).toEqual([0, 0]);
  });

  it('keeps a converted brick inside its cells, studs on top', () => {
    const result = convertPart('3001.dat', flattener);
    if (!result.ok) throw new Error('3001.dat was skipped');
    const { positions } = decodePartMesh(encodePartMesh(result.mesh));
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    positions.forEach((value, i) => {
      min[i % 3] = Math.min(min[i % 3] ?? Infinity, value);
      max[i % 3] = Math.max(max[i % 3] ?? -Infinity, value);
    });
    expect(min[0]).toBeCloseTo(-2, 2);
    expect(max[0]).toBeCloseTo(2, 2);
    expect(min[2]).toBeCloseTo(-1, 2);
    expect(max[2]).toBeCloseTo(1, 2);
    expect(min[1]).toBeCloseTo(0, 2);
    // studs stand 4 LDU (0.2 studs) above the 1.2-stud body
    expect(max[1]).toBeCloseTo(1.4, 2);
  });

  /** The cells of its box a converted part leaves free, as sorted "x,y,z" keys. */
  function freeCells(file: string): string[] {
    const result = convertPart(file, flattener);
    if (!result.ok) throw new Error(`${file} was skipped: ${result.reason}`);
    const { w, d, h } = result.fit;
    const filled = new Set<string>();
    for (const [x0, y0, z0, x1, y1, z1] of result.solids ?? [[0, 0, 0, w, h, d]]) {
      for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) filled.add(`${x},${y},${z}`);
    }
    const free: string[] = [];
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) if (!filled.has(`${x},${y},${z}`)) free.push(`${x},${y},${z}`);
    return free.sort();
  }

  it('fills only the cells real parts take up', () => {
    // bricks fill their box, hollow undersides and all; so do slopes and round bricks
    for (const file of ['3001.dat', '3039.dat', '3062b.dat', '3941.dat']) expect(freeCells(file)).toEqual([]);
    // the missing corner of a corner plate and a corner brick
    expect(freeCells('2420.dat')).toEqual(['1,0,0']);
    expect(freeCells('2357.dat')).toEqual(['1,0,0', '1,1,0', '1,2,0']);
    // the opening of an arch, and of a door frame between its posts
    expect(freeCells('3307.dat')).toEqual(['1,0,0', '2,0,0', '2,1,0', '2,2,0', '2,3,0', '3,0,0', '3,1,0', '3,2,0', '3,3,0', '4,0,0']);
    expect(freeCells('30179.dat')).toEqual(Array.from({ length: 16 }, (_, y) => [`1,${y + 1},0`, `2,${y + 1},0`]).flat().sort());
    // under a bracket's top plate, where the wall its other plate hangs over goes
    expect(freeCells('44728.dat')).toEqual(['0,0,0', '0,1,0', '0,2,0', '0,3,0', '1,0,0', '1,1,0', '1,2,0', '1,3,0']);
  });

  it('keeps the colours parts fix in layers of their own', () => {
    const colours = readColourTable(readFileSync(join(LDRAW_DIR ?? '', 'LDConfig.ldr'), 'utf8'));
    const layersOf = (file: string) => {
      const result = convertPart(file, flattener, colours);
      if (!result.ok) throw new Error(`${file} was skipped: ${result.reason}`);
      return (result.mesh.layers ?? []).map(({ code, hex, finish }) => ({ code, hex, finish }));
    };
    // a wheel rim in the brick's colour with its rubber tyre
    expect(layersOf('11208c01.dat')).toEqual([
      { code: 16, hex: '#ffffff', finish: 'solid' },
      { code: 256, hex: '#1b2a34', finish: 'solid' },
    ]);
    // a pull-back motor with an axle of its own colours
    expect(layersOf('10039.dat').length).toBeGreaterThan(1);
  });
});
