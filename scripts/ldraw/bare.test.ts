import { describe, expect, it } from 'bun:test';
import { bareBars, emptyClips, partConnections } from './bare.ts';
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
function round({ y0, y1, radius = 4, inwards = false, turn = 1, x = 0, z = 0, doubleSided = false, sides = SIDES }: Round & { readonly sides?: number }): FlatTriangle[] {
  const steps = Math.round(sides * turn);
  const corner = (k: number, y: number): V3 => {
    const angle = (2 * Math.PI * k) / sides;
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

/** A point turned about the Y axis, from +X towards +Z, by the angle whose cosine and sine are given. */
const turn = ([x, y, z]: V3, c: number, s: number): V3 => [c * x - s * z, y, s * x + c * z];

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

describe('where a clip is empty', () => {
  /** A clip along Y from 0 to 8, and its inside: five eighths of a turn of a bar's radius, facing in. */
  const clip: FlatConnector = { kind: 'clip', at: [0, 4, 0], axis: [0, 1, 0], length: 8, outward: 0, across: 1 };
  const inside = round({ y0: 0, y1: 8, inwards: true, turn: 5 / 8 });
  const kept = (...drawn: FlatTriangle[][]) => emptyClips([clip], [...inside, ...drawn.flat()]).length;
  /** A flat face across Y at `x`, from y0 to y1, its front towards -X: towards the clip's line, when x is above 0. */
  const fin = (x: number, y0: number, y1: number): FlatTriangle[] => [
    { a: [x, y0, -6], b: [x, y0, 6], c: [x, y1, 6], color: 16, doubleSided: false, stud: false },
    { a: [x, y0, -6], b: [x, y1, 6], c: [x, y1, -6], color: 16, doubleSided: false, stud: false },
  ];

  it('keeps a clip with nothing in it, whatever is round it', () => {
    expect(emptyClips([clip], inside)).toEqual([clip]);
    // its outside, the part it is on beside it, and a hand round it a little wider
    expect(kept(round({ y0: 0, y1: 8, turn: 5 / 8, radius: 6 }), fin(-9, -10, 20), round({ y0: 0, y1: 8, inwards: true, radius: 7 }))).toBe(1);
    // its inside drawn with as few as eight flat sides to a turn, which come in to 3.7 from its line
    expect(emptyClips([clip], round({ y0: 0, y1: 8, inwards: true, turn: 5 / 8, sides: 8 }))).toEqual([clip]);
  });

  it('leaves out a clip its part fills: a rod through it, a handle in it, a rod off its line or part of the way in', () => {
    expect(kept(round({ y0: -10, y1: 18 }))).toBe(0);
    // a screwdriver's handle, thinner than a bar
    expect(kept(round({ y0: -10, y1: 18, radius: 3 }))).toBe(0);
    // a handlebar a rider's hand holds a little off its line
    expect(kept(round({ y0: -10, y1: 18, x: 0.6 }))).toBe(0);
    // a rod that goes no further into it than a quarter of its length
    expect(kept(round({ y0: -10, y1: 2 }))).toBe(0);
    // a rod drawn a tenth of an LDU wider than a bar
    expect(kept(round({ y0: -10, y1: 18, radius: 4.1 }))).toBe(0);
  });

  it('leaves out a clip something pokes into, but not for a stray few of the ways out of it', () => {
    // a fin 2 from its line meets a third of the ways out of it, nearer than 3.5; one 3.6 out, just inside its wall, none
    expect(kept(fin(2, -10, 20))).toBe(0);
    expect(kept(fin(3.6, -10, 20))).toBe(1);
    // a fin 2.5 out, turned to meet four of the sixteen ways out, a quarter of them, fills it
    const [c, s] = [Math.cos(Math.PI / 16), Math.sin(Math.PI / 16)];
    const turned = fin(2.5, -10, 20).map((t) => ({ ...t, a: turn(t.a, c, s), b: turn(t.b, c, s), c: turn(t.c, c, s) }));
    expect(kept(turned)).toBe(0);
    // a sliver 2.5 out, which only one or two of them meet, does not, nor does a fin 3 out, which three of them meet, fewer than a
    // quarter
    expect(kept(round({ y0: -10, y1: 20, radius: 0.5, x: 2.5 }))).toBe(1);
    expect(kept(fin(3, -10, 20))).toBe(1);
  });

  it('tells nothing from surfaces drawn to be seen from both sides, but where they come well inside it', () => {
    expect(kept(round({ y0: -10, y1: 18, doubleSided: true }))).toBe(1);
    expect(kept(round({ y0: -10, y1: 18, radius: 3, doubleSided: true }))).toBe(0);
  });

  it('cuts a bar its part holds in a clip it fills, a little off the clip’s line or at a slant, where the clip holds it', () => {
    // a handlebar, a bar from -10 to 18, that a rider's hand holds 0.7 off its line, and at a slant of 5 degrees
    const handlebar: FlatConnector = { ...bar(-10, 18), at: [0.7, 4, 0] };
    const off = round({ y0: -10, y1: 18, x: 0.7 });
    expect(stretches(partConnections({ connectors: [clip, handlebar], triangles: [...inside, ...off] }))).toEqual(['-10..0', '8..18']);
    const [c, s] = [Math.cos((5 * Math.PI) / 180), Math.sin((5 * Math.PI) / 180)];
    const tilt = ([x, y, z]: V3): V3 => [x, c * (y - 4) - s * z + 4, s * (y - 4) + c * z];
    const slanted: FlatConnector = { ...bar(-10, 18), axis: tilt([0, 5, 0]).map((v, k) => v - ([0, 4, 0][k] ?? 0)) as unknown as V3 };
    const drawn = round({ y0: -10, y1: 18 }).map((t) => ({ ...t, a: tilt(t.a), b: tilt(t.b), c: tilt(t.c) }));
    expect(partConnections({ connectors: [clip, slanted], triangles: [...inside, ...drawn] }).map((k) => `${k.kind} ${Math.round(k.length)}`)).toEqual(['bar 10', 'bar 10']);
    // what the clip leaves of it shorter than a clip goes: a handlebar from -2
    expect(stretches(partConnections({ connectors: [clip, { ...bar(-2, 18), at: [0.7, 8, 0] }], triangles: [...inside, ...round({ y0: -2, y1: 18, x: 0.7 })] }))).toEqual(['8..18']);
    // a bar that crosses the clip's line at one end only, at a slant, and one beside it, through none of it, are left as they are
    const crossing: FlatConnector = { ...bar(-15, 15), at: [0, 0, 0], axis: [0, Math.SQRT1_2, Math.SQRT1_2] };
    const slant = ([x, y, z]: V3): V3 => [x, Math.SQRT1_2 * (y - z), Math.SQRT1_2 * (y + z)];
    const crossingDrawn = round({ y0: -15, y1: 15 }).map((t) => ({ ...t, a: slant(t.a), b: slant(t.b), c: slant(t.c) }));
    expect(partConnections({ connectors: [clip, crossing], triangles: [...inside, ...round({ y0: -10, y1: 18, radius: 3 }), ...crossingDrawn] })).toEqual([crossing]);
    const beside = bar(-10, 18, 8);
    expect(stretches(partConnections({ connectors: [clip, beside], triangles: [...inside, ...round({ y0: -10, y1: 18, radius: 3 }), ...round({ y0: -10, y1: 18, x: 8 })] }))).toEqual(['-10..18']);
  });

  it('keeps every other connection, and leaves the part’s connections as the build keeps them', () => {
    const pin: FlatConnector = { ...clip, kind: 'pin' };
    expect(emptyClips([pin, clip], [...inside, ...round({ y0: -10, y1: 18 })])).toEqual([pin]);
    expect(partConnections({ connectors: [clip, bar(20, 40)], triangles: [...inside, ...round({ y0: -10, y1: 18, radius: 3 }), ...round({ y0: 20, y1: 40 })] }).map((c) => c.kind)).toEqual(['bar']);
  });
});
