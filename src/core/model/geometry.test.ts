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
