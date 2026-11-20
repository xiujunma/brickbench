import { describe, expect, it } from 'bun:test';
import { brickCellBox } from '../model/geometry';
import { makeBrick } from '../model/testUtils';
import { facingOf, quarterTurn } from '../orientation';
import { getPart } from '../parts/catalog';
import type { PartDef, PartLookup } from '../parts/types';
import { attachToStuds, brickStudPoints, turnPayload, turnTowards } from './attach';
import { payloadFromBricks, payloadFromPart } from './payload';
import type { Hit } from './ray';

/** A 1 × 1 brick with a stud on its +Z side, as LDraw's 87087, its stud 14 LDU up: 10 under its top. */
const SIDE_STUD: PartDef = {
  id: 'side-stud',
  name: 'Brick 1 × 1 with Stud on 1 Side',
  category: 'library',
  w: 1,
  d: 1,
  h: 3,
  studs: [],
  solids: [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 3, z1: 1 }],
  shape: { kind: 'mesh' },
  keywords: [],
  sideStuds: [{ at: { x: 0, y: 0.7, z: 0.5 }, facing: '+z' }],
};
/** A jumper plate: one stud, between its two cells. */
const JUMPER: PartDef = { ...SIDE_STUD, id: 'jumper', w: 2, h: 1, solids: [{ x0: 0, y0: 0, z0: 0, x1: 2, y1: 1, z1: 1 }], sideStuds: undefined, studOffset: [0.5, 0] };
const lookup: PartLookup = (id) => (id === SIDE_STUD.id ? SIDE_STUD : id === JUMPER.id ? JUMPER : getPart(id));

function hit(point: Hit['point'], normal: Hit['normal'], brickId = 'base'): Hit {
  return { kind: 'brick', brickId, point, normal, t: 1, base: 0 };
}

describe('the studs of a placed brick', () => {
  it('stand on its top and its sides, turned as it is', () => {
    const studs = brickStudPoints(makeBrick({ partId: 'side-stud', x: 2 }), lookup);
    expect(studs).toEqual([
      { at: { x: 2.5, y: 1.2, z: 0.5 }, facing: '+y' },
      { at: { x: 2.5, y: 0.7, z: 1 }, facing: '+z' },
    ]);
    // turned a quarter about the vertical, its side stud faces +X
    expect(brickStudPoints(makeBrick({ partId: 'side-stud', r: 1 }), lookup)[1]).toEqual({ at: { x: 1, y: 0.7, z: 0.5 }, facing: '+x' });
  });

  it('face the way a part on its back faces', () => {
    expect(brickStudPoints(makeBrick({ partId: 'plate-1x1', r: 16 }), lookup)).toEqual([{ at: { x: 0.5, y: 0.5, z: 0.4 }, facing: '+z' }]);
  });

  it('stand between cells on a jumper plate', () => {
    expect(brickStudPoints(makeBrick({ partId: 'jumper' }), lookup)).toEqual([{ at: { x: 1, y: 0.4, z: 0.5 }, facing: '+y' }]);
  });
});

describe('turnTowards', () => {
  it('takes the smallest turn from one facing to another', () => {
    expect(turnTowards('+y', '+y')).toBe(0);
    expect(turnTowards('+y', '+z')).toBe(quarterTurn('x', 1));
    expect(facingOf(turnTowards('+y', '-y'))).toBe('-y');
    expect(facingOf(turnTowards('+x', '+y'))).not.toBe('+y');
  });
});

describe('attachToStuds', () => {
  const base = makeBrick({ id: 'base', partId: 'side-stud' });

  it('puts a part on a side stud on its back, its underside against the side, lined up with the brick’s top', () => {
    const plate = payloadFromPart(getPart('plate-1x1') as PartDef, 4, 0);
    const attached = attachToStuds(hit({ x: 0.6, y: 0.75, z: 1 }, { x: 0, y: 0, z: 1 }), base, plate, lookup);
    expect(attached?.payload.bricks).toEqual([{ partId: 'plate-1x1', colorId: 4, x: 0, y: 0, z: 0, r: 16 }]);
    expect(attached?.payload.size).toEqual({ w: 1, h: 2.5, d: 0.4 });
    // 2.5 plates tall, from half a plate up to the brick's top; 8 LDU out from its side
    expect(attached?.offset).toEqual({ x: 0, y: 0.5, z: 1 });
    const placed = { ...(attached?.payload.bricks[0] ?? base), id: 'p', ...attached?.offset };
    expect(brickCellBox(placed, lookup)).toEqual({ x0: 0, y0: 0.5, z0: 1, x1: 1, y1: 3, z1: 1.4 });
  });

  it('keeps the part’s spin about its top', () => {
    const turned = payloadFromPart(getPart('plate-1x2') as PartDef, 4, 1);
    const flat = payloadFromPart(getPart('plate-1x2') as PartDef, 4, 0);
    const at = hit({ x: 0.5, y: 0.7, z: 1 }, { x: 0, y: 0, z: 1 });
    // a 1 × 2 plate on its back lies along X; spun a quarter, it stands up the side
    expect(attachToStuds(at, base, flat, lookup)?.payload.size).toEqual({ w: 2, h: 2.5, d: 0.4 });
    expect(attachToStuds(at, base, turned, lookup)?.payload.size).toEqual({ w: 1, h: 5, d: 0.4 });
  });

  it('leaves faces without studs, and the tops of bricks on the grid, to the grid', () => {
    const plate = payloadFromPart(getPart('plate-1x1') as PartDef, 4, 0);
    expect(attachToStuds(hit({ x: 0.5, y: 0.7, z: 0 }, { x: 0, y: 0, z: -1 }), base, plate, lookup)).toBeNull();
    expect(attachToStuds(hit({ x: 0.5, y: 1.2, z: 0.5 }, { x: 0, y: 1, z: 0 }), base, plate, lookup)).toBeNull();
    expect(attachToStuds(hit({ x: 0.5, y: 1.2, z: 0.5 }, { x: 0.6, y: 0.8, z: 0 }), base, plate, lookup)).toBeNull();
  });

  it('builds on the top of a part on its side, and hangs parts under studs facing down', () => {
    // a 1 × 1 plate on its back at the origin: its stud faces +Z
    const onBack = makeBrick({ id: 'base', partId: 'plate-1x1', r: 16 });
    const plate = payloadFromPart(getPart('plate-1x1') as PartDef, 4, 0);
    const outward = attachToStuds(hit({ x: 0.5, y: 0.5, z: 0.4 }, { x: 0, y: 0, z: 1 }), onBack, plate, lookup);
    expect(outward?.offset).toEqual({ x: 0, y: 0, z: 0.4 });
    // upside down, a plate's stud faces down: what goes on it hangs upside down under it
    const upsideDown = makeBrick({ id: 'base', partId: 'plate-1x1', r: 4, y: 5 });
    const under = attachToStuds(hit({ x: 0.5, y: 2, z: 0.5 }, { x: 0, y: -1, z: 0 }), upsideDown, plate, lookup);
    expect(facingOf(under?.payload.bricks[0]?.r ?? 0)).toBe('-y');
    expect(under?.offset).toEqual({ x: 0, y: 4, z: 0 });
  });
});

describe('turnPayload', () => {
  it('turns a group as one, carrying the point it is held by along', () => {
    const group = payloadFromBricks(
      [makeBrick({ id: 'a', partId: 'brick-1x1' }), makeBrick({ id: 'b', partId: 'plate-1x1', y: 3 })],
      lookup,
    );
    const { payload, socket } = turnPayload(group, quarterTurn('x', 1), { x: 10, y: 0, z: 10 }, lookup);
    // on its back the stack lies along Z: the brick at the back, the plate in front
    expect(payload.bricks.map((b) => [b.partId, b.z, b.r])).toEqual([
      ['brick-1x1', 0, 16],
      ['plate-1x1', 1.2, 16],
    ]);
    expect(payload.size).toEqual({ w: 1, h: 2.5, d: 1.6 });
    expect(socket).toEqual({ x: 10, y: 10, z: 0 });
  });
});
