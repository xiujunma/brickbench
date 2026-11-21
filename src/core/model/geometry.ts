import { LDU_PER_STUD_STEP, LDU_PER_UNIT, PLATE_HEIGHT, cleanZero, isStudPosition, snapToLdu, type Vec3 } from '../grid';
import {
  compose,
  isUpright,
  multiplyTurns,
  nearestOrientation,
  orthonormalize,
  quarterTurn,
  rotateBy,
  rotateVector,
  turnAbout,
  turnOf,
  type Orientation,
  type Turn,
} from '../orientation';
import type { CellBox, Connector, ConnectorKind, PartDef, PartLookup } from '../parts/types';
import type { Brick } from './types';

export interface Aabb {
  readonly min: Vec3;
  readonly max: Vec3;
}

export function requirePart(lookup: PartLookup, partId: string): PartDef {
  const part = lookup(partId);
  if (!part) throw new Error(`Unknown part: ${partId}`);
  return part;
}

/** LDraw units per stud, along x and z, and per plate, along y: the exact lattice parts are placed on. */
export const LDU_PER_STUD = LDU_PER_UNIT;
export const LDU_PER_PLATE = Math.round(PLATE_HEIGHT * LDU_PER_UNIT);

/** A box in LDraw units on the world's axes (y up), half-open, as world solids are compared exactly. */
export interface LduBox {
  readonly x0: number;
  readonly y0: number;
  readonly z0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z1: number;
}

/** What places a part: which part, where its box starts, and how it is turned. */
export type PlacedPart = Pick<Brick, 'partId' | 'x' | 'y' | 'z' | 'r' | 'm'>;

/** A loose part: at an angle, or plugged into another, placed exactly and taking no part in collisions. */
export function isLoose(brick: Pick<Brick, 'm'>): boolean {
  return brick.m !== undefined;
}

/** The rotation a brick makes: its exact one when loose, its orientation's otherwise. */
export function brickTurn(brick: Pick<Brick, 'r' | 'm'>): Turn {
  return brick.m ?? turnOf(brick.r);
}

/**
 * Whether a brick stands on the cell grid: upright, on whole or half studs
 * and whole plates, as every brick did before parts could turn on their
 * sides. Others (turned, or placed between) collide by exact boxes.
 */
export function isOnGrid(brick: Pick<Brick, 'x' | 'y' | 'z' | 'r' | 'm'>): boolean {
  return !isLoose(brick) && isUpright(brick.r) && isStudPosition(brick.x) && Number.isInteger(brick.y) && isStudPosition(brick.z);
}

/** A brick's position (its box's minimum corner) in LDraw units: on whole units, unless the brick is loose. */
export function lduPosition(brick: Pick<Brick, 'x' | 'y' | 'z' | 'm'>): Vec3 {
  const at = { x: brick.x * LDU_PER_STUD, y: brick.y * LDU_PER_PLATE, z: brick.z * LDU_PER_STUD };
  return isLoose(brick) ? at : { x: Math.round(at.x), y: Math.round(at.y), z: Math.round(at.z) };
}

/** A part's box, or one of its solids, in LDraw units around the part's origin: the middle of its footprint, at its bottom. */
function localBox(part: PartDef, cells: CellBox): LduBox {
  const halfW = (part.w * LDU_PER_STUD) / 2;
  const halfD = (part.d * LDU_PER_STUD) / 2;
  return {
    x0: cells.x0 * LDU_PER_STUD - halfW,
    y0: cells.y0 * LDU_PER_PLATE,
    z0: cells.z0 * LDU_PER_STUD - halfD,
    x1: cells.x1 * LDU_PER_STUD - halfW,
    y1: cells.y1 * LDU_PER_PLATE,
    z1: cells.z1 * LDU_PER_STUD - halfD,
  };
}

function wholeBox(part: PartDef): CellBox {
  return { x0: 0, y0: 0, z0: 0, x1: part.w, y1: part.h, z1: part.d };
}

/** The box a local box fills once turned, around the same origin: exactly, square to the grid; the box around it, at an angle. */
function turnBox(turn: Turn, box: LduBox): LduBox {
  let [x0, y0, z0, x1, y1, z1] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const x of [box.x0, box.x1]) {
    for (const y of [box.y0, box.y1]) {
      for (const z of [box.z0, box.z1]) {
        const p = rotateBy(turn, { x, y, z });
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        z0 = Math.min(z0, p.z);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
        z1 = Math.max(z1, p.z);
      }
    }
  }
  // + 0 turns -0 into 0
  return { x0: x0 + 0, y0: y0 + 0, z0: z0 + 0, x1: x1 + 0, y1: y1 + 0, z1: z1 + 0 };
}

/** An orientation's rotation, or a rotation as it is. */
function asTurn(turn: Orientation | Turn): Turn {
  return typeof turn === 'number' ? turnOf(turn) : turn;
}

function shift(box: LduBox, by: Vec3): LduBox {
  return { x0: box.x0 + by.x, y0: box.y0 + by.y, z0: box.z0 + by.z, x1: box.x1 + by.x, y1: box.y1 + by.y, z1: box.z1 + by.z };
}

/** Where a brick's part origin sits in the world, in LDraw units: its position, less where its turned box starts. */
export function brickOriginLdu(brick: PlacedPart, lookup: PartLookup): Vec3 {
  return originLdu(brick, requirePart(lookup, brick.partId));
}

function originLdu(brick: PlacedPart, part: PartDef): Vec3 {
  const turned = turnBox(brickTurn(brick), localBox(part, wholeBox(part)));
  const at = lduPosition(brick);
  return { x: at.x - turned.x0, y: at.y - turned.y0, z: at.z - turned.z0 };
}

function toCells(box: LduBox): CellBox {
  return {
    x0: box.x0 / LDU_PER_STUD + 0,
    y0: box.y0 / LDU_PER_PLATE + 0,
    z0: box.z0 / LDU_PER_STUD + 0,
    x1: box.x1 / LDU_PER_STUD + 0,
    y1: box.y1 / LDU_PER_PLATE + 0,
    z1: box.z1 / LDU_PER_STUD + 0,
  };
}

/** Where a part's box starts once turned, from its origin, in world units (studs, on every axis). */
export function turnedCorner(part: PartDef, turn: Orientation | Turn): Vec3 {
  const box = turnBox(asTurn(turn), localBox(part, wholeBox(part)));
  return { x: box.x0 / LDU_PER_UNIT + 0, y: box.y0 / LDU_PER_UNIT + 0, z: box.z0 / LDU_PER_UNIT + 0 };
}

/** The size a part's box takes in the world once turned: x and z in studs, y in plates. */
export function turnedSize(part: PartDef, turn: Orientation | Turn): { readonly w: number; readonly h: number; readonly d: number } {
  const box = toCells(turnBox(asTurn(turn), localBox(part, wholeBox(part))));
  return { w: box.x1 - box.x0, h: box.y1 - box.y0, d: box.z1 - box.z0 };
}

/** The world boxes, in LDraw units, of the cells a brick fills (arches leave their opening out). */
export function brickLduSolids(brick: Brick, lookup: PartLookup): LduBox[] {
  const part = requirePart(lookup, brick.partId);
  const origin = originLdu(brick, part);
  const turn = brickTurn(brick);
  return part.solids.map((solid) => shift(turnBox(turn, localBox(part, solid)), origin));
}

/** The boxes a part fills in its own frame, around its origin, in world units: what a loose part is picked by, once turned. */
export function partLocalBoxes(part: PartDef): Aabb[] {
  return part.solids.map((solid) => {
    const box = localBox(part, solid);
    return {
      min: { x: box.x0 / LDU_PER_UNIT, y: box.y0 / LDU_PER_UNIT, z: box.z0 / LDU_PER_UNIT },
      max: { x: box.x1 / LDU_PER_UNIT, y: box.y1 / LDU_PER_UNIT, z: box.z1 / LDU_PER_UNIT },
    };
  });
}

/**
 * The halves of hinges that end in the round of their pivot: fingers, a
 * knuckle or a barrel, at an end or an edge of the part, the part itself
 * all to one side of it. Such a part is round there (shapeOf), and R turns
 * it up about the pivot (liftingWay in connections.ts).
 */
export const ROUND_PIVOTS: readonly ConnectorKind[] = ['finger', 'fork', 'fingers2', 'fingers3', 'hingetop', 'fingers4', 'fingers5', 'foldbase', 'foldtop', 'stick', 'tongue', 'yoke'];

/**
 * How much further a part's box may reach beyond a pivot than its knuckle
 * is round, and the part still end in that knuckle, in LDraw units. Cells
 * reach 2 past the knuckle of a 2 × 9 folding hinge plate, and drawing
 * leaves a tenth or two elsewhere; a plate that carries a finger on its
 * top runs on 4 and more past the finger's round, and is no knuckle there.
 */
const KNUCKLE_SLACK = 3;

/** The round of a hinge about its pivot, in a part's own frame, in LDraw units: a cylinder about the pivot's middle, `reach` either way along it. */
interface Knuckle {
  readonly at: Vec3;
  readonly axis: Vec3;
  readonly reach: number;
  readonly radius: number;
}

/** A part's shape for telling how low it reaches (shapeOf): what is left of its box, and its knuckles. */
interface Shape {
  readonly boxes: readonly LduBox[];
  readonly knuckles: readonly Knuckle[];
}

type Axis = 'x' | 'y' | 'z';
const AXES: readonly Axis[] = ['x', 'y', 'z'];

/**
 * A knuckle, and where the part lies from its pivot: on along `side`, up it
 * (1) or down it (-1); `beside` is the level axis square to the pivot.
 */
interface Hinged extends Knuckle {
  readonly side: Axis;
  readonly up: 1 | -1;
  readonly beside: Axis;
}

/** A box by its least and greatest corners. */
interface Corners {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** The round of a part about one of its connections, when that is a hinge's pivot across the part (ROUND_PIVOTS), in a box from `min` to `max`. */
function hingedAt({ kind, at, axis, length }: Connector, { min, max }: Corners): Hinged[] {
  // across the part: along its width or its depth
  const along = AXES.find((k) => k !== 'y' && Math.abs(axis[k]) > 0.999);
  if (!ROUND_PIVOTS.includes(kind) || !along) return [];
  const pivot = { x: at.x * LDU_PER_UNIT, y: at.y * LDU_PER_UNIT, z: at.z * LDU_PER_UNIT };
  const beside = along === 'x' ? 'z' : 'x';
  // the side of the pivot the part's middle lies on, by how far across its box that is
  const towards = (k: Axis): number => ((min[k] + max[k]) / 2 - pivot[k]) / Math.max(max[k] - min[k], 1e-9);
  const side = Math.abs(towards(beside)) >= Math.abs(towards('y')) ? beside : 'y';
  const up = towards(side) > 0 ? 1 : -1;
  // as large about the pivot as fits in the box
  const radius = Math.max(0, Math.min(pivot.y - min.y, max.y - pivot.y, pivot[beside] - min[beside], max[beside] - pivot[beside]));
  // a pivot at the part's middle has it all round it; and where the box goes on beyond the pivot further than that round reaches, more
  // of the part than a knuckle lies there, as a plate does under a finger on its top: such a part is taken for its whole box
  const beyond = up > 0 ? pivot[side] - min[side] : max[side] - pivot[side];
  if (Math.abs(towards(side)) < 1e-6 || beyond > radius + KNUCKLE_SLACK) return [];
  return [{ at: pivot, axis, reach: (length * LDU_PER_UNIT) / 2, radius, side, up, beside }];
}

/** The part of a box between `from` and `to` along one axis, if any. */
function slice(box: Corners, k: Axis, from: number, to: number): Corners[] {
  const [lo, hi] = [Math.max(box.min[k], from), Math.min(box.max[k], to)];
  return hi - lo > 1e-9 ? [{ min: { ...box.min, [k]: lo }, max: { ...box.max, [k]: hi } }] : [];
}

/**
 * What a knuckle leaves of a box: the box on the part's side of the pivot;
 * and of what lies beyond a pivot at the part's bottom or top, all but the
 * corner the knuckle is, as far to either side of the pivot as it is
 * round. Beyond a pivot at a part's end there is nothing left: a plate or
 * a brick with a hinge on its end is all knuckle there.
 */
function without(box: Corners, { at, side, up, radius, beside }: Hinged): Corners[] {
  const kept = up > 0 ? slice(box, side, at[side], Infinity) : slice(box, side, -Infinity, at[side]);
  if (side !== 'y') return kept;
  const beyond = up > 0 ? slice(box, 'y', -Infinity, at.y) : slice(box, 'y', at.y, Infinity);
  return [...kept, ...beyond.flatMap((layer) => [...slice(layer, beside, -Infinity, at[beside] - radius), ...slice(layer, beside, at[beside] + radius, Infinity)])];
}

/**
 * A part's shape for telling how low it reaches at an angle: the box of its
 * extent, or of its cells, and no more of it than the part is. Where the
 * part hinges about a pivot across it, it is round about the pivot: its box
 * stops there, on the side away from its middle, and its knuckle, a
 * cylinder about the pivot, stands in for what lay beyond (without). So a
 * plate lifted on the hinge at its end does not go under the ground by the
 * corner its box has there.
 */
function shapeOf(part: PartDef): Shape {
  const extent = part.extent ?? { min: { x: -part.w / 2, y: 0, z: -part.d / 2 }, max: { x: part.w / 2, y: part.h * PLATE_HEIGHT, z: part.d / 2 } };
  const inLdu = (v: Vec3): Vec3 => ({ x: v.x * LDU_PER_UNIT, y: v.y * LDU_PER_UNIT, z: v.z * LDU_PER_UNIT });
  const whole = { min: inLdu(extent.min), max: inLdu(extent.max) };
  const knuckles = (part.connectors ?? []).flatMap((connector) => hingedAt(connector, whole));
  const left = knuckles.reduce<Corners[]>((boxes, knuckle) => boxes.flatMap((box) => without(box, knuckle)), [whole]);
  return { boxes: left.map(({ min, max }) => ({ x0: min.x, y0: min.y, z0: min.z, x1: max.x, y1: max.y, z1: max.z })), knuckles };
}

const shapes = new WeakMap<PartDef, Shape>();

/**
 * How low a brick really reaches, in plates. A brick square to the grid,
 * by its cells. A loose part by its shape (shapeOf): its extent, which a
 * bar's is well inside the whole cells of its box, and round about a hinge
 * it has; with neither, by its box.
 */
export function brickFloor(brick: PlacedPart, lookup: PartLookup): number {
  const part = requirePart(lookup, brick.partId);
  if (!isLoose(brick)) return brickCellBox(brick, lookup).y0;
  const shape = shapes.get(part) ?? shapeOf(part);
  shapes.set(part, shape);
  if (!part.extent && shape.knuckles.length === 0) return brickCellBox(brick, lookup).y0;
  const turn = brickTurn(brick);
  const lows = [
    ...shape.boxes.map((box) => turnBox(turn, box).y0),
    // the lower end of each knuckle's middle line, less how far down its round reaches from there
    ...shape.knuckles.map(({ at, axis, reach, radius }) => {
      const way = rotateBy(turn, axis);
      return rotateBy(turn, at).y - Math.abs(way.y) * reach - radius * Math.hypot(way.x, way.z);
    }),
  ];
  return (originLdu(brick, part).y + Math.min(...lows)) / LDU_PER_PLATE;
}

/** World-grid box covering a brick's whole footprint and height (x and z in studs, y in plates). */
export function brickCellBox(brick: PlacedPart, lookup: PartLookup): CellBox {
  const part = requirePart(lookup, brick.partId);
  return toCells(shift(turnBox(brickTurn(brick), localBox(part, wholeBox(part))), originLdu(brick, part)));
}

/** How near two boxes' corners must be to be the same, in LDraw units. */
const SAME_CORNER = 0.01;

/** The corners of the box a placed part fills, in LDraw units, at whatever angle it stands. */
function boxCorners(brick: PlacedPart, part: PartDef): Vec3[] {
  const box = localBox(part, wholeBox(part));
  const origin = originLdu(brick, part);
  const turn = brickTurn(brick);
  return [box.x0, box.x1].flatMap((x) =>
    [box.y0, box.y1].flatMap((y) =>
      [box.z0, box.z1].map((z) => {
        const corner = rotateBy(turn, { x, y, z });
        return { x: origin.x + corner.x, y: origin.y + corner.y, z: origin.z + corner.z };
      }),
    ),
  );
}

/**
 * Whether two placed parts fill one and the same box, however each is
 * turned in it: two heads on one neck do, and so do the top and the base of
 * a 2 × 2 turntable, a plate high between them.
 */
export function sameBox(a: PlacedPart, b: PlacedPart, lookup: PartLookup): boolean {
  const theirs = boxCorners(b, requirePart(lookup, b.partId));
  const isTheirs = (p: Vec3): boolean => theirs.some((q) => Math.abs(p.x - q.x) < SAME_CORNER && Math.abs(p.y - q.y) < SAME_CORNER && Math.abs(p.z - q.z) < SAME_CORNER);
  return boxCorners(a, requirePart(lookup, a.partId)).every(isTheirs);
}

/** World-grid boxes of the cells a brick actually fills (arches leave their opening out). */
export function brickSolids(brick: Brick, lookup: PartLookup): CellBox[] {
  return brickLduSolids(brick, lookup).map(toCells);
}

/** All four quarters of a cell, as a mask of brickCellQuarters. */
export const WHOLE_CELL = 0b1111;

/** Which halves of cell `cell` the span [h0, h1) of half studs covers: bit 1 the lower half, bit 2 the upper. */
function halvesOf(cell: number, h0: number, h1: number): number {
  const lower = 2 * cell >= h0 && 2 * cell < h1 ? 1 : 0;
  const upper = 2 * cell + 1 >= h0 && 2 * cell + 1 < h1 ? 2 : 0;
  return lower | upper;
}

/**
 * The cells a brick's solids reach into, each with a mask of the quarters
 * it fills: bit qx + 2·qz for the quarter that is half qx along x and half
 * qz along z. A brick on whole studs fills whole cells (WHOLE_CELL); one
 * half a stud over fills halves or quarters of the cells along its edges.
 */
export function* brickCellQuarters(brick: Brick, lookup: PartLookup): Generator<readonly [number, number, number, number]> {
  for (const box of brickSolids(brick, lookup)) {
    // in half studs, which positions always come in
    const [hx0, hx1, hz0, hz1] = [box.x0, box.x1, box.z0, box.z1].map((v) => Math.round(v * 2)) as [number, number, number, number];
    for (let y = box.y0; y < box.y1; y++) {
      for (let z = Math.floor(hz0 / 2); 2 * z < hz1; z++) {
        const zHalves = halvesOf(z, hz0, hz1);
        for (let x = Math.floor(hx0 / 2); 2 * x < hx1; x++) {
          const xHalves = halvesOf(x, hx0, hx1);
          yield [x, y, z, (zHalves & 1 ? xHalves : 0) | (zHalves & 2 ? xHalves << 2 : 0)];
        }
      }
    }
  }
}

/** The cells a brick's solids reach into, wholly or in part (see brickCellQuarters). */
export function* brickCells(brick: Brick, lookup: PartLookup): Generator<readonly [number, number, number]> {
  for (const [x, y, z] of brickCellQuarters(brick, lookup)) yield [x, y, z];
}

export function cellBoxToAabb(box: CellBox): Aabb {
  return {
    min: { x: box.x0, y: box.y0 * PLATE_HEIGHT, z: box.z0 },
    max: { x: box.x1, y: box.y1 * PLATE_HEIGHT, z: box.z1 },
  };
}

/** Solid boxes of a brick in world units, used for picking. */
export function brickWorldBoxes(brick: Brick, lookup: PartLookup): Aabb[] {
  return brickSolids(brick, lookup).map(cellBoxToAabb);
}

/**
 * Where a brick's part origin (the middle of its footprint, at its bottom)
 * is in the world, in world units: part meshes are built around it, then
 * turned by the brick's orientation.
 */
export function brickOrigin(brick: PlacedPart, lookup: PartLookup): Vec3 {
  const origin = originLdu(brick, requirePart(lookup, brick.partId));
  return { x: origin.x / LDU_PER_UNIT + 0, y: origin.y / LDU_PER_UNIT + 0, z: origin.z / LDU_PER_UNIT + 0 };
}

/**
 * A brick made loose: its part's origin at `origin` (LDraw units, in the
 * world) and turned by `turn` exactly, its position the corner of the box
 * that leaves it, its orientation the nearest of the 24 (as a hint; its
 * exact turn is what counts).
 */
export function placeLoose<B extends PlacedPart>(brick: B, lookup: PartLookup, origin: Vec3, turn: Turn): B {
  const part = requirePart(lookup, brick.partId);
  const m = orthonormalize(turn);
  const box = turnBox(m, localBox(part, wholeBox(part)));
  // to a million-millionth: exact for anything a model can show, without the last-digit noise of the sums, and too fine to drift over many swings
  const tidy = (value: number): number => Math.round(value * 1e12) / 1e12 + 0;
  return {
    ...brick,
    x: tidy((origin.x + box.x0) / LDU_PER_STUD),
    y: tidy((origin.y + box.y0) / LDU_PER_PLATE),
    z: tidy((origin.z + box.z0) / LDU_PER_STUD),
    r: nearestOrientation(m),
    m,
  };
}

/**
 * Turns bricks by `angle` radians about a line through `pivot` (world
 * units) along the unit `axis`, as parts swing on a hinge or about a pin:
 * each comes out loose, at its exact place and turn.
 */
export function turnBricksAbout(bricks: readonly Brick[], lookup: PartLookup, axis: Vec3, angle: number, pivot: Vec3): Brick[] {
  const turn = turnAbout(axis, angle);
  const at = { x: pivot.x * LDU_PER_UNIT, y: pivot.y * LDU_PER_UNIT, z: pivot.z * LDU_PER_UNIT };
  return bricks.map((brick) => {
    const origin = brickOriginLdu(brick, lookup);
    const moved = rotateBy(turn, { x: origin.x - at.x, y: origin.y - at.y, z: origin.z - at.z });
    return placeLoose(brick, lookup, { x: at.x + moved.x, y: at.y + moved.y, z: at.z + moved.z }, multiplyTurns(turn, brickTurn(brick)));
  });
}

export function groupCellBox(bricks: readonly Brick[], lookup: PartLookup): CellBox {
  if (bricks.length === 0) throw new Error('Cannot bound an empty group of bricks');
  // a plain loop: spreading thousands of values into Math.min overflows the call stack in some engines
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const brick of bricks) {
    const box = brickCellBox(brick, lookup);
    x0 = Math.min(x0, box.x0);
    y0 = Math.min(y0, box.y0);
    z0 = Math.min(z0, box.z0);
    x1 = Math.max(x1, box.x1);
    y1 = Math.max(y1, box.y1);
    z1 = Math.max(z1, box.z1);
  }
  return { x0, y0, z0, x1, y1, z1 };
}

/**
 * Whether a part turned this way has a level side of its own along world X:
 * its own X, or its own Z when its X stands upright. Each quarter turn about
 * the vertical flips it, which keeps turning a group in step.
 */
function liesAlongX(orientation: Orientation): boolean {
  const x = rotateVector(orientation, { x: 1, y: 0, z: 0 });
  const level = x.y === 0 ? x : rotateVector(orientation, { x: 0, y: 0, z: 1 });
  return level.x !== 0;
}

/**
 * Turns a group a quarter turn about the centre of its footprint. When the
 * footprint's sides differ in parity the centre can't stay exactly put, so
 * the rounding alternates with the turn phase: four turns land back on the
 * start and a turn followed by its opposite is a no-op.
 */
export function rotateGroup(bricks: readonly Brick[], lookup: PartLookup, dir: 1 | -1): Brick[] {
  if (bricks.length === 0) return [];
  // the bricks on the grid set the frame, so they stay on whole (or half) studs; failing those, the
  // bricks square to it, on whole LDraw units; loose ones turn exactly within it
  const square = bricks.filter((brick) => !isLoose(brick));
  const onGrid = square.filter(isOnGrid);
  const framing = onGrid.length > 0 ? onGrid : square;
  const [first] = framing;
  const bounds = groupCellBox(first ? framing : bricks, lookup);
  const w = bounds.x1 - bounds.x0;
  const d = bounds.z1 - bounds.z0;
  let x0 = bounds.x0 + (w - d) / 2;
  let z0 = bounds.z0 + (d - w) / 2;
  if (first) {
    const step = onGrid.length > 0 ? 1 : 1 / LDU_PER_STUD;
    const phaseEven = liesAlongX(dir === 1 ? first.r : compose(quarterTurn('y', -1), first.r));
    const round = (dir === 1) === phaseEven ? Math.floor : Math.ceil;
    x0 = bounds.x0 + round((w - d) / 2 / step + 1e-9 * (round === Math.floor ? 1 : -1)) * step;
    z0 = bounds.z0 + round((d - w) / 2 / step + 1e-9 * (round === Math.floor ? 1 : -1)) * step;
  }

  return bricks.map((brick) => {
    const box = brickCellBox(brick, lookup);
    const rx0 = box.x0 - bounds.x0;
    const rx1 = box.x1 - bounds.x0;
    const rz0 = box.z0 - bounds.z0;
    const rz1 = box.z1 - bounds.z0;
    const x = dir === 1 ? rz0 : d - rz1;
    const z = dir === 1 ? w - rx1 : rx0;
    // square bricks stay on whole LDraw units, without floating-point noise; loose ones keep their exact places
    const place = (value: number): number => (brick.m ? cleanZero(value) : snapToLdu(value, LDU_PER_STUD_STEP));
    return {
      ...brick,
      x: place(x0 + x),
      z: place(z0 + z),
      r: compose(quarterTurn('y', dir), brick.r),
      ...(brick.m ? { m: multiplyTurns(turnOf(quarterTurn('y', dir)), brick.m) } : {}),
    };
  });
}
