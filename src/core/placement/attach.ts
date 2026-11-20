/**
 * Building on studs that face any way (SNOT): on the studs on a part's
 * sides, on the studs of a part on its side, and on studs facing down. The
 * payload turns so its underside meets the stud nearest the cursor, keeping
 * its spin, and lands exactly where the stud puts it, on the LDraw unit
 * lattice, rather than on the cell grid.
 */
import { LDU_PER_PLATE_STEP, LDU_PER_STUD_STEP, LDU_PER_UNIT, snapToLdu, type Vec3 } from '../grid';
import { LDU_PER_PLATE, LDU_PER_STUD, brickCellBox, brickOriginLdu, isOnGrid, requirePart } from '../model/geometry';
import type { Brick } from '../model/types';
import {
  compose,
  facingOf,
  facingOfVector,
  facingVector,
  ORIENTATIONS,
  rotateVector,
  turnOf,
  type Facing,
  type Orientation,
} from '../orientation';
import type { PartLookup } from '../parts/types';
import type { Payload, PayloadBrick } from './payload';
import type { Hit } from './ray';

/** A stud of a placed brick: where its base sits, in world units, and the way it faces. */
export interface StudPoint {
  readonly at: Vec3;
  readonly facing: Facing;
}

/** Library parts carry their studs in their meshes; their top studs stand on the cells of their footprint, or between, as on a jumper plate. */
function topStudCells(brick: Brick, lookup: PartLookup): (readonly [number, number])[] {
  const part = requirePart(lookup, brick.partId);
  if (part.studs.length > 0 || part.shape.kind !== 'mesh') return part.studs.map(([x, z]) => [x + 0.5, z + 0.5] as const);
  const [ox, oz] = part.studOffset ?? [0, 0];
  const cells: (readonly [number, number])[] = [];
  for (let x = 0; x < part.w; x++) {
    for (let z = 0; z < part.d; z++) {
      const at = [x + 0.5 + ox, z + 0.5 + oz] as const;
      if (at[0] < part.w && at[1] < part.d) cells.push(at);
    }
  }
  return cells;
}

/** Every stud of a placed brick, its top's and its sides', where it stands in the world and the way it faces. */
export function brickStudPoints(brick: Brick, lookup: PartLookup): StudPoint[] {
  const part = requirePart(lookup, brick.partId);
  const origin = brickOriginLdu(brick, lookup);
  const place = (local: Vec3, facing: Facing): StudPoint => {
    const turned = rotateVector(brick.r, local);
    const out = rotateVector(brick.r, facingVector(facing));
    return {
      at: { x: (origin.x + turned.x) / LDU_PER_UNIT + 0, y: (origin.y + turned.y) / LDU_PER_UNIT + 0, z: (origin.z + turned.z) / LDU_PER_UNIT + 0 },
      facing: facingOfVector(out) ?? '+y',
    };
  };
  const halfW = (part.w * LDU_PER_STUD) / 2;
  const halfD = (part.d * LDU_PER_STUD) / 2;
  const top = topStudCells(brick, lookup).map(([x, z]) => place({ x: x * LDU_PER_STUD - halfW, y: part.h * LDU_PER_PLATE, z: z * LDU_PER_STUD - halfD }, '+y'));
  const sides = (part.sideStuds ?? []).map((stud) => place({ x: stud.at.x * LDU_PER_UNIT, y: stud.at.y * LDU_PER_UNIT, z: stud.at.z * LDU_PER_UNIT }, stud.facing));
  return [...top, ...sides];
}

/** The smallest of the 24 turns that points `from` along `to`. */
export function turnTowards(from: Facing, to: Facing): Orientation {
  const target = facingVector(to);
  let best: Orientation = 0;
  let bestTrace = -Infinity;
  for (let o = 0; o < ORIENTATIONS; o++) {
    const v = rotateVector(o, facingVector(from));
    if (v.x !== target.x || v.y !== target.y || v.z !== target.z) continue;
    const [a, , , , e, , , , i] = turnOf(o);
    // the larger the trace, the smaller the turn
    if (a + e + i > bestTrace) {
      bestTrace = a + e + i;
      best = o;
    }
  }
  return best;
}

/** Which way a payload's top faces: its one brick's top, or up for a group, which turns as one. */
function payloadUp(payload: Payload): Facing {
  const [only] = payload.bricks;
  return payload.bricks.length === 1 && only ? facingOf(only.r) : '+y';
}

function lduBox(brick: PayloadBrick, lookup: PartLookup): { readonly min: Vec3; readonly max: Vec3 } {
  const box = brickCellBox({ ...brick, id: '' }, lookup);
  return {
    min: { x: box.x0 * LDU_PER_STUD, y: box.y0 * LDU_PER_PLATE, z: box.z0 * LDU_PER_STUD },
    max: { x: box.x1 * LDU_PER_STUD, y: box.y1 * LDU_PER_PLATE, z: box.z1 * LDU_PER_STUD },
  };
}

/**
 * A payload turned by `turn` about its own corner, its bricks turned with
 * it, and the point `socket` (in LDraw units, in the payload's frame) carried
 * along: the new payload, with its corner back at 0, and where the socket is
 * in it.
 */
export function turnPayload(payload: Payload, turn: Orientation, socket: Vec3, lookup: PartLookup): { readonly payload: Payload; readonly socket: Vec3 } {
  const turned = payload.bricks.map((brick) => {
    const { min, max } = lduBox(brick, lookup);
    const a = rotateVector(turn, min);
    const b = rotateVector(turn, max);
    const corner = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) };
    const far = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) };
    return { brick, corner, far, r: compose(turn, brick.r) };
  });
  // plain loops: spreading thousands of values into Math.min overflows the call stack in some engines
  const lo = { x: Infinity, y: Infinity, z: Infinity };
  const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const { corner, far } of turned) {
    lo.x = Math.min(lo.x, corner.x);
    lo.y = Math.min(lo.y, corner.y);
    lo.z = Math.min(lo.z, corner.z);
    hi.x = Math.max(hi.x, far.x);
    hi.y = Math.max(hi.y, far.y);
    hi.z = Math.max(hi.z, far.z);
  }
  const at = rotateVector(turn, socket);
  const size = { w: (hi.x - lo.x) / LDU_PER_STUD, h: (hi.y - lo.y) / LDU_PER_PLATE, d: (hi.z - lo.z) / LDU_PER_STUD };
  return {
    payload: {
      bricks: turned.map(({ brick, corner, r }) => ({
        ...brick,
        r,
        x: snapToLdu((corner.x - lo.x) / LDU_PER_STUD, LDU_PER_STUD_STEP),
        y: snapToLdu((corner.y - lo.y) / LDU_PER_PLATE, LDU_PER_PLATE_STEP),
        z: snapToLdu((corner.z - lo.z) / LDU_PER_STUD, LDU_PER_STUD_STEP),
      })),
      size,
      grab: { x: size.w / 2, y: size.h / 2, z: size.d / 2 },
    },
    socket: { x: at.x - lo.x, y: at.y - lo.y, z: at.z - lo.z },
  };
}

/**
 * Where on its underside a payload fits onto a stud, in LDraw units, in
 * its own frame: the middle of the cell of its bottom under the point it is
 * held by.
 */
function socketOf(payload: Payload): Vec3 {
  const cell = (held: number, size: number): number => Math.min(Math.max(Math.floor(held), 0), Math.max(Math.ceil(size) - 1, 0)) + 0.5;
  return { x: cell(payload.grab.x, payload.size.w) * LDU_PER_STUD, y: 0, z: cell(payload.grab.z, payload.size.d) * LDU_PER_STUD };
}

export interface Attachment {
  /** The payload as it goes on the stud: turned to face out from it. */
  readonly payload: Payload;
  /** Where its corner goes, x and z in studs and y in plates, on the LDraw unit lattice. */
  readonly offset: Vec3;
}

/**
 * Where a payload goes on the stud of `brick` nearest the hit point, among
 * those facing out of the face that was hit; null when that face has none,
 * or when it is the top of an upright brick on the grid, which takes its
 * payloads by the cell grid instead.
 */
export function attachToStuds(hit: Hit, brick: Brick, payload: Payload, lookup: PartLookup): Attachment | null {
  const facing = facingOfVector(hit.normal);
  if (!facing || (facing === '+y' && isOnGrid(brick))) return null;
  const studs = brickStudPoints(brick, lookup).filter((stud) => stud.facing === facing);
  if (studs.length === 0) return null;
  const distance = (stud: StudPoint): number => Math.hypot(stud.at.x - hit.point.x, stud.at.y - hit.point.y, stud.at.z - hit.point.z);
  const stud = studs.reduce((near, s) => (distance(s) < distance(near) ? s : near));
  const turned = turnPayload(payload, turnTowards(payloadUp(payload), facing), socketOf(payload), lookup);
  const at = { x: stud.at.x * LDU_PER_UNIT, y: stud.at.y * LDU_PER_UNIT, z: stud.at.z * LDU_PER_UNIT };
  return {
    payload: turned.payload,
    offset: {
      x: snapToLdu((at.x - turned.socket.x) / LDU_PER_STUD, LDU_PER_STUD_STEP),
      y: snapToLdu((at.y - turned.socket.y) / LDU_PER_PLATE, LDU_PER_PLATE_STEP),
      z: snapToLdu((at.z - turned.socket.z) / LDU_PER_STUD, LDU_PER_STUD_STEP),
    },
  };
}
