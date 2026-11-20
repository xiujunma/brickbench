import { describe, expect, it } from 'bun:test';
import { barPiece, connectorPrimitive, finishConnectors, type FlatConnector } from './connectors.ts';
import { flattenPart } from './flatten.ts';
import { memorySource } from './library.ts';

/** A square tube of half-width 6 around Y, from y0 to y1, its faces turned out (or in, for a hole). */
function tube(y0: number, y1: number, inwards = false): string {
  const r = 6;
  const faces = [
    [
      [r, y0, -r],
      [r, y1, -r],
      [r, y1, r],
      [r, y0, r],
    ],
    [
      [-r, y0, r],
      [-r, y1, r],
      [-r, y1, -r],
      [-r, y0, -r],
    ],
    [
      [r, y0, r],
      [r, y1, r],
      [-r, y1, r],
      [-r, y0, r],
    ],
    [
      [-r, y0, -r],
      [-r, y1, -r],
      [r, y1, -r],
      [r, y0, -r],
    ],
  ];
  return faces.map((face) => `4 16 ${(inwards ? [...face].reverse() : face).flat().join(' ')}`).join('\n');
}

const certified = (body: string): string => `0 Test\n0 BFC CERTIFY CCW\n${body}\n`;

const PRIMITIVES = {
  'connect.dat': certified(tube(-20, 0)),
  'peghole.dat': certified(tube(0, 2, true)),
  'axlehol8.dat': certified(tube(0, 1)),
  'clh4.dat': certified('3 16 3 -6 0 8.5 -6 0 8.5 6 10'),
};

function connectorsOf(body: string): FlatConnector[] {
  const source = memorySource({ ...PRIMITIVES, 'part.dat': certified(body) });
  return finishConnectors(flattenPart('part.dat', source).connectors);
}

const round = (c: FlatConnector) => ({
  kind: c.kind,
  at: c.at.map((v) => Math.round(v * 100) / 100 + 0),
  axis: c.axis.map((v) => Math.round(v * 1000) / 1000 + 0),
  length: Math.round(c.length * 100) / 100,
});

describe('connections read from LDraw primitives', () => {
  it('know the primitives that draw them, and leave out the faces around holes and the pieces of pins', () => {
    expect(connectorPrimitive('p/connect.dat')?.kind).toBe('pin');
    expect(connectorPrimitive('confric5.dat')?.kind).toBe('pin');
    expect(connectorPrimitive('beamhole.dat')?.kind).toBe('pinhole');
    expect(connectorPrimitive('axle.dat')?.kind).toBe('axle');
    expect(connectorPrimitive('axl3hole.dat')?.kind).toBe('axlehole');
    expect(connectorPrimitive('clh2.dat')?.kind).toBe('finger');
    expect(connectorPrimitive('clh10.dat')?.kind).toBe('fork');
    for (const name of ['npeghole.dat', 'confricrib1.dat', 'connectcollar1.dat', 'axlehol0.dat', 'clh-finger.dat', 'stud.dat', '3001.dat']) {
      expect(connectorPrimitive(name)).toBeUndefined();
    }
  });

  it('join the peg-hole ends on a brick’s two faces into one hole through it', () => {
    // one end at y -10..-8, the other turned over at 8..10
    const holes = connectorsOf(['1 16 0 -10 0 1 0 0 0 1 0 0 0 1 peghole.dat', '1 16 0 10 0 1 0 0 0 -1 0 0 0 -1 peghole.dat'].join('\n'));
    expect(holes.map(round)).toEqual([{ kind: 'pinhole', at: [0, 0, 0], axis: [0, 1, 0], length: 20 }]);
  });

  it('keep a pin’s two ends apart, each pointing from its collar to its tip', () => {
    const pins = connectorsOf(['1 16 0 0 0 1 0 0 0 1 0 0 0 1 connect.dat', '1 16 0 0 0 1 0 0 0 -1 0 0 0 -1 connect.dat'].join('\n'));
    expect(pins.map(round)).toEqual([
      { kind: 'pin', at: [0, -10, 0], axis: [0, -1, 0], length: 20 },
      { kind: 'pin', at: [0, 10, 0], axis: [0, 1, 0], length: 20 },
    ]);
  });

  it('tell an axle from an axle hole drawn alike by the way their surfaces face, mirrored or not', () => {
    const stretched = '1 16 0 0 0 1 0 0 0 40 0 0 0 1 axlehol8.dat';
    expect(connectorsOf(stretched).map(round)).toEqual([{ kind: 'axle', at: [0, 20, 0], axis: [0, 1, 0], length: 40 }]);
    expect(connectorsOf(`0 BFC INVERTNEXT\n${stretched}`).map((c) => c.kind)).toEqual(['axlehole']);
    expect(connectorsOf('1 16 0 0 0 -1 0 0 0 40 0 0 0 1 axlehol8.dat').map((c) => c.kind)).toEqual(['axle']);
  });

  it('take a pin hole along an axle hole as its mouth', () => {
    const connectors = connectorsOf(['0 BFC INVERTNEXT', '1 16 0 0 0 1 0 0 0 20 0 0 0 1 axlehol8.dat', '1 16 0 0 0 1 0 0 0 1 0 0 0 1 peghole.dat'].join('\n'));
    expect(connectors.map((c) => c.kind)).toEqual(['axlehole']);
  });

  it('pair the two halves of a click hinge’s fork about its pivot', () => {
    const forks = connectorsOf(['1 16 0 0 0 1 0 0 0 1 0 0 0 1 clh4.dat', '1 16 0 0 0 -1 0 0 0 1 0 0 0 1 clh4.dat'].join('\n'));
    // the pivot runs along X through y 0, z 4, as the hinge's round surfaces do
    expect(forks.map(round)).toEqual([{ kind: 'fork', at: [0, 0, 4], axis: [1, 0, 0], length: 17 }]);
  });

  it('keep holes on different lines apart, and in a steady order', () => {
    const holes = connectorsOf(['1 16 20 -10 0 1 0 0 0 1 0 0 0 1 peghole.dat', '1 16 -20 -10 0 1 0 0 0 1 0 0 0 1 peghole.dat'].join('\n'));
    expect(holes.map((c) => c.at[0])).toEqual([-20, 20]);
  });
});

describe('minifigure joints', () => {
  const body = certified('3 16 -20 0 0 20 0 0 0 32 10');

  it('come with the files every variant of a part is drawn from, turned and mirrored with them', () => {
    const source = memorySource({
      's/973s01.dat': body,
      's/3818s01.dat': body,
      'torso.dat': certified('1 16 0 0 0 1 0 0 0 1 0 0 0 1 s\\973s01.dat'),
      // the left arm is the right one mirrored
      'leftarm.dat': certified('1 16 0 0 0 -1 0 0 0 1 0 0 0 1 s\\3818s01.dat'),
    });
    const torso = finishConnectors(flattenPart('torso.dat', source).connectors);
    expect(torso.map((c) => c.kind)).toEqual(['neck', 'waist', 'waist', 'shoulder', 'shoulder']);
    const arm = finishConnectors(flattenPart('leftarm.dat', source).connectors);
    expect(arm.map((c) => [c.kind, Math.round(c.at[0] * 1000) / 1000 + 0, Math.round(c.axis[0] * 1000) / 1000 + 0])).toEqual([
      ['arm', 0, -1],
      ['wrist', 4.994, 0],
    ]);
  });

  it('are kept once when a part is drawn with two files that set the same joint', () => {
    const source = memorySource({ 's/3626bs02.dat': body, 's/3626cs02.dat': body, 'head.dat': certified('1 16 0 0 0 1 0 0 0 1 0 0 0 1 s\\3626bs02.dat\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 s\\3626cs02.dat') });
    expect(finishConnectors(flattenPart('head.dat', source).connectors).map((c) => c.kind)).toEqual(['head']);
  });
});

describe('bars and clips', () => {
  const cylinder = certified(tube(0, 1));
  const IDENTITY = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const, t: [0, 0, 0] as const };

  it('find a bar in a whole cylinder of a bar’s radius, outside in, long enough to hold', () => {
    const bar = { m: [4, 0, 0, 0, 40, 0, 0, 0, 4] as const, t: [0, -40, 0] as const };
    expect(barPiece('4-4cyli.dat', bar, false)).toEqual({ kind: 'bar', at: [0, -20, 0], axis: [0, 1, 0], length: 40, outward: 0 });
    expect(barPiece('48\\4-4cylo.dat', bar, false)?.kind).toBe('bar');
    // inside out it is a hole; a stud is fatter; a stub is too short to hold; a half cylinder is no bar
    expect(barPiece('4-4cyli.dat', bar, true)).toBeNull();
    expect(barPiece('4-4cyli.dat', { ...bar, m: [6, 0, 0, 0, 40, 0, 0, 0, 6] }, false)).toBeNull();
    expect(barPiece('4-4cyli.dat', { ...bar, m: [4, 0, 0, 0, 4, 0, 0, 0, 4] }, false)).toBeNull();
    expect(barPiece('2-4cyli.dat', bar, false)).toBeNull();
    expect(barPiece('4-4cyli.dat', IDENTITY, false)).toBeNull();
  });

  it('join a bar drawn in pieces, and leave out the cylinders studs and clips are drawn with', () => {
    const source = memorySource({
      '4-4cyli.dat': cylinder,
      // a stud primitive with a bar-sized cylinder inside it
      'stud3.dat': certified('1 16 0 0 0 4 0 0 0 -4 0 0 0 4 4-4cyli.dat\n1 16 0 -4 0 4 0 0 0 -8 0 0 0 4 4-4cyli.dat'),
      // a clip, drawn round a bar-sized cylinder from x -4 to -8, 2 under its origin
      'clip6.dat': certified('1 16 -4 2 0 0 -4 0 8 0 0 0 0 4 4-4cyli.dat'),
      'part.dat': certified(
        [
          '1 16 0 0 0 4 0 0 0 -20 0 0 0 4 4-4cyli.dat',
          '1 16 0 -20 0 4 0 0 0 -20 0 0 0 4 4-4cyli.dat',
          '1 16 40 0 0 1 0 0 0 1 0 0 0 1 stud3.dat',
          '1 16 0 0 40 1 0 0 0 1 0 0 0 1 clip6.dat',
        ].join('\n'),
      ),
    });
    const found = finishConnectors(flattenPart('part.dat', source).connectors).map(round);
    expect(found).toEqual([
      { kind: 'bar', at: [0, -20, 0], axis: [0, -1, 0], length: 40 },
      { kind: 'clip', at: [-6, 2, 40], axis: [1, 0, 0], length: 4 },
    ]);
  });

  it('know the clips that hold bars, and the road-sign clip that holds a plate', () => {
    expect(connectorPrimitive('clip1.dat')?.kind).toBe('clip');
    expect(connectorPrimitive('phandle1.dat')?.kind).toBe('bar');
    expect(connectorPrimitive('clip4.dat')).toBeUndefined();
    // an open stud holds a bar, whichever part it is shaped for and with its logo or without; a solid one, or one with small holes, does not
    for (const name of ['stud2.dat', 'stud2a.dat', 'stud6.dat', 'stud6a.dat', 'stud17a.dat', '8/stud2-logo4.dat']) expect(connectorPrimitive(name)?.kind).toBe('barhole');
    for (const name of ['stud.dat', 'stud9.dat', 'stud2s.dat', 'studp01.dat', 'stud3.dat']) expect(connectorPrimitive(name)).toBeUndefined();
  });
});
