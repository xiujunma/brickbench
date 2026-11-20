import { LDU_PER_UNIT, type Vec3 } from '../grid';
import { facingOf, facingVector, rotateVector, type Orientation } from '../orientation';
import type { PartLookup } from '../parts/types';
import { LDU_PER_PLATE, LDU_PER_STUD, brickOriginLdu, requirePart } from './geometry';
import type { SpatialIndex } from './spatial';
import type { Brick } from './types';

/**
 * A stud drawn on its own (the built-in parts' studs; library parts carry
 * theirs in their meshes): where its base sits, in world units, and which
 * way it faces, as the brick it stands on does.
 */
export interface StudInstance {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The orientation of its brick: 0 to 3 stand up. */
  readonly r: Orientation;
  readonly colorId: number;
}

/** How far out from a stud's base a brick that covers it is looked for: inside the stud, in world units. */
const INSIDE_STUD = 0.1;

/** Every stud of the given bricks, covered or not (for selections and previews). */
export function allStuds(bricks: Iterable<Brick>, lookup: PartLookup): StudInstance[] {
  return visibleStuds(bricks, null, lookup);
}

/** The brick a stud is pressed into, if one is: whatever fills the space just out from its base. */
export function studCover(stud: StudInstance, index: SpatialIndex): string | undefined {
  const out = facingVector(facingOf(stud.r));
  return index.ownerAtPoint({ x: stud.x + out.x * INSIDE_STUD, y: stud.y + out.y * INSIDE_STUD, z: stud.z + out.z * INSIDE_STUD });
}

/** Where each stud of a brick stands: the middle of each studded cell of its top, turned as the brick is (worked out in LDraw units, exactly). */
function studsOf(brick: Brick, lookup: PartLookup): Vec3[] {
  const part = requirePart(lookup, brick.partId);
  if (part.studs.length === 0) return [];
  const origin = brickOriginLdu(brick, lookup);
  const top = part.h * LDU_PER_PLATE;
  return part.studs.map(([lx, lz]) => {
    const local = { x: (lx + 0.5) * LDU_PER_STUD - (part.w * LDU_PER_STUD) / 2, y: top, z: (lz + 0.5) * LDU_PER_STUD - (part.d * LDU_PER_STUD) / 2 };
    const turned = rotateVector(brick.r, local);
    return { x: (origin.x + turned.x) / LDU_PER_UNIT + 0, y: (origin.y + turned.y) / LDU_PER_UNIT + 0, z: (origin.z + turned.z) / LDU_PER_UNIT + 0 };
  });
}

/**
 * Lists the studs worth drawing: studs pressed into an opaque brick are
 * hidden, which removes most stud geometry from dense models. Without an
 * index, every stud is listed; without `isOpaqueOwner` every brick that
 * covers one counts as opaque. Excluded bricks neither contribute studs nor
 * hide anyone else's.
 */
export function visibleStuds(
  bricks: Iterable<Brick>,
  index: SpatialIndex | null,
  lookup: PartLookup,
  isOpaqueOwner?: (brickId: string) => boolean,
  exclude: ReadonlySet<string> = new Set(),
): StudInstance[] {
  const studs: StudInstance[] = [];
  for (const brick of bricks) {
    if (exclude.has(brick.id)) continue;
    for (const at of studsOf(brick, lookup)) {
      const stud: StudInstance = { x: at.x, y: at.y, z: at.z, r: brick.r, colorId: brick.colorId };
      const cover = index ? studCover(stud, index) : undefined;
      const hidden = cover !== undefined && !exclude.has(cover) && (isOpaqueOwner?.(cover) ?? true);
      if (!hidden) studs.push(stud);
    }
  }
  return studs;
}
