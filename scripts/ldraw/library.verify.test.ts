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
import { partConnections } from './bare.ts';
import { allConnectors, finishConnectors, HINGE_PRIMITIVES, ROD_PRIMITIVES, type FlatConnector } from './connectors.ts';
import { CLIP_JOINTS } from './clipJoints.ts';
import { HINGE_JOINTS } from './hingeJoints.ts';
import { convertPart } from './convert.ts';
import { Flattener, type FlatTriangle } from './flatten.ts';
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
  /** Where another part can plug into a file's part, as the build finds it: its connections, its bars where they are bare. */
  const connectionsOf = (file: string): FlatConnector[] => partConnections(new Flattener(library).flatten(file));
  /** The kinds of connection a file's part ends up with. */
  const freeOf = (file: string): string => connectionsOf(file).map((j) => j.kind).join(' ');
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
   * Which way the surface a file is drawn with faces, `radius` from a
   * joint's line at `s` along it from its middle: above 0 out from the line
   * (a rod), below 0 in towards it (a seat a rod turns in, the inside of a
   * clip); 0 where there is none.
   */
  const facingAt = (file: string, joint: FlatConnector, s: number, radius: number): number => {
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
    return out;
  };
  /** Whether a file is drawn with a rod at `s` along a joint's line from its middle. */
  const rodAt = (file: string, joint: FlatConnector, s: number, radius = 4): boolean => facingAt(file, joint, s, radius) > 0;

  const drawings = new Map<string, readonly FlatTriangle[]>();
  /** The triangles a file is drawn with, flattened once. */
  const trianglesOf = (file: string): readonly FlatTriangle[] => {
    const known = drawings.get(file) ?? new Flattener(library).flatten(file).triangles;
    drawings.set(file, known);
    return known;
  };
  /** How near a bar's radius (4 LDU) a surface must be to count as a bar's or a clip's, in LDU. */
  const BAR_SURFACE = 0.12;
  /**
   * How much of a turn the surfaces a file is drawn with go round a joint's
   * line, `radius` from it (a bar's, unless given), at `s` along it from its
   * middle: those facing in towards the line (the inside of a clip or a
   * hole) and those facing out from it (a rod), each from 0 to 1.
   */
  const wallAt = (file: string, joint: FlatConnector, s: number, radius = 4): { readonly inwards: number; readonly outwards: number } => {
    const [x, y, z] = joint.axis;
    const side = Math.abs(y) < 0.9 ? ([z, 0, -x] as const) : ([0, -z, y] as const);
    const size = Math.hypot(...side);
    const u = [side[0] / size, side[1] / size, side[2] / size] as const;
    const v = [y * u[2] - z * u[1], z * u[0] - x * u[2], x * u[1] - y * u[0]] as const;
    const degrees = { inwards: new Set<number>(), outwards: new Set<number>() };
    for (const { a, b, c } of trianglesOf(file)) {
      const corners = [a, b, c].map((p) => {
        const off = [p[0] - joint.at[0], p[1] - joint.at[1], p[2] - joint.at[2]] as const;
        return { along: off[0] * x + off[1] * y + off[2] * z, pu: off[0] * u[0] + off[1] * u[1] + off[2] * u[2], pv: off[0] * v[0] + off[1] * v[1] + off[2] * v[2] };
      });
      if (corners.some(({ pu, pv }) => Math.abs(Math.hypot(pu, pv) - radius) > BAR_SURFACE)) continue;
      if (Math.min(...corners.map(({ along }) => along)) > s || Math.max(...corners.map(({ along }) => along)) < s) continue;
      const [p, q] = [[b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const, [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const];
      const normal = [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]] as const;
      const [nu, nv] = [normal[0] * u[0] + normal[1] * u[1] + normal[2] * u[2], normal[0] * v[0] + normal[1] * v[1] + normal[2] * v[2]];
      const facing = corners.reduce((sum, { pu, pv }) => sum + nu * pu + nv * pv, 0);
      if (facing === 0) continue;
      // the degrees round the line the triangle covers: from its first corner to its last, the short way round
      const angles = corners.map(({ pu, pv }) => ((Math.atan2(pv, pu) * 180) / Math.PI + 360) % 360).sort((m, n) => m - n) as [number, number, number];
      const gaps = [angles[1] - angles[0], angles[2] - angles[1], angles[0] + 360 - angles[2]];
      const widest = gaps.indexOf(Math.max(...gaps));
      const from = [angles[1], angles[2], angles[0]][widest] ?? 0;
      for (let k = 0; k < Math.round(360 - (gaps[widest] ?? 0)); k++) (facing < 0 ? degrees.inwards : degrees.outwards).add(Math.floor(from + k + 0.5) % 360);
    }
    return { inwards: degrees.inwards.size / 360, outwards: degrees.outwards.size / 360 };
  };
  /**
   * What a file is drawn with round a joint's line at `s`: 'clip', the
   * inside of one, going half to three quarters of the way round with no
   * rod in it; 'rod', one going all the way round; '-', nothing a bar's
   * radius from the line; or else how much faces in and out.
   */
  const drawnAt = (file: string, joint: FlatConnector, s: number): string => {
    const { inwards, outwards } = wallAt(file, joint, s);
    if (inwards === 0 && outwards === 0) return '-';
    if (outwards === 0 && inwards > 0.45 && inwards < 0.8) return 'clip';
    if (inwards === 0 && outwards > 0.9) return 'rod';
    return `in ${inwards.toFixed(2)} out ${outwards.toFixed(2)}`;
  };
  /** ... at seven places along it: a third of an LDU beyond each end and inside it, at its middle and near either end. */
  const drawnAlong = (file: string, joint: FlatConnector): string => {
    const half = joint.length / 2;
    return [-half - 0.3, -half + 0.3, -0.8 * half, 0, 0.8 * half, half - 0.3, half + 0.3].map((s) => drawnAt(file, joint, s)).join(' ');
  };
  /** A clip is drawn as one from end to end and stops there; so is a rod. */
  const AS_CLIP = '- clip clip clip clip clip -';
  const AS_ROD = '- rod rod rod rod rod -';
  /** The clips a file's part ends up with, free for a bar. */
  const freeClips = (file: string): FlatConnector[] => connectionsOf(file).filter((c) => c.kind === 'clip');

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

  it('finds which of a part’s connections are alike by its whole shape, not by its box and connections alone', () => {
    const alikeOf = (file: string): readonly number[] | null => {
      const result = convertPart(file, flattener);
      if (!result.ok) throw new Error(`${file} was skipped: ${result.reason}`);
      return result.alike;
    };
    // a pin's two ends, with friction ridges or without; the holes at the two ends of a beam 3, not its middle one; the four
    // holes round a dome's rim, not the one at its top; a gear rack's two holes, and its two axle holes
    expect(alikeOf('3673.dat')).toEqual([0, 0]);
    expect(alikeOf('2780.dat')).toEqual([0, 0]);
    expect(alikeOf('32523.dat')).toEqual([0, 1, 0]);
    // a beam 7, one of whose end holes LDraw draws the other way round: a hole goes right through, so it is alike all the same
    expect(alikeOf('32524.dat')).toEqual([0, 1, 2, 3, 2, 1, 0]);
    expect(alikeOf('57587.dat')).toEqual([0, 1, 0, 0, 0]);
    expect(alikeOf('64781.dat')).toEqual([0, 0, 2, 2]);
    // a shock absorber's two ends: the same holes and box both ways round, but a cylinder at one end and a rod at the other;
    // a long pin's long and short ends; an axle pin's pin and axle; a droid's arm, its shoulder's clip and its hand's
    for (const file of ['47373-f1.dat', '6558.dat', '43093.dat', '30377.dat']) expect(alikeOf(file)).toBeNull();
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

  it('finds the snap under each round plate, round brick and gear plate that turns on a flat turntable base, and the ring on each base it goes into', () => {
    const round = (v: number): number => Math.round(v * 100) / 100 + 0;
    const heights = (file: string): number[] => trianglesOf(file).flatMap((t) => [t.a[1], t.b[1], t.c[1]]);
    // the snap's primitive is round about its own axis
    expect(pivotOf('stud18a.dat', [0, 1, 0])).toBe('0,0,0');
    // the snap: a tube in the middle of the part's underside, its last 4 LDU, 7 LDU round its line outside and 6 inside
    const snapping = ['60474', '11213', '74611', '89523', '35442', '35443', '35446', '68325', '87081', '18897', '65138', '72024'];
    for (const id of snapping) {
      const file = `${id}.dat`;
      const snaps = connectionsOf(file).filter((j) => j.kind === 'turnsnap');
      const bottom = Math.max(...heights(file));
      expect(`${id} ${snaps.map((j) => `${j.at.map(round)} ${j.axis.map(round)} ${round(j.length)}`).join(' | ')}`).toBe(`${id} 0,${round(bottom - 2)},0 0,1,0 4`);
      const [snap] = snaps;
      if (!snap) throw new Error(id);
      expect(`${id} ${facingAt(file, snap, -1, 7) > 0} ${facingAt(file, snap, -1, 6) < 0}`).toBe(`${id} true true`);
    }
    // the ring: 4 LDU tall on the top of each base, its lip 7.5 LDU round its line, round the snap's tube, facing in; the 2 × 2 socket
    // that clips into a hole is wider outside it
    const rings = { '61485': 10, '27448': 10, '65146': 11.5 };
    for (const [id, outside] of Object.entries(rings)) {
      const file = `${id}.dat`;
      const found = connectionsOf(file).filter((j) => j.kind === 'turnflat');
      const top = Math.min(...heights(file));
      expect(`${id} ${found.map((j) => `${j.at.map(round)} ${j.axis.map(round)} ${round(j.length)}`).join(' | ')}`).toBe(`${id} 0,${round(top + 2)},0 0,1,0 4`);
      const [ring] = found;
      if (!ring) throw new Error(id);
      expect(`${id} ${facingAt(file, ring, -1, 7.5) < 0} ${facingAt(file, ring, 0, outside) > 0}`).toBe(`${id} true true`);
    }
    // a container lid's two sockets, in its sides, are free for a snap
    expect(freeOf('65128c01p01.dat')).toBe('turnflat turnflat');
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
    const kindsOf = (file: string) => connectionsOf(file).map((c) => [c.kind, Math.round(c.length * 10) / 10]);
    // a bar 3 studs long; a plate with a handle along it, between the posts it runs into; a lightsaber blade
    expect(kindsOf('87994.dat')).toEqual([['bar', 60]]);
    expect(kindsOf('48336.dat')).toEqual([['bar', 28]]);
    expect(kindsOf('30374.dat')).toEqual([['bar', 80]]);
    // bars LDraw draws as closed cylinders: a whip, a flame with a bar, a blade on a bar, a cutlass's grip up to its guard
    expect(kindsOf('2488.dat')).toEqual([['bar', 48]]);
    expect(kindsOf('85959.dat')).toEqual([['bar', 16]]);
    expect(kindsOf('87747.dat')).toEqual([['bar', 10]]);
    expect(kindsOf('2530.dat')).toEqual([['bar', 12]]);
    // a decoration with two bars, one drawn as a closed cylinder without its edge lines
    expect(kindsOf('98593.dat')).toEqual([['bar', 12.5], ['bar', 11.9]]);
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

  it('keeps a bar only where it is bare: drawn, and nothing of its part round it', () => {
    const barsOf = (file: string) => connectionsOf(file).filter((c) => c.kind === 'bar').map((c) => Math.round(c.length * 10) / 10);
    // a plate with a handle whose ends are free: the ends and the middle, not where it runs through its posts; a shield's grip
    // between its ends; a lightsaber's blade out of its hilt, and the hilt's end up to the ring round it; the axles of a brick
    // with train wheels, between brick and wheels
    expect(barsOf('2540.dat')).toEqual([8, 12, 8]);
    expect(barsOf('92747.dat')).toEqual([15]);
    expect(barsOf('42114c01.dat')).toEqual([73, 11]);
    expect(barsOf('4180c01.dat')).toEqual([18, 18]);
    // none: a colour sensor's rod sits in a socket, a pull-back motor's axle in a channel, all but its ends
    expect(barsOf('95650.dat')).toEqual([]);
    expect(barsOf('10039.dat')).toEqual([]);
    // where its part closes round it a little further out: no piston rod in a pneumatic cylinder's bore, only the hose
    // ports, and the rod out of it when it is drawn out; no leads in a speed regulator's plugs; a Fabuland axe's handle
    // between the rings on it; a skeleton's leg, whose rod has a collar round its middle
    expect(barsOf('19476-f1.dat')).toEqual([10, 11]);
    expect(barsOf('19476-f2.dat')).toEqual([122, 10, 11]);
    expect(barsOf('2869c01.dat')).toEqual([]);
    expect(barsOf('4438.dat')).toEqual([10.1, 21.3, 9.1]);
    expect(barsOf('6266.dat')).toEqual([]);
    // each bar kept has its own surface round it and nothing facing in round it, from one end to the other
    const bare = (file: string, bar: FlatConnector): string => {
      const half = bar.length / 2;
      return [-half + 0.3, -0.8 * half, 0, 0.8 * half, half - 0.3]
        .map((s) => wallAt(file, bar, s))
        .map(({ inwards, outwards }) => (inwards === 0 && outwards > 0 ? 'bare' : `in ${inwards.toFixed(2)} out ${outwards.toFixed(2)}`))
        .join(' ');
    };
    for (const file of ['2540.dat', '48336.dat', '92747.dat', '42114c01.dat', '4180c01.dat', '2488.dat', '85959.dat', '2530.dat', '630.dat', '15396c01.dat', '6260c01.dat', '19476-f2.dat', '4438.dat']) {
      for (const bar of connectionsOf(file).filter((c) => c.kind === 'bar')) expect(`${file} ${bar.at}: ${bare(file, bar)}`).toBe(`${file} ${bar.at}: ${'bare '.repeat(5).trim()}`);
    }
  });

  it('keeps an axle only where nothing of its part holds it', () => {
    const axlesOf = (file: string) => connectionsOf(file).filter((c) => c.kind === 'axle').map((c) => Math.round(c.length * 10) / 10);
    // none where an assembly's own parts are on its axles: a battery box car's wheels, and a Bigfig's arms on the axle pins at its
    // shoulders, which hold them in axle holes LDraw doesn't draw as such
    expect(axlesOf('3443bc01.dat')).toEqual([]);
    expect(axlesOf('10128p01c01.dat')).toEqual([]);
    // either side of a stop on an axle; a motor's shaft out of its bearing, a linear actuator's out of its body, a pneumatic
    // cylinder's rod out of its cap, a shock absorber's out of its cylinder, and a wind-up motor's either side of the wall it runs
    // through
    expect(axlesOf('32209.dat')).toEqual([87.5, 18]);
    expect(axlesOf('59426.dat')).toEqual([89.5, 17.5]);
    expect(axlesOf('6216d.dat')).toEqual([19]);
    expect(axlesOf('92693c01-f1.dat')).toEqual([19.5]);
    expect(axlesOf('127c01-f1.dat')).toEqual([91]);
    expect(axlesOf('73129.dat')).toEqual([37]);
    expect(axlesOf('42073c01.dat')).toEqual([19.5, 6]);
    // a hook's axle between the ribs on it, and a Kolhii stick's shaft either side of the rings on it, too close together for
    // anything to go on between them
    expect(axlesOf('42074.dat')).toEqual([4.7, 4.4, 5, 19.5]);
    expect(axlesOf('44811.dat')).toEqual([19.5, 19.5, 51, 63, 16.5]);
    // whole: an axle, and an axle pin's, with nothing round them; a motor's hollow shaft on its steel axle; a limb's axle, which a
    // pin hole crosses; a boat's shaft, which its part goes only part of the way round, and which LDraw draws in pieces a notch apart,
    // as it does the 2L axle; and a flexible axle, drawn in pieces a rib apart
    expect(axlesOf('3705.dat')).toEqual([79]);
    expect(axlesOf('43093.dat')).toEqual([19.5]);
    expect(axlesOf('74569.dat')).toEqual([18]);
    expect(axlesOf('50922.dat')).toEqual([14.3]);
    expect(axlesOf('48083c01.dat')).toEqual([59]);
    expect(axlesOf('32062.dat')).toEqual([39]);
    expect(axlesOf('32580.dat')).toEqual([92.8]);
    // measured another way: where an assembly's axle is left out, a hole's wall a Technic hole's radius from its line faces in
    // towards it, all the way round (a wheel's) or at the ends of the cross's arms (an arm's axle hole) ...
    const axleOf = (file: string): FlatConnector => joinsOf(file).find((c) => c.kind === 'axle') ?? expect.unreachable();
    expect(wallAt('3443bc01.dat', axleOf('3443bc01.dat'), 0, 6).inwards).toBe(1);
    expect(wallAt('10128p01c01.dat', axleOf('10128p01c01.dat'), 0, 6).inwards).toBeGreaterThan(0);
    // ... and none faces in towards an axle kept, from end to end
    const clear = (file: string, axle: FlatConnector): string => {
      const half = axle.length / 2;
      return [-half + 0.3, -0.8 * half, 0, 0.8 * half, half - 0.3].map((s) => wallAt(file, axle, s, 6).inwards.toFixed(2)).join(' ');
    };
    for (const file of ['32209.dat', '59426.dat', '6216d.dat', '92693c01-f1.dat', '127c01-f1.dat', '73129.dat', '42073c01.dat', '42074.dat', '44811.dat', '3705.dat', '43093.dat', '74569.dat', '50922.dat', '48083c01.dat', '32062.dat', '32580.dat']) {
      for (const axle of connectionsOf(file).filter((c) => c.kind === 'axle')) expect(`${file} ${axle.at}: ${clear(file, axle)}`).toBe(`${file} ${axle.at}: ${'0.00 '.repeat(5).trim()}`);
    }
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

  it('finds the clips parts draw with plain arcs: five eighths of a turn inside out, a bar’s radius from their line', () => {
    const clipsOf = (file: string) =>
      finishConnectors(new Flattener(library).flatten(file).connectors)
        .filter((c) => c.kind === 'clip')
        .map((c) => `${c.at.map((v) => Math.round(v * 100) / 100 + 0).join(',')} along ${c.axis.map((v) => Math.abs(Math.round(v))).join('')} ${Math.round(c.length)} long`);
    // a 1 × 1 tile with a clip on top, the old one drawn in two halves and the thick one in one arc; a 2 × 3 tile with two
    expect(clipsOf('2555.dat')).toEqual(['0,-6,0 along 001 8 long']);
    expect(clipsOf('15712.dat')).toEqual(['0,-6,0 along 001 8 long']);
    expect(clipsOf('30350c.dat')).toEqual(['-10,2,40 along 100 8 long', '10,2,40 along 100 8 long']);
    // a droid's arm with a clip at each end, a bar with a clip, a skeleton's leg, which clips to its body's bar
    expect(clipsOf('30377.dat')).toHaveLength(2);
    expect(clipsOf('3484.dat')).toHaveLength(1);
    expect(clipsOf('6266.dat')).toHaveLength(1);
    // an islander's mask with a clip either side, 5 long; a hand on a bar handle, its clip between 9 and 10
    expect(clipsOf('6030.dat')).toEqual(['-30,-3.5,-0.15 along 001 5 long', '30,-3.5,-0.15 along 001 5 long']);
    expect(freeClips('109866.dat').map((c) => c.length.toFixed(1))).toEqual(['9.4']);
    // a plate with a clip LDraw draws with its clip primitive has that one clip still
    expect(clipsOf('61252.dat')).toEqual(['0,2,-20 along 100 8 long']);
    // each is drawn as a clip: its inside more than half the way round a bar, from one end of it to the other and no further
    for (const file of ['2555.dat', '15712.dat', '30350c.dat', '30377.dat', '3484.dat', '6266.dat', '6030.dat', '109866.dat', '61252.dat']) {
      for (const clip of freeClips(file)) expect(`${file} ${clip.at}: ${drawnAlong(file, clip)}`).toBe(`${file} ${clip.at}: ${AS_CLIP}`);
    }
    // not clips: the slot in the hollow end of a pin, the notch of a small wheel's hole, the seat of a hinge brick's top, a hollow
    // stud's hole, the blocked stud of a minifigure's head
    for (const file of ['2780.dat', '4624.dat', '3937.dat', '3062b.dat', '3626b.dat', '4213.dat', '4315.dat']) expect(`${file} ${clipsOf(file).length}`).toBe(`${file} 0`);
  });

  it('holds bars in the clips set on their parts, where each is drawn: its inside half to three quarters of the way round a bar, from end to end', () => {
    // a clip's inside, a bar's radius from its line, over the clip's length and no further; the bars set with them are rods as long
    for (const [file, joints] of Object.entries(CLIP_JOINTS)) {
      for (const joint of joints) {
        expect(`${file} ${joint.kind} ${joint.at}: ${drawnAlong(file, joint)}`).toBe(`${file} ${joint.kind} ${joint.at}: ${joint.kind === 'clip' ? AS_CLIP : AS_ROD}`);
      }
    }
    const set = Object.entries(CLIP_JOINTS).flatMap(([file, joints]) => joints.map((joint) => `${file} ${joint.kind}`));
    expect(set.filter((joint) => joint.endsWith(' clip'))).toHaveLength(62);
    // the one bar: the shaft of a bar with a clip that has a hole through it, drawn in pieces
    expect(set.filter((joint) => !joint.endsWith(' clip'))).toEqual(['48729b.dat bar']);
    // a super battle droid's hips and a droid's shoulders, which LDraw draws as closed cylinders, the rule for bars finds
    const barsAt = (file: string) => joinsOf(file).filter((j) => j.kind === 'bar').map((j) => `${j.at.map((v) => Math.round(v * 100) / 100 + 0)} ${j.length}`);
    expect(barsAt('41889.dat')).toContain('0,0,0 22.5');
    expect(barsAt('s/30375s01.dat')).toEqual(expect.arrayContaining(['-15.75,-32,0 8.5', '15.75,-32,0 8.5']));
    // that shaft is the bar the plain one's is, which LDraw draws as one cylinder
    const shaft = (file: string) => joinsOf(file).filter((j) => j.kind === 'bar').map((j) => `${j.at.map((v) => Math.round(v * 10) / 10)} ${Math.round(j.length * 10) / 10}`);
    expect(shaft('48729b.dat')).toEqual(shaft('48729a.dat'));
    // every part they are set for has them, by how many clips it ends up with: bars with a clip, droids' arms and legs, figures'
    // bent arms, a martian's head, saddles, an arm with a towball, a sabre, feathers, ladders, leaves, a panel, two trap doors'
    // frames, Technic connectors, a tile with clips, plain, printed and with a sticker, a skateboard with wheel clips, a cannon's
    // base, a conveyor belt's frame, a motorcycle's body and an arch; the hands of Friends figures' arms, left and right, female
    // and male, and of their torsos with arms; a short curved arm with a hand, and the cloud and the creature drawn with two of
    // it; a samurai's helmet and a dragon helmet, which hold a crest, the one with a dragon plume on its crest its clip still
    // free; a link of a chain tread, which clips onto the next one's bar
    const clips: Readonly<Record<string, number>> = {
      '48729a': 1, '48729b': 1, '59230': 2, '53989': 1, '10058': 1, '30376': 1, '41890': 1, '64796': 1, '42687': 1, '66788': 1, '28660': 1,
      '30529': 1, '30529p01': 1, '30529p02': 1, '4491a': 1, '4491b': 2, '30082': 1, '59229': 1, '30127': 1, '30127p01': 1, '6020': 2, '30095': 4,
      '30239': 1, '30034': 1, '92107': 2, '47994': 2, '19159': 2, '30350a': 2, '30350ap01': 2, '30350ad01': 2,
      '45917': 2, '2527': 4, '633': 6, '30187': 1, '30041': 2, '2145': 2,
      '92244': 1, '92245': 1, '92246': 1, '92247': 1, '92456': 2, '11408': 2, '73161': 2, '73141': 2, '92815': 2, '92816': 2,
      '24129': 1, '27039': 2, '24133': 2, '30175': 1, '6122': 1, '6122c01': 1, '69910': 2,
    };
    for (const [id, count] of Object.entries(clips)) expect(`${id} ${freeClips(`${id}.dat`).length}`).toBe(`${id} ${count}`);
    expect(freeOf('48729b.dat')).toBe('bar clip');
    expect(freeOf('48729a.dat')).toBe('bar clip');
    expect(freeOf('59230.dat')).toBe('clip clip');
    expect(freeOf('4491b.dat')).toBe('clip clip');
    // a droid's torso has its shoulders, with its neck and its hips' bar, plain or printed; a super battle droid's body its hips'
    // bar, with its shoulders
    expect(freeOf('30375.dat')).toBe('bar bar bar bar barhole');
    expect(freeOf('30375ps1.dat')).toBe('bar bar bar bar barhole');
    expect(freeOf('41889.dat')).toBe('bar bar bar');
    // not a clip: the slit ring at the end of a fishing rod, which goes nearly all the way round, too far for a bar to be pressed in
    expect(freeClips('93222.dat')).toEqual([]);
  });

  it('leaves an assembly without the clips and bars its own parts fill, the clips found by their shape among them', () => {
    // droids and a martian, their arms on their shoulders: the hands' clips are free, the shoulders and the arms' other clips taken,
    // and so are the clips of a droid's head on its neck and of its legs on its hips; the bars those clips are on go on past them,
    // by less than a clip's length
    for (const file of ['30375cs0.dat', '30375cs1.dat', '30375cs2.dat', '30375cs3.dat', '30529c01.dat']) expect(`${file}: ${freeOf(file)}`).toBe(`${file}: clip clip barhole`);
    expect(joinsOf('30375cs0.dat').filter((j) => j.kind === 'clip')).toHaveLength(6);
    // super battle droids, their arms' clips on their shoulders and their legs' on their hips: nothing is left of those bars
    for (const file of ['41889c01.dat', '41889c02.dat']) {
      expect(`${file}: ${freeOf(file)}`).toBe(`${file}: `);
      expect(joinsOf(file).filter((j) => j.kind === 'clip')).toHaveLength(3);
    }
    // a skeleton with its legs' clips on its hips' two bars: its arms are left; a motorcycle with its handlebars in its clip:
    // their two grips are left; a dragon with its wings' bars in its body's clips: too little of them is left
    expect(freeOf('6260c01.dat')).toBe('head bar bar barhole barhole');
    expect(freeOf('18895c01.dat')).toBe(`bar bar${' barhole'.repeat(8)}`);
    expect(freeOf('75174c01.dat')).toBe('pinhole barhole barhole barhole barhole');
    // a conveyor belt: its frame's clips hold its drum's and its axles' ends; the drum's shaft between them and the crank's handle
    // are left. A cannon on its base: the base's short clips hold its barrel's pivots, too little of which is left, and its two
    // upright clips are free. A motorcycle with its forks' stem in its body's clip, and one without its forks
    expect(freeOf('630.dat')).toBe('bar bar');
    expect(freeOf('2527c01.dat')).toBe('bar clip clip');
    expect(freeClips('30187c01.dat')).toEqual([]);
    expect(freeClips('30187c04.dat')).toHaveLength(1);
    // a samurai's helmet with its horn in its clip, a dragon helmet with a cattle horn in its: taken, and the horns' bars with
    // them
    expect(freeOf('30175c01.dat')).toBe('');
    expect(freeOf('6122c02.dat')).toBe('');
    // clips its own parts fill: a scooter's and a motorcycle's riders' hands, on their handlebars a little off their line or at a
    // slant, where the kinds of their connections don't pair them, and a Friends template figure's left hand round a screwdriver's
    // handle, which LDraw does not draw as a bar, its right hand free; and the grips the riders' hands hold are taken with them,
    // where a scooter without its rider has both free
    expect(freeClips('15396c02.dat')).toEqual([]);
    expect(freeClips('30187c03.dat')).toEqual([]);
    expect(freeClips('92198c01.dat').map((c) => Math.sign(c.at[0]))).toEqual([-1]);
    expect(freeOf('15396c02.dat')).toBe('barhole barhole barhole barhole');
    expect(freeOf('15396c01.dat')).toBe('bar bar barhole barhole barhole');
    // and no clip left free on the droids and the martian, two hands' on each, has a rod in it
    const hands = ['30375cs0.dat', '30375cs1.dat', '30375cs2.dat', '30375cs3.dat', '30529c01.dat'].flatMap((file) => freeClips(file).map((clip) => `${file} ${clip.at}: ${drawnAt(file, clip, 0)}`));
    expect(hands).toHaveLength(10);
    for (const hand of hands) expect(hand).toEndWith(': clip');
  });

  it('measures a clip and a bar on the mesh closely enough to tell one a little out of place, a ring, a hole and a clip with a rod in it', () => {
    const joint = (kind: FlatConnector['kind'], at: readonly [number, number, number], axis: readonly [number, number, number], length: number): FlatConnector => ({ kind, at, axis, length, outward: 0, across: 1 });
    // a 1 × 1 tile's clip, along Z over the tile, and a bar 3 studs long, along Y
    const [clip] = freeClips('2555.dat');
    const [bar] = joinsOf('87994.dat');
    if (!clip || !bar) throw new Error('no clip or no bar');
    expect([clip.at, clip.axis.map(Math.abs), clip.length]).toEqual([[0, -6, 0], [0, 0, 1], 8]);
    expect(drawnAlong('2555.dat', clip)).toBe(AS_CLIP);
    expect(drawnAlong('87994.dat', bar)).toBe(AS_ROD);
    // half an LDU along its line, a fifth of one off it either way, an LDU longer or shorter: no clip from end to end, and no rod
    const [x, y, z] = clip.at;
    for (const wrong of [joint('clip', [x, y, z + 0.5], clip.axis, 8), joint('clip', [x + 0.2, y, z], clip.axis, 8), joint('clip', [x, y - 0.2, z], clip.axis, 8), joint('clip', clip.at, clip.axis, 9), joint('clip', clip.at, clip.axis, 7)]) {
      expect(`${wrong.at} ${wrong.length}: ${drawnAlong('2555.dat', wrong) === AS_CLIP}`).toBe(`${wrong.at} ${wrong.length}: false`);
    }
    for (const wrong of [joint('bar', [bar.at[0], bar.at[1] + 0.5, bar.at[2]], bar.axis, bar.length), joint('bar', [bar.at[0] + 0.2, bar.at[1], bar.at[2]], bar.axis, bar.length), joint('bar', bar.at, bar.axis, bar.length + 1)]) {
      expect(`${wrong.at} ${wrong.length}: ${drawnAlong('87994.dat', wrong) === AS_ROD}`).toBe(`${wrong.at} ${wrong.length}: false`);
    }
    // a bar read from a line a little beside its own is half a rod, not one; a fence's shallow scallop is too little of a turn for a clip
    expect(drawnAt('87994.dat', joint('bar', [bar.at[0] + 0.15, bar.at[1], bar.at[2]], bar.axis, bar.length), 0)).toBe('in 0.00 out 0.49');
    expect(drawnAt('2040.dat', joint('clip', [0, 1.3, 0], [0, 0, 1], 8), 0)).toBe('in 0.37 out 0.00');
    // the slit ring at the end of a fishing rod goes nearly all the way round; the hole of an open stud all the way
    expect(drawnAt('93222.dat', joint('clip', [-3.5, -24, -16], [1, 0, 0], 9), 0)).toBe('in 0.87 out 0.00');
    expect(drawnAt('3062b.dat', joint('barhole', [0, -2, 0], [0, -1, 0], 4), 0)).toBe('in 1.00 out 0.00');
    // a scooter's clip has the rod of its own handlebars in it, and its rider's hand has a handlebar part of the way in
    expect(drawnAt('15396c01.dat', joint('clip', [0, -14, -30], [1, 0, 0], 7.2), 0)).toBe('in 0.62 out 0.99');
    const hand = joinsOf('15396c02.dat').find((j) => j.kind === 'clip' && Math.abs(j.at[0] - 21.86) < 0.1);
    if (!hand) throw new Error('no hand');
    expect(drawnAt('15396c02.dat', hand, 0)).toBe('in 0.65 out 0.16');
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
