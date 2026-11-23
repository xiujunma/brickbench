import { describe, expect, it } from 'bun:test';
import { bareBars, partConnections } from './bare.ts';
import type { FlatConnector } from './connectors.ts';
import type { FlatTriangle } from './flatten.ts';
import type { V3 } from './parse.ts';

interface Round {
  /** From where to where along Y it is drawn. */
  readonly y0: number;
  readonly y1: number;
  readonly radius?: number;
  /** Facing in towards its line, as the inside of a clip or a hole does; out from it, as a rod does, when not. */
  readonly inwards?: boolean;
  /** How much of a turn round it goes, from +X. */
  readonly turn?: number;
  /** Where its line is, across Y. */
  readonly x?: number;
  readonly z?: number;
  /** Drawn without a facing (BFC not certified): seen from both sides. */
  readonly doubleSided?: boolean;
}

const SIDES = 16;

/** A round surface about a line along Y, in flat sides with their corners on the circle, as LDraw's cylinder primitives are. */
function round({ y0, y1, radius = 4, inwards = false, turn = 1, x = 0, z = 0, doubleSided = false }: Round): FlatTriangle[] {
  const steps = Math.round(SIDES * turn);
  const corner = (k: number, y: number): V3 => {
    const angle = (2 * Math.PI * k) / SIDES;
    return [x + radius * Math.cos(angle), y, z + radius * Math.sin(angle)];
  };
  return Array.from({ length: steps }, (_, k) => {
    const [p0, p1, p2, p3] = [corner(k, y0), corner(k + 1, y0), corner(k + 1, y1), corner(k, y1)];
    const quad: [V3, V3, V3][] = inwards ? [[p0, p1, p2], [p0, p2, p3]] : [[p0, p3, p2], [p0, p2, p1]];
    return quad.map(([a, b, c]) => ({ a, b, c, color: 16, doubleSided, stud: false }));
  }).flat();
}

/** A point turned half round the Y axis. */
const flip = ([x, y, z]: V3): V3 => [-x, y, -z];

/** A point of a round surface about Y moved out to `radius` where it is at height `y`: one way of drawing a cone. */
const widen = ([x, y, z]: V3, radius: number, at: number): V3 => {
  if (y !== at) return [x, y, z];
  const size = Math.hypot(x, z);
  return [(x / size) * radius, y, (z / size) * radius];
};

/** A bar along Y from y0 to y1, as the part's connections give it. */
const bar = (y0: number, y1: number, x = 0): FlatConnector => ({ kind: 'bar', at: [x, (y0 + y1) / 2, 0], axis: [0, 1, 0], length: y1 - y0, outward: 0, across: 1 });

/** Each bar as where it starts and ends along Y. */
const stretches = (connectors: readonly FlatConnector[]): string[] =>
  connectors.map((c) => (c.kind === 'bar' ? `${Math.round((c.at[1] - c.length / 2) * 100) / 100 + 0}..${Math.round((c.at[1] + c.length / 2) * 100) / 100 + 0}` : c.kind));

describe('where a bar is bare', () => {
  it('keeps a bar drawn all the way round with nothing about it whole', () => {
    expect(bareBars([bar(0, 40)], round({ y0: 0, y1: 40 }))).toEqual([bar(0, 40)]);
  });

  it('cuts a bar where a clip or a hole wraps round it, at the clip’s ends', () => {
    const rod = round({ y0: 0, y1: 40 });
    // a clip's inside, five eighths of a turn, round its middle: a bar either side of it
    expect(stretches(bareBars([bar(0, 40)], [...rod, ...round({ y0: 16, y1: 24, inwards: true, turn: 5 / 8 })]))).toEqual(['0..16', '24..40']);
    // a hole all the way round one end of it
    expect(stretches(bareBars([bar(0, 40)], [...rod, ...round({ y0: 0, y1: 10, inwards: true })]))).toEqual(['10..40']);
    // a little of a turn is enough: nothing else goes round it there
    expect(stretches(bareBars([bar(0, 40)], [...rod, ...round({ y0: 30, y1: 40, inwards: true, turn: 2 / 16 })]))).toEqual(['0..30']);
    // and so is a collar round it thinner than a gap in its drawing it would be whole across
    expect(stretches(bareBars([bar(0, 40)], [...rod, ...round({ y0: 20, y1: 20.5, inwards: true })]))).toEqual(['0..20', '20.5..40']);
  });

  it('leaves out what is left too short to hold a clip, and bars wrapped from end to end', () => {
    const rod = round({ y0: 0, y1: 40 });
    expect(stretches(bareBars([bar(0, 40)], [...rod, ...round({ y0: 4, y1: 12, inwards: true })]))).toEqual(['12..40']);
    expect(stretches(bareBars([bar(0, 40)], [...rod, ...round({ y0: 0, y1: 40, inwards: true, turn: 0.75 })]))).toEqual([]);
    // eight long is just long enough
    expect(stretches(bareBars([bar(0, 40)], [...rod, ...round({ y0: 8, y1: 40, inwards: true })]))).toEqual(['0..8']);
  });

  it('allows for matrices LDraw writes to a few decimals, which turn a bar a hair shorter or its drawing a hair off its ends', () => {
    // a bar eight long, turned by such a matrix: 7.9999 long, and drawn to its ends
    const short = bar(0, 7.9999);
    expect(bareBars([short], round({ y0: 0, y1: 7.9999 }))).toEqual([short]);
    // its drawing stopping a twentieth of an LDU short of either end still reaches them
    expect(bareBars([bar(0, 40)], round({ y0: 0.05, y1: 39.95 }))).toEqual([bar(0, 40)]);
    // a stretch left a hair under eight long is kept; one a fifth of an LDU under is not
    expect(stretches(bareBars([bar(0, 40)], [...round({ y0: 0, y1: 40 }), ...round({ y0: 7.95, y1: 40, inwards: true })]))).toEqual(['0..7.95']);
    expect(stretches(bareBars([bar(0, 40)], [...round({ y0: 0, y1: 40 }), ...round({ y0: 7.8, y1: 40, inwards: true })]))).toEqual([]);
  });

  it('keeps only where its own surface is drawn, across gaps in it of no more than an LDU', () => {
    // drawn no further than 30: the rest is inside its part, out of sight
    expect(stretches(bareBars([bar(0, 40)], round({ y0: 0, y1: 30 })))).toEqual(['0..30']);
    expect(stretches(bareBars([bar(0, 40)], [...round({ y0: 0, y1: 20 }), ...round({ y0: 21, y1: 40 })]))).toEqual(['0..40']);
    expect(stretches(bareBars([bar(0, 40)], [...round({ y0: 0, y1: 20 }), ...round({ y0: 22, y1: 40 })]))).toEqual(['0..20', '22..40']);
    expect(bareBars([bar(0, 40)], [])).toEqual([]);
    // a triangle with its corners on one line, as LDraw files sometimes have, is no surface
    const sliver: FlatTriangle = { a: [4, 0, 0], b: [4, 20, 0], c: [4, 40, 0], color: 16, doubleSided: false, stud: false };
    expect(bareBars([bar(0, 40)], [sliver])).toEqual([]);
  });

  it('cuts a bar where its part closes round it a little further out: a bore it runs in, a solid it runs through, a ring on it', () => {
    const rod = round({ y0: 0, y1: 40 });
    // a piston rod in the bore of its cylinder, 8 from its line; a lead buried in a plug's solid body; a stop ring
    expect(stretches(bareBars([bar(0, 40)], [...rod, ...round({ y0: 0, y1: 25, inwards: true, radius: 8 })]))).toEqual(['25..40']);
    expect(stretches(bareBars([bar(0, 40)], [...rod, ...round({ y0: 20, y1: 40, radius: 6.7 })]))).toEqual(['0..20']);
    expect(stretches(bareBars([bar(0, 40)], [...rod, ...round({ y0: 18, y1: 20, radius: 5.5 })]))).toEqual(['0..18', '20..40']);
    // three quarters of the way round closes it; half way leaves room for a clip, as does a bore wider than a hand
    expect(stretches(bareBars([bar(0, 40)], [...rod, ...round({ y0: 0, y1: 25, inwards: true, radius: 6, turn: 0.75 })]))).toEqual(['25..40']);
    expect(stretches(bareBars([bar(0, 40)], [...rod, ...round({ y0: 0, y1: 25, inwards: true, radius: 6, turn: 0.5 })]))).toEqual(['0..40']);
    expect(stretches(bareBars([bar(0, 40)], [...rod, ...round({ y0: 0, y1: 25, inwards: true, radius: 9 })]))).toEqual(['0..40']);
    // only a round surface about its line closes it, every corner the same way out: not one sloping from 5 out to 8, as a
    // cone's, nor flat faces near it, which would close it or not by how they are cut into triangles
    const cone = round({ y0: 0, y1: 25, inwards: true, radius: 5 }).map((t) => ({ ...t, a: widen(t.a, 8, 0), b: widen(t.b, 8, 0), c: widen(t.c, 8, 0) }));
    expect(stretches(bareBars([bar(0, 40)], [...rod, ...cone]))).toEqual(['0..40']);
    // pieces of one round surface each go part of the way: together they close it
    const halves = [...round({ y0: 0, y1: 25, inwards: true, radius: 8, turn: 0.5 }), ...round({ y0: 0, y1: 25, inwards: true, radius: 8, turn: 0.5 }).map((t) => ({ ...t, a: flip(t.a), b: flip(t.b), c: flip(t.c) }))];
    expect(stretches(bareBars([bar(0, 40)], [...rod, ...halves]))).toEqual(['25..40']);
  });

  it('heeds only surfaces a bar’s radius from its own line that face round it', () => {
    const rod = round({ y0: 0, y1: 40 });
    // a hole wider than a hand round it, the inside of a clip beside it, and half a clip a fifth of an LDU too wide do not touch it
    const near = [...round({ y0: 10, y1: 20, inwards: true, radius: 9 }), ...round({ y0: 10, y1: 20, inwards: true, x: 10 }), ...round({ y0: 10, y1: 20, inwards: true, radius: 4.2, turn: 0.5 })];
    expect(stretches(bareBars([bar(0, 40)], [...rod, ...near]))).toEqual(['0..40']);
    // a ring across its line, the end of a wider part it runs into, faces along it, not round it
    const ring: FlatTriangle = { a: [4, 20, 0], b: [0, 20, 4.05], c: [-4, 20, 0], color: 16, doubleSided: false, stud: false };
    expect(stretches(bareBars([bar(0, 40)], [...rod, ring]))).toEqual(['0..40']);
    // as does the lip of a hole's mouth, sloping, a bar's radius from its line: more along it than in towards it
    const lip: FlatTriangle = { a: [4.1, 20, 0], b: [0, 20, 4.1], c: [2.758, 20.2, 2.758], color: 16, doubleSided: false, stud: false };
    expect(stretches(bareBars([bar(0, 40)], [...rod, lip]))).toEqual(['0..40']);
  });

  it('takes surfaces drawn to be seen from both sides as its own, never as wrapping it', () => {
    expect(stretches(bareBars([bar(0, 40)], round({ y0: 0, y1: 40, doubleSided: true })))).toEqual(['0..40']);
    expect(stretches(bareBars([bar(0, 40)], [...round({ y0: 0, y1: 40 }), ...round({ y0: 10, y1: 20, inwards: true, doubleSided: true })]))).toEqual(['0..40']);
  });

  it('cuts each bar on its own line, in its place among the part’s other connections, from where it starts', () => {
    const clip: FlatConnector = { kind: 'clip', at: [20, 20, 0], axis: [0, 1, 0], length: 8, outward: 0, across: 1 };
    const down: FlatConnector = { ...bar(0, 40, 40), axis: [0, -1, 0] };
    const drawn = [...round({ y0: 0, y1: 40 }), ...round({ y0: 16, y1: 24, inwards: true }), ...round({ y0: 0, y1: 40, x: 40 }), ...round({ y0: 0, y1: 10, inwards: true, x: 40 })];
    const kept = bareBars([bar(0, 40), clip, down], drawn);
    expect(stretches(kept)).toEqual(['0..16', '24..40', 'clip', '10..40']);
    // a bar keeps the way its axis points, and the first of its pieces is the one it starts with
    expect(kept.map((c) => c.axis[1])).toEqual([1, 1, 1, -1]);
    expect(kept[2]).toBe(clip);
  });

  it('gives a part’s connections as the build keeps them: those its own pieces leave free, bars where they are bare', () => {
    // a bar drawn in two pieces, and a hole: an assembly's clip wraps one end of the bar
    const pieces: FlatConnector[] = [bar(0, 20), bar(20, 40), { kind: 'pinhole', at: [40, 0, 0], axis: [0, 1, 0], length: 20, outward: 0, across: 1 }];
    const drawn = [...round({ y0: 0, y1: 40 }), ...round({ y0: 0, y1: 8, inwards: true, turn: 5 / 8 })];
    expect(stretches(partConnections({ connectors: pieces, triangles: drawn }))).toEqual(['pinhole', '8..40']);
  });

  it('measures a bar on a line that runs between the axes', () => {
    // the same bar and clip, turned an eighth of a turn about Z
    const [c, s] = [Math.cos(Math.PI / 4), Math.sin(Math.PI / 4)];
    const turn = ([x, y, z]: V3): V3 => [c * x - s * y, s * x + c * y, z];
    const drawn = [...round({ y0: 0, y1: 40 }), ...round({ y0: 16, y1: 24, inwards: true, turn: 5 / 8 })].map((t) => ({ ...t, a: turn(t.a), b: turn(t.b), c: turn(t.c) }));
    const tilted: FlatConnector = { ...bar(0, 40), at: turn([0, 20, 0]), axis: turn([0, 1, 0]) };
    const kept = bareBars([tilted], drawn);
    expect(kept.map((k) => Math.round(k.length * 100) / 100)).toEqual([16, 16]);
    expect(kept.map((k) => k.at.map((v) => Math.round(v * 100) / 100 + 0))).toEqual([turn([0, 8, 0]), turn([0, 32, 0])].map((p) => p.map((v) => Math.round(v * 100) / 100 + 0)));
  });
});
