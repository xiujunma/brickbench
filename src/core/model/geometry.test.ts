import { describe, expect, it } from 'bun:test';
import { getPart } from '../parts/catalog';
import { LDU_PER_STUD_STEP, PLATE_HEIGHT, onLduLattice } from '../grid';
import { facingOf, orientationFacing, turnAbout } from '../orientation';
import type { PartDef } from '../parts/types';
import {
  WHOLE_CELL,
  brickCellBox,
  brickCellQuarters,
  brickCells,
  brickFloor,
  brickLduSolids,
  brickOrigin,
  brickWorldBoxes,
  groupCellBox,
  isLoose,
  isOnGrid,
  placeLoose,
  rotateGroup,
  turnBricksAbout,
  turnedSize,
} from './geometry';
import { brickConnectors } from './connections';
import { connectorLookup as hinges } from './connectorTestParts';
import { makeBrick } from './testUtils';
import type { Brick } from './types';

const lookup = getPart;

function footprint(bricks: readonly Brick[]): string[] {
  return bricks
    .map((b) => {
      const box = brickCellBox(b, lookup);
      return `${box.x0},${box.z0}-${box.x1},${box.z1}`;
    })
    .sort();
}

describe('brickCellBox', () => {
  it('covers the part footprint at its anchor', () => {
    expect(brickCellBox(makeBrick({ x: 1, y: 3, z: -2 }), lookup)).toEqual({
      x0: 1, y0: 3, z0: -2, x1: 5, y1: 6, z1: 0,
    });
  });

  it('swaps the footprint for quarter turns', () => {
    expect(brickCellBox(makeBrick({ r: 1 }), lookup)).toEqual({
      x0: 0, y0: 0, z0: 0, x1: 2, y1: 3, z1: 4,
    });
  });

  it('throws for unknown parts', () => {
    expect(() => brickCellBox(makeBrick({ partId: 'nope' }), lookup)).toThrow(/unknown part/i);
  });
});

describe('brickCells', () => {
  it('lists every occupied cell of a solid brick', () => {
    expect([...brickCells(makeBrick(), lookup)]).toHaveLength(4 * 2 * 3);
  });

  it('leaves the arch opening empty, even when rotated', () => {
    const cells = [...brickCells(makeBrick({ partId: 'arch-1x4', r: 1, x: 10, z: 10 }), lookup)];
    const keys = new Set(cells.map(([x, y, z]) => `${x},${y},${z}`));
    // rotated a quarter turn the arch runs along Z, its opening is the middle two rows
    expect(keys.has('10,0,10')).toBe(true);
    expect(keys.has('10,0,11')).toBe(false);
    expect(keys.has('10,0,12')).toBe(false);
    expect(keys.has('10,0,13')).toBe(true);
    expect(keys.has('10,2,11')).toBe(true);
  });
});

describe('brickWorldBoxes', () => {
  it('converts cell boxes into world units', () => {
    const [box] = brickWorldBoxes(makeBrick({ x: 2, y: 3, z: 1 }), lookup);
    expect(box?.min).toEqual({ x: 2, y: 3 * PLATE_HEIGHT, z: 1 });
    expect(box?.max.x).toBe(6);
    expect(box?.max.y).toBeCloseTo(6 * PLATE_HEIGHT);
    expect(box?.max.z).toBe(3);
  });
});

describe('groupCellBox', () => {
  it('bounds all bricks', () => {
    const box = groupCellBox([makeBrick(), makeBrick({ id: 'b2', x: 6, y: 3, z: -1 })], lookup);
    expect(box).toEqual({ x0: 0, y0: 0, z0: -1, x1: 10, y1: 6, z1: 2 });
  });

  it('rejects empty groups', () => {
    expect(() => groupCellBox([], lookup)).toThrow();
  });
});

describe('rotateGroup', () => {
  it('turns a single brick in place', () => {
    const [turned] = rotateGroup([makeBrick()], lookup, 1);
    expect(turned).toMatchObject({ r: 1, x: 1, z: -1 });
  });

  it('keeps a group arrangement while turning it', () => {
    // an L made from a 2x4 brick and a 1x2 brick sitting at its +X/+Z corner
    const group = [
      makeBrick({ id: 'long' }),
      makeBrick({ id: 'short', partId: 'brick-1x2', x: 2, z: 2 }),
    ];
    const turned = rotateGroup(group, lookup, 1);
    // the long brick now runs along Z and the short one sits on its +X side, low-Z half
    expect(footprint(turned)).toEqual(['0,-1-2,3', '2,-1-3,1']);
  });

  it('returns to the start after four quarter turns, including odd sizes', () => {
    const group = [
      makeBrick({ partId: 'brick-2x3' }),
      makeBrick({ id: 'b2', partId: 'brick-1x1', x: 3, z: 2 }),
    ];
    let current: readonly Brick[] = group;
    for (let i = 0; i < 4; i++) current = rotateGroup(current, lookup, 1);
    expect(current).toEqual(group);
  });

  it('undoes a turn with the opposite turn', () => {
    const group = [makeBrick({ partId: 'brick-2x3', x: 5, z: 7, r: 2 })];
    expect(rotateGroup(rotateGroup(group, lookup, 1), lookup, -1)).toEqual(group);
    expect(rotateGroup(rotateGroup(group, lookup, -1), lookup, 1)).toEqual(group);
  });
});

describe('bricks half a stud over', () => {
  const jumper = { ...(getPart('plate-1x2') as PartDef), id: 'jumper', studOffset: [0.5, 0] as const };
  const lookupWithJumper = (id: string) => (id === 'jumper' ? jumper : getPart(id));

  it('turn with their group, staying on the jumper plate’s stud', () => {
    const group = [makeBrick({ id: 'j', partId: 'jumper', x: 0, y: 0, z: 0 }), makeBrick({ id: 'p', partId: 'plate-1x1', x: 0.5, y: 1, z: 0 })];
    for (const dir of [1, -1] as const) {
      const [j, p] = rotateGroup(group, lookupWithJumper, dir);
      // the jumper now runs along z, its stud between its cells there; the plate sits on it
      expect(j?.r).toBe(dir === 1 ? 1 : 3);
      expect([p?.x, p?.z]).toEqual([j?.x, (j?.z ?? 0) + 0.5]);
    }
    // four turns bring both back
    let turned = group;
    for (let i = 0; i < 4; i++) turned = rotateGroup(turned, lookupWithJumper, 1);
    expect(turned.map((b) => [b.x, b.z, b.r])).toEqual(group.map((b) => [b.x, b.z, b.r]));
  });

  it('fill the halves and quarters of the cells along their edges', () => {
    const quarters = [...brickCellQuarters(makeBrick({ partId: 'plate-1x1', x: 0.5, z: -0.5 }), getPart)];
    // a 1 × 1 plate half a stud over both ways: a quarter of each of four cells
    expect(quarters).toEqual([
      [0, 0, -1, 0b1000],
      [1, 0, -1, 0b0100],
      [0, 0, 0, 0b0010],
      [1, 0, 0, 0b0001],
    ]);
    expect([...brickCellQuarters(makeBrick({ partId: 'plate-1x1' }), getPart)]).toEqual([[0, 0, 0, WHOLE_CELL]]);
  });
});

describe('bricks on their sides', () => {
  // a 2 × 4 brick tipped onto its back: its top faces +Z, so its 3 plates of height lie along Z
  const onBack = makeBrick({ id: 'back', r: 16 });

  it('fill the box the part fills once turned, in studs and plates', () => {
    expect(turnedSize(getPart('brick-2x4') as PartDef, 16)).toEqual({ w: 4, h: 5, d: 1.2 });
    expect(brickCellBox(onBack, lookup)).toEqual({ x0: 0, y0: 0, z0: 0, x1: 4, y1: 5, z1: 1.2 });
    expect(brickLduSolids(onBack, lookup)).toEqual([{ x0: 0, y0: 0, z0: 0, x1: 80, y1: 40, z1: 24 }]);
    // its mesh turns about the middle of its footprint's bottom, which now stands at the middle of the box's back face
    expect(brickOrigin(onBack, lookup)).toEqual({ x: 2, y: 1, z: 0 });
  });

  it('are on the grid only when upright, on whole or half studs and whole plates', () => {
    expect(isOnGrid(makeBrick())).toBe(true);
    expect(isOnGrid(makeBrick({ x: 0.5, z: -1.5 }))).toBe(true);
    expect(isOnGrid(onBack)).toBe(false);
    expect(isOnGrid(makeBrick({ x: 0.35 }))).toBe(false);
    expect(isOnGrid(makeBrick({ y: 0.5 }))).toBe(false);
  });

  it('turn with their group, their top turning with them', () => {
    const group = [makeBrick({ id: 'base', partId: 'brick-2x2' }), { ...onBack, x: 0, y: 3, z: 0 }];
    const once = rotateGroup(group, lookup, 1);
    // a quarter turn about the vertical (+X towards -Z) takes a top facing +Z round to face +X
    expect(facingOf(once[1]?.r ?? 0)).toBe('+x');
    expect(brickCellBox(once[1] as Brick, lookup)).toMatchObject({ y0: 3, y1: 8 });
    let turned: readonly Brick[] = group;
    for (let i = 0; i < 4; i++) turned = rotateGroup(turned, lookup, 1);
    expect(turned).toEqual(group);
    expect(rotateGroup(rotateGroup(group, lookup, -1), lookup, 1)).toEqual(group);
  });
});

describe('loose parts', () => {
  const eighth = [Math.SQRT1_2, 0, Math.SQRT1_2, 0, 1, 0, -Math.SQRT1_2, 0, Math.SQRT1_2] as const;

  it('fill the box around them once turned, and stand exactly where they are', () => {
    const loose = makeBrick({ partId: 'plate-1x1', x: 0.3, y: 0.25, z: 0.1, m: eighth });
    expect(isLoose(loose)).toBe(true);
    expect(isOnGrid(loose)).toBe(false);
    const box = brickCellBox(loose, lookup);
    // a 1 × 1 cell turned an eighth spans √2 studs
    expect(box.x1 - box.x0).toBeCloseTo(Math.SQRT2);
    expect([box.x0, box.y0, box.z0]).toEqual([0.3, 0.25, 0.1]);
    expect(brickOrigin(loose, lookup).x).toBeCloseTo(0.3 + Math.SQRT1_2);
  });

  it('turn with their group about the vertical, keeping their angle', () => {
    const group = [makeBrick({ id: 'a', partId: 'brick-2x2' }), makeBrick({ id: 'b', partId: 'plate-1x1', x: 3, m: eighth })];
    let turned: readonly Brick[] = group;
    for (let i = 0; i < 4; i++) turned = rotateGroup(turned, lookup, 1);
    turned[1]?.m?.forEach((v, i) => expect(v).toBeCloseTo(eighth[i] ?? 0, 12));
    expect(turned[1]?.x).toBeCloseTo(3, 9);
  });
});

describe('how low a loose part reaches', () => {
  const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;
  /** A part turned by `degrees` about its first connection, the way that points. */
  const swung = (brick: Brick, degrees: number, parts = hinges): Brick => {
    const [joint] = brickConnectors(brick, parts);
    const [turned] = joint ? turnBricksAbout([brick], parts, joint.axis, (degrees * Math.PI) / 180, joint.at) : [];
    if (!turned) throw new Error(`${brick.partId} has no connection to turn about`);
    return turned;
  };

  it('takes a hinged part for round about its pivot: lifted off the ground, the corner of its box beyond the hinge does not count', () => {
    // a car roof lying on the ground: its fingers along one edge, half way up it, a fifth of a stud in from that edge
    const roof = { ...makeBrick({ id: 'roof', partId: 'roof' }), m: IDENTITY };
    expect(brickFloor(roof, hinges)).toBeCloseTo(0, 9);
    for (const degrees of [15, 45, 90, 135, 180]) expect(`${degrees}° ${Math.abs(brickFloor(swung(roof, degrees), hinges)).toFixed(6)}`).toBe(`${degrees}° ${(0).toFixed(6)}`);
    // the box around it does dip, where the roof is only its round fingers
    expect(brickCellBox(swung(roof, 15), hinges).y0).toBeLessThan(-0.1);
    // swung the other way the roof itself goes down through the ground: three and four fifths of a stud from its fingers to its far edge
    expect(brickFloor(swung(roof, -15), hinges) * PLATE_HEIGHT).toBeCloseTo(0.2 - 3.8 * Math.sin(Math.PI / 12) - 0.2 * Math.cos(Math.PI / 12), 6);
    // stood on its fingers and then tipped 30° along them, its lowest is the low end of their round: 1.8 studs along from their middle
    const stood = swung(roof, 90);
    const [fingers] = brickConnectors(stood, hinges);
    const [tipped] = fingers ? turnBricksAbout([stood], hinges, { x: 0, y: 0, z: 1 }, Math.PI / 6, fingers.at) : [];
    if (!tipped) throw new Error('not tipped');
    expect(brickFloor(tipped, hinges) * PLATE_HEIGHT).toBeCloseTo(0.2 - 1.8 * Math.sin(Math.PI / 6) - 0.2 * Math.cos(Math.PI / 6), 6);
    // so with the two fingers of a hinge plate and a folding plate's top, which lie on the ground by the round of their hinge; and with
    // the finger of a click hinge and half a 1 × 8 hinge brick, whose hinges are well up them
    const under = (height: number): number => height * (1 - Math.cos(Math.PI / 12));
    const flats = [['fingers-2', 0], ['fingers-3', 0], ['fold-top', 0], ['fold-base', 0], ['finger', under(0.7)], ['fork', under(0.7)], ['yoke-brick', under(1.45)], ['tongue-brick', under(1.45)]] as const;
    for (const [partId, low] of flats) {
      const flat = { ...makeBrick({ id: 'flat', partId }), m: IDENTITY };
      const [joint] = hinges(partId)?.connectors ?? [];
      // up is the way that lifts the part's middle, which its pivot lies to one side of
      const up = (joint?.axis.z ?? 0) * (joint?.at.x ?? 0) > 0 || (joint?.axis.x ?? 0) * (joint?.at.z ?? 0) < 0 ? -1 : 1;
      // lifted 15°, the lowest of it is what was under its pivot
      expect(`${partId} ${Math.abs(brickFloor(swung(flat, up * 15), hinges) * PLATE_HEIGHT).toFixed(6)}`).toBe(`${partId} ${low.toFixed(6)}`);
      for (const degrees of [45, 90]) expect(brickFloor(swung(flat, up * degrees), hinges)).toBeGreaterThanOrEqual(-1e-9);
      expect(brickFloor(swung(flat, -up * 15), hinges)).toBeLessThan(-0.5);
    }
  });

  it('never takes a part for more than its box: the round about a pivot stays inside it, however the part is turned', () => {
    const ids = ['roof', 'roof-tile', 'roof-plate', 'roof-holder', 'fold-base', 'fold-top', 'stick', 'tongue-brick', 'yoke-brick', 'finger', 'fork', 'fingers-2', 'fingers-3', 'fingers-both', 'finger-on-top', 'hinge-top', 'hinge-top-2x2'];
    const turns = [0, 1, 2, 3, 4, 5].flatMap((k) => [{ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 }, { x: 0.6, y: 0.8, z: 0 }].map((axis) => turnAbout(axis, (k * Math.PI) / 3 + 0.2)));
    for (const id of ids) {
      const part = hinges(id);
      if (!part?.connectors?.length) throw new Error(id);
      const plain: PartDef = { ...part, connectors: [] };
      for (const m of turns) {
        const brick = { ...makeBrick({ id, partId: id, y: 20 }), m };
        expect(brickFloor(brick, hinges)).toBeGreaterThanOrEqual(brickFloor(brick, () => plain) - 1e-9);
      }
    }
    // a tile whose fingers stand out beyond its cells has no room for a round in them: stood on that edge, it reaches down to it
    const tile = { ...makeBrick({ id: 'tile', partId: 'roof-tile', y: 20 }), m: turnAbout({ x: 1, y: 0, z: 0 }, Math.PI / 2) };
    expect(brickFloor(tile, hinges)).toBeCloseTo(brickCellBox(tile, hinges).y0, 9);
  });

  it('takes a plate that carries its hinge on top for its whole shape: the plate runs on under the finger, beyond the pivot', () => {
    // its pivot is half a stud in from its end, and the round of the finger there only a quarter of a stud: it is no end of the part
    const plain: PartDef = { ...(hinges('finger-on-top') as PartDef), connectors: [] };
    const plate = { ...makeBrick({ id: 'plate', partId: 'finger-on-top' }), m: IDENTITY };
    for (const degrees of [-60, -15, 15, 60]) {
      const turned = swung(plate, degrees);
      expect(`${degrees}° ${brickFloor(turned, hinges).toFixed(9)}`).toBe(`${degrees}° ${brickFloor(turned, () => plain).toFixed(9)}`);
    }
    // turned 60° the corner of the plate under the finger, half a stud beyond the pivot and 0.7 under it, is its lowest: under the ground
    expect(brickFloor(swung(plate, -60), hinges) * PLATE_HEIGHT).toBeCloseTo(0.7 - 0.5 * Math.sin(Math.PI / 3) - 0.7 * Math.cos(Math.PI / 3), 6);
    // and a folding hinge plate's base, whose nine cells reach a tenth of a stud past the round of its knuckle, still ends in the knuckle
    const long: PartDef = {
      id: 'long', name: 'long', category: 'library', w: 2, d: 9, h: 2, studs: [], solids: [{ x0: 0, y0: 0, z0: 0, x1: 2, y1: 2, z1: 9 }], shape: { kind: 'mesh' }, keywords: [],
      connectors: [{ kind: 'foldbase', at: { x: 0, y: 0.4, z: -4 }, axis: { x: -1, y: 0, z: 0 }, length: 2 }],
    };
    const base = { ...makeBrick({ id: 'long', partId: 'long' }), m: IDENTITY };
    expect(Math.abs(brickFloor(swung(base, 30, () => long), () => long))).toBeCloseTo(0, 9);
  });

  it('keeps the rest of a part with a hinge at each end: only what lies beyond each pivot is round', () => {
    // a canopy extender, as LDraw 2337: fingers along its top at one end, a holder's five at the other, its body hanging 2.2 studs under both
    const extender: PartDef = {
      id: 'extender', name: 'extender', category: 'library', w: 4, d: 5, h: 6, studs: [], solids: [{ x0: 0, y0: 0, z0: 0, x1: 4, y1: 6, z1: 5 }], shape: { kind: 'mesh' }, keywords: [],
      extent: { min: { x: -2, y: 0, z: -2.5 }, max: { x: 2, y: 2.6, z: 1.9 } },
      connectors: [
        { kind: 'fingers4', at: { x: 0, y: 2.2, z: -2.3 }, axis: { x: -1, y: 0, z: 0 }, length: 3.6 },
        { kind: 'fingers5', at: { x: 0, y: 2.2, z: 1.7 }, axis: { x: -1, y: 0, z: 0 }, length: 4 },
      ],
    };
    const parts = (id: string) => (id === 'extender' ? extender : hinges(id));
    const hanging = { ...makeBrick({ id: 'extender', partId: 'extender' }), m: IDENTITY };
    expect(brickFloor(hanging, parts)).toBeCloseTo(0, 9);
    // swung down about its fingers, the far corner of its body's underside, 4 studs on and 2.2 under them, is its lowest
    expect(brickFloor(swung(hanging, -15, parts), parts) * PLATE_HEIGHT).toBeCloseTo(2.2 - 2.2 * Math.cos(Math.PI / 12) - 4 * Math.sin(Math.PI / 12), 6);
    // swung up, the corner under its fingers is: a fifth of a stud beyond them its box is cut away, not its whole depth
    expect(brickFloor(swung(hanging, 15, parts), parts) * PLATE_HEIGHT).toBeCloseTo(2.2 - 2.2 * Math.cos(Math.PI / 12), 6);
  });

  it('leaves a part with no hinge to its box, or to the extent of its shape', () => {
    const beam = { ...makeBrick({ id: 'beam', partId: 'beam' }), m: turnAbout({ x: 1, y: 0, z: 0 }, Math.PI / 6) };
    expect(brickFloor(beam, hinges)).toBe(brickCellBox(beam, hinges).y0);
    // a bar is a fifth of a stud across, well inside its cells
    const bar = { ...makeBrick({ id: 'bar', partId: 'bar' }), m: turnAbout({ x: 1, y: 0, z: 0 }, Math.PI / 2) };
    expect(brickFloor(bar, hinges) - brickCellBox(bar, hinges).y0).toBeCloseTo(0.3 / PLATE_HEIGHT, 6);
    // on the grid, a hinged part stands on its cells like any brick
    expect(brickFloor(makeBrick({ id: 'roof', partId: 'roof', y: 3 }), hinges)).toBe(3);
    // a block with a pivot through its very middle has itself all round the pivot, and nothing beyond it to take for round: tipped
    // about the pivot's own way, it reaches as low as its box does, by the corner a round about the pivot would stop short of
    const hub = (at: { x: number; y: number; z: number }, axis: { x: number; y: number; z: number }): PartDef => ({
      id: 'hub', name: 'hub', category: 'library', w: 2, d: 2, h: 5, studs: [], solids: [{ x0: 0, y0: 0, z0: 0, x1: 2, y1: 5, z1: 2 }], shape: { kind: 'mesh' }, keywords: [],
      connectors: [{ kind: 'tongue', at, axis, length: 2 }],
    });
    const centred = hub({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 });
    const rolled = { ...makeBrick({ id: 'hub', partId: 'hub' }), m: turnAbout({ x: 1, y: 0, z: 0 }, Math.PI / 5) };
    expect(brickFloor(rolled, () => centred)).toBeCloseTo(brickCellBox(rolled, () => centred).y0, 9);
    // nor is a pivot that stands upright in a part, near its end, one across it: tipped over a corner of the end beyond it, the part
    // reaches as low as its box, by that corner
    const upright = hub({ x: 0.8, y: 1, z: 0 }, { x: 0, y: 1, z: 0 });
    const tippedOver = { ...makeBrick({ id: 'hub', partId: 'hub' }), m: turnAbout({ x: Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 }, Math.PI / 5) };
    expect(brickFloor(tippedOver, () => upright)).toBeCloseTo(brickCellBox(tippedOver, () => upright).y0, 9);
  });

  it('takes only the corner at the pivot for round, where a part’s pivot is low in it and the part reaches on to either side', () => {
    // a long part lying flat, hinged a fifth of a stud up, a third of the way along: under its pivot it is round, a fifth of a stud to
    // either side; the rest of its underside is as flat as its box, and goes down either way it turns
    const arm: PartDef = {
      id: 'arm', name: 'arm', category: 'library', w: 6, d: 2, h: 5, studs: [], solids: [{ x0: 0, y0: 0, z0: 0, x1: 6, y1: 5, z1: 2 }], shape: { kind: 'mesh' }, keywords: [],
      connectors: [{ kind: 'tongue', at: { x: 1, y: 0.2, z: 0 }, axis: { x: 0, y: 0, z: 1 }, length: 2 }],
    };
    const flat = { ...makeBrick({ id: 'arm', partId: 'arm' }), m: IDENTITY };
    expect(brickFloor(flat, () => arm)).toBeCloseTo(0, 9);
    for (const degrees of [15, -15]) {
      const turned = swung(flat, degrees, () => arm);
      expect(brickFloor(turned, () => arm)).toBeCloseTo(brickCellBox(turned, () => arm).y0, 9);
      expect(brickFloor(turned, () => arm)).toBeLessThan(-0.5);
    }
    // a thin plate hinged the same way has two studs of itself beyond the pivot, at the pivot's own height: that is no knuckle at its
    // end, and it is taken for its whole box
    const plate: PartDef = { ...arm, id: 'plate', h: 1, solids: [{ x0: 0, y0: 0, z0: 0, x1: 6, y1: 1, z1: 2 }] };
    const lying = { ...makeBrick({ id: 'plate', partId: 'plate' }), m: IDENTITY };
    for (const degrees of [15, -15]) {
      const turned = swung(lying, degrees, () => plate);
      expect(brickFloor(turned, () => plate)).toBeCloseTo(brickCellBox(turned, () => plate).y0, 9);
    }
    // a control stick, though, is all barrel at its foot: it tips either way in its base without its box's corners counting
    const stick = { ...makeBrick({ id: 'stick', partId: 'stick' }), m: IDENTITY };
    for (const degrees of [30, -30]) {
      const tipped = swung(stick, degrees);
      expect(brickFloor(tipped, hinges)).toBeCloseTo(0, 9);
      expect(brickCellBox(tipped, hinges).y0).toBeLessThan(-0.1);
    }
    // and a part with a hinge at its end, well up it, is all knuckle beyond the hinge, from top to bottom: lifted, what was under its pivot is its lowest
    const finger = { ...makeBrick({ id: 'finger', partId: 'finger' }), m: IDENTITY };
    expect(brickFloor(swung(finger, -15), hinges) * PLATE_HEIGHT).toBeCloseTo(0.7 * (1 - Math.cos(Math.PI / 12)), 6);
  });
});

describe('swinging parts about a line', () => {
  it('turns them about it, loose, and brings them round again', () => {
    const plate = makeBrick({ partId: 'plate-1x2', x: 2, y: 3 });
    const axis = { x: 0, y: 0, z: 1 };
    // about a line along Z through the plate's left end, at its bottom
    const pivot = { x: 2, y: 3 * PLATE_HEIGHT, z: 0.5 };
    const [up] = turnBricksAbout([plate], lookup, axis, Math.PI / 2, pivot);
    if (!up) throw new Error('turned');
    expect(isLoose(up)).toBe(true);
    // stood up on that end, a plate thick to the left of the line, two studs high
    expect(up.x).toBeCloseTo(2 - 0.4, 9);
    expect(up.y).toBeCloseTo(3, 9);
    expect(brickCellBox(up, lookup).y1 * PLATE_HEIGHT).toBeCloseTo(3 * PLATE_HEIGHT + 2, 9);
    // 24 steps of 15° bring it back
    let turned: Brick = plate;
    for (let i = 0; i < 24; i++) turned = turnBricksAbout([turned], lookup, axis, Math.PI / 12, pivot)[0] ?? turned;
    expect(turned.x).toBeCloseTo(2, 9);
    expect(turned.y).toBeCloseTo(3, 9);
    expect(turned.r).toBe(0);
    turned.m?.forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 0, 1, 0, 0, 0, 1][i] ?? 0, 9));
  });

  it('places a loose part by where its origin goes, its orientation the nearest square one', () => {
    const quarter = [0, 0, 1, 0, 1, 0, -1, 0, 0] as const;
    const placed = placeLoose(makeBrick({ partId: 'brick-2x4' }), lookup, { x: 0, y: 0, z: 0 }, quarter);
    // turned a quarter, its 4-stud side runs along Z, centred on the origin
    expect([placed.x, placed.y, placed.z]).toEqual([-1, 0, -2]);
    expect(placed.r).toBe(1);
    // where the sums leave noise in the last digit, the position comes out clean
    const third = placeLoose(makeBrick({ partId: 'plate-1x1' }), lookup, { x: 10, y: 8.000000000000002, z: 10 }, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect([third.x, third.y, third.z]).toEqual([0, 1, 0]);
  });
});

describe('turning a group of loose and square parts', () => {
  it('keeps the square parts on the LDraw-unit lattice, and brings them back turned back', () => {
    const side = makeBrick({ id: 'side', partId: 'brick-2x4', x: 3, y: 0, z: 2, r: orientationFacing('+x', 0) });
    const tilt = placeLoose(makeBrick({ id: 'tilt', partId: 'plate-1x2' }), lookup, { x: 100, y: 8, z: 60 }, turnAbout({ x: 0, y: 1, z: 0 }, Math.PI / 12));
    for (const dir of [1, -1] as const) {
      const [turned] = rotateGroup([side, tilt], lookup, dir);
      expect(onLduLattice(turned?.x ?? NaN, LDU_PER_STUD_STEP)).toBe(true);
      expect(onLduLattice(turned?.z ?? NaN, LDU_PER_STUD_STEP)).toBe(true);
      const [back] = rotateGroup(rotateGroup([side, tilt], lookup, dir), lookup, dir === 1 ? -1 : 1);
      expect(back?.x).toBeCloseTo(side.x, 9);
      expect(back?.z).toBeCloseTo(side.z, 9);
    }
  });
});
