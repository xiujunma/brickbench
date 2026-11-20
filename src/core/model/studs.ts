import { rotateCell } from '../grid';
import type { PartLookup } from '../parts/types';
import { requirePart } from './geometry';
import type { SpatialIndex } from './spatial';
import type { Brick } from './types';

/** A stud standing on top of cell (x, z); y is the layer of the face it stands on. */
export interface StudInstance {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly colorId: number;
}

/** Every stud of the given bricks, covered or not (for selections and previews). */
export function allStuds(bricks: Iterable<Brick>, lookup: PartLookup): StudInstance[] {
  return visibleStuds(bricks, null, lookup);
}

/**
 * Lists the studs worth drawing: studs pressed into an opaque brick above are
 * hidden, which removes most stud geometry from dense models. Without an
 * index, every stud is listed; without `isOpaqueOwner` every brick above
 * counts as opaque. Excluded bricks
 * neither contribute studs nor hide anyone else's.
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
    const part = requirePart(lookup, brick.partId);
    const top = brick.y + part.h;
    for (const [lx, lz] of part.studs) {
      const [dx, dz] = rotateCell(lx, lz, part.w, part.d, brick.r);
      const x = brick.x + dx;
      const z = brick.z + dz;
      // what sits on the stud's centre, which may be half a stud over
      const cover = index?.ownerAt(x + 0.5, top, z + 0.5);
      const hidden = cover !== undefined && !exclude.has(cover) && (isOpaqueOwner?.(cover) ?? true);
      if (!hidden) studs.push({ x, y: top, z, colorId: brick.colorId });
    }
  }
  return studs;
}
