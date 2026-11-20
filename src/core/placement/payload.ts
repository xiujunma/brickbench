import { PLATE_HEIGHT, type Vec3 } from '../grid';
import { groupCellBox, rotateGroup, turnedSize } from '../model/geometry';
import type { Orientation } from '../orientation';
import type { IdFactory } from '../model/ids';
import type { Brick } from '../model/types';
import type { PartDef, PartLookup } from '../parts/types';

export type PayloadBrick = Omit<Brick, 'id'>;

/**
 * Bricks being placed or moved, positioned relative to the minimum corner of
 * their bounding box. `grab` is the point (in cells, fractional) that follows
 * the cursor.
 */
export interface Payload {
  readonly bricks: readonly PayloadBrick[];
  readonly size: { readonly w: number; readonly h: number; readonly d: number };
  readonly grab: Vec3;
}

function centreGrab(size: Payload['size']): Vec3 {
  return { x: size.w / 2, y: size.h / 2, z: size.d / 2 };
}

export function payloadFromPart(part: PartDef, colorId: number, r: Orientation): Payload {
  const size = turnedSize(part, r);
  return {
    bricks: [{ partId: part.id, colorId, x: 0, y: 0, z: 0, r }],
    size,
    grab: centreGrab(size),
  };
}

/**
 * Builds a payload from placed bricks. Pass the world point where the user
 * grabbed them to keep that point under the cursor; otherwise the payload
 * is held by its centre.
 */
export function payloadFromBricks(bricks: readonly Brick[], lookup: PartLookup, grabWorld?: Vec3): Payload {
  const bounds = groupCellBox(bricks, lookup);
  const size = { w: bounds.x1 - bounds.x0, h: bounds.y1 - bounds.y0, d: bounds.z1 - bounds.z0 };
  const grab = grabWorld
    ? { x: grabWorld.x - bounds.x0, y: grabWorld.y / PLATE_HEIGHT - bounds.y0, z: grabWorld.z - bounds.z0 }
    : centreGrab(size);
  return {
    bricks: bricks.map(({ partId, colorId, x, y, z, r, m }) => ({
      partId,
      colorId,
      x: x - bounds.x0,
      y: y - bounds.y0,
      z: z - bounds.z0,
      r,
      ...(m ? { m } : {}),
    })),
    size,
    grab,
  };
}

/** Id factory handing out the given ids in order, so a moved group keeps its identity. */
export function reuseIds(ids: readonly string[]): IdFactory {
  let n = 0;
  return () => {
    const id = ids[n] ?? `extra-${n}`;
    n += 1;
    return id;
  };
}

/** Places payload bricks at a grid offset with fresh ids. */
export function materialize(payload: Payload, offset: Vec3, nextId: IdFactory): Brick[] {
  return payload.bricks.map((b) => ({
    ...b,
    id: nextId(),
    x: b.x + offset.x,
    y: b.y + offset.y,
    z: b.z + offset.z,
  }));
}

/** Turns a payload a quarter turn; the grab point moves to the new centre. */
export function rotatePayload(payload: Payload, lookup: PartLookup, dir: 1 | -1): Payload {
  const placed = payload.bricks.map((b, i) => ({ ...b, id: `p${i}` }));
  const turned = rotateGroup(placed, lookup, dir);
  const normalized = payloadFromBricks(turned, lookup);
  return { ...normalized, grab: centreGrab(normalized.size) };
}

export function recolorPayload(payload: Payload, colorId: number): Payload {
  return { ...payload, bricks: payload.bricks.map((b) => ({ ...b, colorId })) };
}
