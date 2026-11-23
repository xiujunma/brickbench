/**
 * What the tests of plugging parts together share (connect.test.ts,
 * connectWays.test.ts): asking where a test part (../model/connectorTestParts)
 * plugs in at a cursor, and the box it ends up in.
 */
import { PLATE_HEIGHT, type Vec3 } from '../grid';
import { connectorLookup as lookup } from '../model/connectorTestParts';
import { brickCellBox } from '../model/geometry';
import type { Brick } from '../model/types';
import { attachToConnector, type ConnectTurn } from './connect';
import { materialize, payloadFromPart } from './payload';
import type { Hit } from './ray';

/** As the part is drawn: neither R nor T pressed, no connection chosen. */
export const STILL: ConnectTurn = { spin: 0, flipped: false };

export const UP = { x: 0, y: 1, z: 0 };

/** The cursor on a brick: where, and the way the face under it looks. */
export function hit(point: Vec3, normal: Vec3, brickId: string): Hit {
  return { kind: 'brick', brickId, point, normal, t: 1, base: 0 };
}

/** Where `partId` plugs into `target` at the cursor, and whether it has room there, or null; `others` are the bricks already there besides the target. */
export function ask(target: Brick, partId: string, point: Vec3, normal: Vec3, turned: ConnectTurn, id: string, others: readonly Brick[]): { readonly brick: Brick; readonly free: boolean } | null {
  const part = lookup(partId);
  if (!part) throw new Error(partId);
  const attached = attachToConnector(hit(point, normal, target.id), target, payloadFromPart(part, 4, 0), turned, lookup, [target, ...others]);
  const [brick] = attached ? materialize(attached.payload, attached.offset, () => id) : [];
  return attached && brick ? { brick, free: attached.free } : null;
}

/** Builds `partId` plugged into `target` at the cursor, where it has room; null where it does not plug in, or has none. */
export function plug(target: Brick, partId: string, point: Vec3, normal: Vec3, turned: ConnectTurn = STILL, id = 'new', others: readonly Brick[] = []): Brick | null {
  const asked = ask(target, partId, point, normal, turned, id, others);
  return asked?.free ? asked.brick : null;
}

/** A brick's box in the world, in studs on every axis, to 0.001. */
export function box(brick: Brick): { x: number[]; y: number[]; z: number[] } {
  const cells = brickCellBox(brick, lookup);
  const r = (v: number) => Math.round(v * 1000) / 1000 + 0;
  return { x: [r(cells.x0), r(cells.x1)], y: [r(cells.y0 * PLATE_HEIGHT), r(cells.y1 * PLATE_HEIGHT)], z: [r(cells.z0), r(cells.z1)] };
}
