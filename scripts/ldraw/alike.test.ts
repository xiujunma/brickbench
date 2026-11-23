import { describe, expect, it } from 'bun:test';
import { CONNECTOR_KINDS, type ConnectorEntry } from '../../src/core/ldraw/format.ts';
import { alikeConnectors, type ColouredTriangle } from './alike.ts';
import type { V3 } from './parse.ts';

const PIN = CONNECTOR_KINDS.indexOf('pin');
const PINHOLE = CONNECTOR_KINDS.indexOf('pinhole');
const AXLE = CONNECTOR_KINDS.indexOf('axle');
const MAIN = 16;

/** The twelve triangles of a box from `min` to `max`, in one colour. */
function box(min: V3, max: V3, color = MAIN): ColouredTriangle[] {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const corner = (i: number): V3 => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const faces = [
    [0, 1, 3, 2],
    [4, 6, 7, 5],
    [0, 4, 5, 1],
    [2, 3, 7, 6],
    [0, 2, 6, 4],
    [1, 5, 7, 3],
  ] as const;
  return faces.flatMap(([a, b, c, d]) => [
    { a: corner(a), b: corner(b), c: corner(c), color },
    { a: corner(a), b: corner(c), c: corner(d), color },
  ]);
}

/** A part's extent from its triangles. */
function extentOf(triangles: readonly ColouredTriangle[]): readonly [number, number, number, number, number, number] {
  const points = triangles.flatMap((t) => [t.a, t.b, t.c]);
  const lo = (k: number): number => Math.min(...points.map((p) => p[k] ?? 0));
  const hi = (k: number): number => Math.max(...points.map((p) => p[k] ?? 0));
  return [lo(0), lo(1), lo(2), hi(0), hi(1), hi(2)];
}

/** A Technic pin's two ends, each a stud long, pointing out from its collar 0.4 studs up. */
const PIN_ENDS: readonly ConnectorEntry[] = [
  [PIN, -0.5, 0.4, 0, -1, 0, 0, 1],
  [PIN, 0.5, 0.4, 0, 1, 0, 0, 1],
];
const PIN_SHAPE = box([-1, 0, -0.4], [1, 0.8, 0.4]);

describe('which of a part’s connections are alike', () => {
  it('finds a pin’s two ends alike, its shape the same either way round', () => {
    expect(alikeConnectors(PIN_SHAPE, PIN_ENDS, extentOf(PIN_SHAPE))).toEqual([0, 0]);
  });

  it('finds none alike where the shape tells the two ends apart: in its form, or in a colour on one end only', () => {
    // a shock absorber's ends: the same box and holes both ways round, a cylinder at one end only
    const cylinder = [...PIN_SHAPE, ...box([0.6, 0.1, -0.3], [0.9, 0.7, 0.3])];
    expect(alikeConnectors(cylinder, PIN_ENDS, extentOf(cylinder))).toBeNull();
    // a print on one end
    const printed = [...PIN_SHAPE, ...box([0.6, 0.79, -0.2], [0.9, 0.8, 0.2], 4)];
    expect(alikeConnectors(printed, PIN_ENDS, extentOf(printed))).toBeNull();
    // the same print on both, as a quarter turn finds them
    const both = [...printed, ...box([-0.9, 0.79, -0.2], [-0.6, 0.8, 0.2], 4)];
    expect(alikeConnectors(both, PIN_ENDS, extentOf(both))).toEqual([0, 0]);
    // the mark on the other end a tenth of an LDraw unit nearer the middle: near, but not the same
    const askew = [...printed, ...box([-0.895, 0.79, -0.2], [-0.595, 0.8, 0.2], 4)];
    expect(alikeConnectors(askew, PIN_ENDS, extentOf(askew))).toBeNull();
    // the same mark on both ends, but red on one and blue on the other: alike in form, not in colour
    const twoColours = [...printed, ...box([-0.9, 0.79, -0.2], [-0.6, 0.8, 0.2], 1)];
    expect(alikeConnectors(twoColours, PIN_ENDS, extentOf(twoColours))).toBeNull();
  });

  it('finds none alike where the connections themselves differ', () => {
    // a long pin's ends: two studs one way, one the other
    expect(alikeConnectors(PIN_SHAPE, [PIN_ENDS[0] as ConnectorEntry, [PIN, 0.5, 0.4, 0, 1, 0, 0, 2]], extentOf(PIN_SHAPE))).toBeNull();
    // a pin and an axle
    expect(alikeConnectors(PIN_SHAPE, [PIN_ENDS[0] as ConnectorEntry, [AXLE, 0.5, 0.4, 0, 1, 0, 0, 1]], extentOf(PIN_SHAPE))).toBeNull();
    // one end pointing in
    expect(alikeConnectors(PIN_SHAPE, [PIN_ENDS[0] as ConnectorEntry, [PIN, 0.5, 0.4, 0, -1, 0, 0, 1]], extentOf(PIN_SHAPE))).toBeNull();
    // an end an LDraw unit out of place, or an LDraw unit longer
    expect(alikeConnectors(PIN_SHAPE, [PIN_ENDS[0] as ConnectorEntry, [PIN, 0.55, 0.4, 0, 1, 0, 0, 1]], extentOf(PIN_SHAPE))).toBeNull();
    expect(alikeConnectors(PIN_SHAPE, [PIN_ENDS[0] as ConnectorEntry, [PIN, 0.5, 0.4, 0, 1, 0, 0, 1.05]], extentOf(PIN_SHAPE))).toBeNull();
    // and with one connection there is nothing to be alike with
    expect(alikeConnectors(PIN_SHAPE, [PIN_ENDS[0] as ConnectorEntry], extentOf(PIN_SHAPE))).toBeNull();
  });

  it('finds the holes at a beam’s two ends alike, its middle hole like no other', () => {
    const beam = box([-0.5, 0, -1.5], [0.5, 1, 1.5]);
    const holes: ConnectorEntry[] = [-1, 0, 1].map((z): ConnectorEntry => [PINHOLE, 0, 0.5, z, 0, -1, 0, 1]);
    expect(alikeConnectors(beam, holes, extentOf(beam))).toEqual([0, 1, 0]);
    // a hole goes right through: drawn the other way round, as LDraw draws one end of a beam 7, it is the hole it was
    const turned: ConnectorEntry[] = [[PINHOLE, 0, 0.5, -1, 0, -1, 0, 1], [PINHOLE, 0, 0.5, 0, 0, -1, 0, 1], [PINHOLE, 0, 0.5, 1, 0, 1, 0, 1]];
    expect(alikeConnectors(beam, turned, extentOf(beam))).toEqual([0, 1, 0]);
  });

  it('finds all alike that quarter turns take onto one another, through more than one turn', () => {
    // a cross with a pin out of each side, the same every quarter turn about its middle
    const cross = [...box([-1.5, 0, -0.5], [1.5, 1, 0.5]), ...box([-0.5, 0, -1.5], [0.5, 1, 1.5])];
    const pins: ConnectorEntry[] = [
      [PIN, 2, 0.5, 0, 1, 0, 0, 1],
      [PIN, 0, 0.5, 2, 0, 0, 1, 1],
      [PIN, -2, 0.5, 0, -1, 0, 0, 1],
      [PIN, 0, 0.5, -2, 0, 0, -1, 1],
    ];
    const extent = [-2.5, 0, -2.5, 2.5, 1, 2.5] as const;
    expect(alikeConnectors(cross, pins, extent)).toEqual([0, 0, 0, 0]);
    // in a box longer one way than the other, its middle off theirs: only the half turn about its length still takes the shape
    // onto itself, so the pins across it are alike, and those along it, now unalike in where they sit, are not
    expect(alikeConnectors(cross, pins, [-2.5, 0, -2.5, 3, 1, 2.5])).toEqual([0, 1, 2, 1]);
  });

  it('matches corners that lie on the lines between the cells they are filed in', () => {
    // a plain body with a pin out of each end, its frame off whole studs by 1.05 and 0.425, as the converter may place it: turned,
    // some of its corners land a hair across a line from their own
    const [ox, oz] = [1.05, 0.425];
    const body = box([-1 + ox, 0, -0.5 + oz], [1 + ox, 0.8, 0.5 + oz]);
    const pins: ConnectorEntry[] = [
      [PIN, -0.5 + ox, 0.4, oz, -1, 0, 0, 1],
      [PIN, 0.5 + ox, 0.4, oz, 1, 0, 0, 1],
    ];
    expect(alikeConnectors(body, pins, extentOf(body))).toEqual([0, 0]);
  });

  it('takes a hole’s or a clip’s axis either way round, and a pin’s, an axle’s or a bar’s only the way it points', () => {
    // one at each end, LDraw drawing both axes the same way: turned half round, each lands on the other pointing back
    const ends = (kind: number): ConnectorEntry[] => [
      [kind, -0.5, 0.4, 0, 1, 0, 0, 1],
      [kind, 0.5, 0.4, 0, 1, 0, 0, 1],
    ];
    for (const kind of ['clip', 'pinhole', 'axlehole'] as const) expect(alikeConnectors(PIN_SHAPE, ends(CONNECTOR_KINDS.indexOf(kind)), extentOf(PIN_SHAPE))).toEqual([0, 0]);
    // a pin goes in tip first; parts slide along an axle or a bar in half studs from one end
    for (const kind of ['pin', 'axle', 'bar'] as const) expect(alikeConnectors(PIN_SHAPE, ends(CONNECTOR_KINDS.indexOf(kind)), extentOf(PIN_SHAPE))).toBeNull();
  });

  it('matches points a hair apart, as LDraw draws a part’s two halves', () => {
    const halves = [...box([-1, 0, -0.4], [0, 0.8, 0.4]), ...box([0, 0, -0.4], [1.0000000001, 0.8, 0.4])];
    expect(alikeConnectors(halves, PIN_ENDS, extentOf(halves))).toEqual([0, 0]);
  });
});
