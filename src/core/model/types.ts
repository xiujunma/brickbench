import type { InstructionPlan } from '../instructions/plan';
import type { Orientation, Turn } from '../orientation';

/**
 * A placed part. (x, y, z) is the minimum corner of the box it fills, x and
 * z in studs and y in plates, and r is the way it faces (0 to 3: upright,
 * turned that many quarter turns; see ../orientation). Upright bricks stand
 * on whole or half studs and whole plates; parts on their sides, and parts
 * built on them, may sit anywhere on the LDraw unit lattice.
 */
export interface Brick {
  readonly id: string;
  readonly partId: string;
  readonly colorId: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly r: Orientation;
  /**
   * A part at an angle, or plugged into another (a pin in a hole, a wheel
   * on its axle): its exact rotation, row by row, which r then gives way
   * to. Such loose parts stand anywhere and take no part in collisions.
   */
  readonly m?: Turn | undefined;
}

export interface Model {
  readonly bricks: ReadonlyMap<string, Brick>;
  /** The building instructions as the user arranged them; planned automatically when absent. */
  readonly plan?: InstructionPlan;
}
