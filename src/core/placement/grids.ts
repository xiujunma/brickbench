/**
 * Where things can go against a placed brick: bricks stand on whole studs,
 * or half a stud over, so each brick's body sits on a grid that may be
 * half a stud off, and the studs on its top on another, half a stud
 * further along a jumper plate's axes.
 */
import type { Brick } from '../model/types';
import type { PartLookup } from '../parts/types';
import type { Payload } from './payload';

/** How far a grid sits off whole studs, along x and z: 0, or half a stud. */
export interface StudPhase {
  readonly x: number;
  readonly z: number;
}

export const ON_STUDS: StudPhase = { x: 0, z: 0 };

/** A brick's grids: its body's, for building beside or under it, and its top studs', for building on it. */
export interface BrickGrids {
  readonly body: StudPhase;
  readonly top: StudPhase;
}

export const GROUND_GRIDS: BrickGrids = { body: ON_STUDS, top: ON_STUDS };

/** The part of a stud a position is off whole studs: 0, or 0.5 for a position half a stud over. */
export function phaseOf(value: number): number {
  const phase = value - Math.floor(value);
  return phase === 1 ? 0 : phase;
}

/** The grids of a placed brick; a part whose studs sit between cells (studOffset) shifts its top grid half a stud. */
export function gridsOf(brick: Brick, lookup: PartLookup): BrickGrids {
  const [ox, oz] = lookup(brick.partId)?.studOffset ?? [0, 0];
  // turned a quarter, its own x lies along z
  const [wx, wz] = brick.r % 2 === 0 ? [ox, oz] : [oz, ox];
  return {
    body: { x: phaseOf(brick.x), z: phaseOf(brick.z) },
    top: { x: phaseOf(brick.x + wx), z: phaseOf(brick.z + wz) },
  };
}

/** Where a payload's offset must sit for its lowest brick, which meets the surface, to stand on `grid`. */
export function offsetPhase(payload: Payload, grid: StudPhase): StudPhase {
  const lowest = payload.bricks.reduce<Payload['bricks'][number] | undefined>((low, brick) => (low && low.y <= brick.y ? low : brick), undefined);
  return { x: phaseOf(grid.x - (lowest?.x ?? 0)), z: phaseOf(grid.z - (lowest?.z ?? 0)) };
}
