import type { Rotation } from '../core/grid';
import type { ModelDocument } from '../core/io/modelFile';
import type { IdFactory } from '../core/model/ids';
import { modelFromBricks } from '../core/model/model';
import type { Brick } from '../core/model/types';

const WHITE = 15;
const GLASS = 43;
const ROOF = 320;
const RIDGE = 72;
const ROOF_BASE = 71;
const TAN = 19;
const BROWN = 70;
const GREEN = 2;
const BRIGHT_GREEN = 10;
const LIME = 27;
const RED = 4;
const YELLOW = 14;
const BLACK = 0;
const LAMP = 46;
const WATER = 33;
const STONE = 71;

type Place = (partId: string, colorId: number, x: number, y: number, z: number, r?: Rotation) => void;

function walls(add: Place): void {
  // front wall (z = -4) with a door under an arch
  add('brick-1x4', WHITE, -6, 0, -4);
  add('brick-1x1', WHITE, -2, 0, -4);
  add('brick-1x1', WHITE, 1, 0, -4);
  add('brick-1x4', WHITE, 2, 0, -4);
  add('brick-1x1', WHITE, -6, 3, -4);
  add('brick-1x2', GLASS, -5, 3, -4);
  add('brick-1x2', WHITE, -3, 3, -4);
  add('brick-1x2', WHITE, 1, 3, -4);
  add('brick-1x2', GLASS, 3, 3, -4);
  add('brick-1x1', WHITE, 5, 3, -4);
  add('brick-1x4', WHITE, -6, 6, -4);
  add('arch-1x4', TAN, -2, 6, -4);
  add('brick-1x4', WHITE, 2, 6, -4);
  // back wall (z = 3)
  add('brick-1x12', WHITE, -6, 0, 3);
  add('brick-1x4', WHITE, -6, 3, 3);
  add('brick-1x2', GLASS, -2, 3, 3);
  add('brick-1x6', WHITE, 0, 3, 3);
  add('brick-1x12', WHITE, -6, 6, 3);
  // side walls run along Z
  for (const x of [-6, 5]) {
    add('brick-1x6', WHITE, x, 0, -3, 1);
    add('brick-1x2', WHITE, x, 3, -3, 1);
    add('brick-1x2', GLASS, x, 3, -1, 1);
    add('brick-1x2', WHITE, x, 3, 1, 1);
    add('brick-1x6', WHITE, x, 6, -3, 1);
  }
}

function roof(add: Place): void {
  add('plate-6x12', ROOF_BASE, -6, 9, -4);
  add('plate-2x12', ROOF_BASE, -6, 9, 2);
  for (const x of [-6, -2, 2]) {
    add('slope45-2x4', ROOF, x, 10, -4, 2);
    add('brick-2x4', ROOF, x, 10, -2);
    add('brick-2x4', ROOF, x, 10, 0);
    add('slope45-2x4', ROOF, x, 10, 2);
    add('slope45-2x4', ROOF, x, 13, -2, 2);
    add('slope45-2x4', ROOF, x, 13, 0);
    add('tile-2x4', RIDGE, x, 16, -1);
  }
}

function garden(add: Place): void {
  for (const z of [-6, -8, -10]) add('tile-2x2', TAN, -1, 0, z);
  // tree
  add('round-brick-2x2', BROWN, 9, 0, -8);
  add('round-brick-2x2', BROWN, 9, 3, -8);
  add('plate-4x4', GREEN, 8, 6, -9);
  add('round-brick-2x2', BRIGHT_GREEN, 9, 7, -8);
  add('round-plate-2x2', GREEN, 9, 10, -8);
  add('cone-1x1', LIME, 9, 11, -8);
  add('round-plate-1x1', BRIGHT_GREEN, 10, 11, -7);
  // flowers
  add('round-plate-1x1', RED, -5, 0, -6);
  add('round-plate-1x1', YELLOW, -4, 0, -7);
  add('round-plate-1x1', RED, -6, 0, -7);
  add('round-plate-1x1', YELLOW, 3, 0, -6);
  // lamp post
  for (const y of [0, 3, 6]) add('round-brick-1x1', BLACK, 4, y, -8);
  add('round-plate-1x1', LAMP, 4, 9, -8);
  add('cone-1x1', BLACK, 4, 10, -8);
  // pond with stones
  for (const [x, z] of [[-13, -3], [-11, -3], [-13, -1], [-11, -1]] as const) add('tile-2x2', WATER, x, 0, z);
  add('slope30-1x1', STONE, -14, 0, -2, 1);
  add('slope30-1x1', STONE, -12, 0, -4);
  add('slope30-1x2', STONE, -12, 0, 1, 2);
  add('slope30-1x1', STONE, -9, 0, -2, 3);
}

/** A small cottage that shows off most part families. */
export function cottageSample(nextId: IdFactory): ModelDocument {
  const bricks: Brick[] = [];
  const add: Place = (partId, colorId, x, y, z, r = 0) => {
    bricks.push({ id: nextId(), partId, colorId, x, y, z, r });
  };
  walls(add);
  roof(add);
  garden(add);
  return {
    name: 'Garden cottage',
    settings: { baseplateSize: 32, baseplateColor: GREEN },
    model: modelFromBricks(bricks),
  };
}
