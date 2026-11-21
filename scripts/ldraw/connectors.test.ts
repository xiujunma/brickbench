import { describe, expect, it } from 'bun:test';
import { allConnectors, barPiece, connectorPrimitive, finishConnectors, type FlatConnector } from './connectors.ts';
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
    // the older hinges' two fingers and the three they go between
    expect(connectorPrimitive('h1.dat')?.kind).toBe('fingers2');
    expect(connectorPrimitive('h2.dat')?.kind).toBe('fingers3');
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
    expect(barPiece('4-4cyli.dat', bar, false)).toEqual({ kind: 'bar', at: [0, -20, 0], axis: [0, 1, 0], length: 40, outward: 0, across: 1 });
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

describe('pieces drawn at another size', () => {
  it('leaves out a pin drawn thinner or fatter than a Technic pin, as a hinge plate’s small pivot is', () => {
    const pinAt = (across: number) => connectorsOf(`1 16 0 0 0 ${across} 0 0 0 1 0 0 0 ${across} connect.dat`).map((c) => c.kind);
    expect(pinAt(1)).toEqual(['pin']);
    expect(pinAt(1.05)).toEqual(['pin']);
    expect(pinAt(0.65)).toEqual([]);
    expect(pinAt(1.33)).toEqual([]);
    // through a reference that shrinks it too
    const source = memorySource({ ...PRIMITIVES, 'small.dat': certified('1 16 0 0 0 1 0 0 0 1 0 0 0 1 connect.dat'), 'part.dat': certified('1 16 0 0 0 0.5 0 0 0 0.5 0 0 0 0.5 small.dat') });
    expect(finishConnectors(flattenPart('part.dat', source).connectors)).toEqual([]);
  });
});

describe('hinges and turntables set on their parts', () => {
  const body = certified('3 16 -20 0 0 20 0 0 0 24 10');

  it('give a hinge brick’s two halves the one pivot they share, and a turntable’s its axis', () => {
    const source = memorySource({
      '3937.dat': body,
      's/3938s01.dat': body,
      // the top is two halves, one the other mirrored
      '3938.dat': certified('1 16 0 0 0 1 0 0 0 1 0 0 0 1 s\\3938s01.dat\n1 16 0 0 0 -1 0 0 0 1 0 0 0 1 s\\3938s01.dat'),
      '3679.dat': body,
    });
    const joints = (file: string) => finishConnectors(flattenPart(file, source).connectors).map(round);
    expect(joints('3937.dat')).toEqual([{ kind: 'hingebase', at: [0, 10, 0], axis: [1, 0, 0], length: 40 }]);
    expect(joints('3938.dat')).toEqual([{ kind: 'hingetop', at: [0, 10, 0], axis: [1, 0, 0], length: 40 }]);
    expect(joints('3679.dat')).toEqual([{ kind: 'turntop', at: [0, 6, 0], axis: [0, 1, 0], length: 4 }]);
  });

  it('give a car roof its four fingers and a canopy extender both its hinges, and put the rarer hinges together as LDraw does', () => {
    const at = (x: number, y: number, turn: string, file: string): string => `1 16 ${x} ${y} 0 ${turn} ${file}`;
    const [AS_DRAWN, HALF_ROUND] = ['1 0 0 0 1 0 0 0 1', '-1 0 0 0 1 0 0 0 -1'];
    const source = memorySource({
      ...Object.fromEntries(['4213', '2337', 's/2582s01', '4531', '3149e', '3148', '4592', '4593', '652', '653'].map((id) => [`${id}.dat`, body])),
      // a panel's shape is in a file of its own, which the plain panel and its printed ones are each drawn from
      '2582.dat': certified(at(0, 0, AS_DRAWN, 's\\2582s01.dat')),
      '2582p68.dat': certified([at(0, 0, AS_DRAWN, 's\\2582s01.dat'), '3 16 -20 30 0 20 30 0 0 60 0'].join('\n')),
      // LDraw's complete folding hinge plate (3149ec01) draws both plates about the hinge; its complete control stick (73587a) sets the
      // stick 2 LDU up the base; its complete 1 × 8 hinge brick (652c01) turns the second half half round, 80 LDU on
      'fold.dat': certified([at(0, 0, AS_DRAWN, '3149e.dat'), at(0, 0, AS_DRAWN, '3148.dat')].join('\n')),
      'lever.dat': certified([at(0, 0, AS_DRAWN, '4592.dat'), at(0, -2, AS_DRAWN, '4593.dat')].join('\n')),
      'brick8.dat': certified([at(-40, 0, AS_DRAWN, '652.dat'), at(40, 0, HALF_ROUND, '653.dat')].join('\n')),
    });
    const drawn = (file: string) => allConnectors(flattenPart(file, source).connectors).map(round);
    const free = (file: string) => finishConnectors(flattenPart(file, source).connectors).map((c) => c.kind);
    // a roof's fingers are along its front edge, the roof behind them
    expect(drawn('4213.dat')).toEqual([{ kind: 'fingers4', at: [0, 4, 36], axis: [-1, 0, 0], length: 72 }]);
    expect(drawn('2337.dat')).toEqual([
      { kind: 'fingers4', at: [0, 0, 0], axis: [-1, 0, 0], length: 72 },
      { kind: 'fingers5', at: [0, 0, -80], axis: [-1, 0, 0], length: 80 },
    ]);
    // a panel is drawn before its fingers, and they point the other way: it goes onto a holder turned half round. Its printed ones
    // hinge as it does
    expect(drawn('2582.dat')).toEqual([{ kind: 'fingers4', at: [0, 68, -26], axis: [1, 0, 0], length: 72 }]);
    expect(drawn('2582p68.dat')).toEqual(drawn('2582.dat'));
    // a folding hinge plate's two plates turn about one line right across them, a control stick about the short barrel at its foot
    expect(drawn('3149e.dat')).toEqual([{ kind: 'foldbase', at: [0, 0, 0], axis: [-1, 0, 0], length: 40 }]);
    expect(drawn('3148.dat')).toEqual([{ kind: 'foldtop', at: [0, 0, 0], axis: [-1, 0, 0], length: 40 }]);
    expect(drawn('4592.dat')).toEqual([{ kind: 'stickbase', at: [0, -2, 0], axis: [1, 0, 0], length: 4 }]);
    expect(drawn('4593.dat')).toEqual([{ kind: 'stick', at: [0, 0, 0], axis: [1, 0, 0], length: 4 }]);
    // a hinge tile's two fingers, as a hinge plate's: about a line across it, 10 LDU beyond its end
    expect(drawn('4531.dat')).toEqual([{ kind: 'fingers2', at: [30, 4, 0], axis: [0, 0, 1], length: 20 }]);
    // on their own, the halves of a 1 × 8 hinge brick point opposite ways along their pivots
    expect(drawn('652.dat')).toEqual([{ kind: 'tongue', at: [40, -5, 0], axis: [0, 0, 1], length: 20 }]);
    expect(drawn('653.dat')).toEqual([{ kind: 'yoke', at: [40, -5, 0], axis: [0, 0, -1], length: 20 }]);
    // put together, each pair's two joints are one line, pointing one way: that is how a half goes onto the other at rest
    for (const file of ['fold.dat', 'lever.dat', 'brick8.dat']) {
      const [one, other] = drawn(file);
      expect(`${file} ${one?.at} ${one?.axis}`).toBe(`${file} ${other?.at} ${other?.axis}`);
      // and nothing is left for another part
      expect(`${file} ${free(file)}`).toBe(`${file} `);
    }
    expect(drawn('brick8.dat').map((c) => c.kind)).toEqual(['tongue', 'yoke']);
  });
});

describe('connections a part’s own pieces take', () => {
  const body = certified('3 16 -20 0 0 20 0 0 0 24 10');
  const at = (y: number, file: string): string => `1 16 0 ${y} 0 1 0 0 0 1 0 0 0 1 ${file}`;

  it('leave out both halves of a joint a ready-made assembly holds together, and keep those of halves apart', () => {
    const source = memorySource({
      '3937.dat': body,
      's/3938s01.dat': body,
      // a complete hinge brick: LDraw draws both halves about one origin
      'hinge.dat': certified([at(0, '3937.dat'), at(0, 's\\3938s01.dat')].join('\n')),
      // its top lifted a brick off its base
      'apart.dat': certified([at(0, '3937.dat'), at(-24, 's\\3938s01.dat')].join('\n')),
      's/973s01.dat': body,
      's/3626bs02.dat': body,
      // a torso with its head on: the head's underside, 24 under its origin, on the neck
      'figure.dat': certified([at(0, 's\\973s01.dat'), at(-24, 's\\3626bs02.dat')].join('\n')),
    });
    const kinds = (file: string) => finishConnectors(flattenPart(file, source).connectors).map((c) => c.kind);
    expect(kinds('hinge.dat')).toEqual([]);
    expect(kinds('apart.dat')).toEqual(['hingebase', 'hingetop']);
    // the torso's waist and shoulders are still free
    expect(kinds('figure.dat')).toEqual(['waist', 'waist', 'shoulder', 'shoulder']);
    // every connection drawn can still be read, taken or not: LDraw's assemblies are how the joints set by hand are checked
    expect(allConnectors(flattenPart('hinge.dat', source).connectors).map((c) => c.kind)).toEqual(['hingebase', 'hingetop']);
  });

  it('take a pin’s end wherever a hole holds it, and leave a hole or an axle that goes on past what it holds', () => {
    // a hole through a brick a stud thick, from y 0 to 20, and a pin's end in it, from its collar at y 20 to its tip at y 0
    const hole = ['1 16 0 0 0 1 0 0 0 1 0 0 0 1 peghole.dat', '1 16 0 20 0 1 0 0 0 -1 0 0 0 -1 peghole.dat'];
    const pin = '1 16 0 20 0 1 0 0 0 1 0 0 0 1 connect.dat';
    expect(connectorsOf(hole.join('\n')).map((c) => c.kind)).toEqual(['pinhole']);
    expect(connectorsOf([...hole, pin].join('\n'))).toEqual([]);
    // in one end of a hole two studs long, the pin's end is taken and the hole goes on
    const long = [...hole, '1 16 0 20 0 1 0 0 0 1 0 0 0 1 peghole.dat', '1 16 0 40 0 1 0 0 0 -1 0 0 0 -1 peghole.dat'];
    expect(connectorsOf([...long, pin].join('\n')).map(round)).toEqual([{ kind: 'pinhole', at: [0, 20, 0], axis: [0, 1, 0], length: 40 }]);
    // an axle through the short hole, a stud and more out of it either side: the hole is taken, the axle goes on
    const axle = '1 16 0 -30 0 1 0 0 0 80 0 0 0 1 axlehol8.dat';
    expect(connectorsOf([...hole, axle].join('\n')).map(round)).toEqual([{ kind: 'axle', at: [0, 10, 0], axis: [0, 1, 0], length: 80 }]);
    // on another line beside the hole, the pin is not in it
    const beside = '1 16 20 20 0 1 0 0 0 1 0 0 0 1 connect.dat';
    expect(connectorsOf([...hole, beside].join('\n')).map((c) => c.kind)).toEqual(['pin', 'pinhole']);
  });
});
