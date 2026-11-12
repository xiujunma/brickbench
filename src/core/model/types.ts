import type { Rotation } from '../grid';

/**
 * A placed part. (x, z) is the minimum corner of its rotated footprint in
 * studs and y is its bottom layer in plates, so every brick sits on the grid.
 */
export interface Brick {
  readonly id: string;
  readonly partId: string;
  readonly colorId: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly r: Rotation;
}

export interface Model {
  readonly bricks: ReadonlyMap<string, Brick>;
}
