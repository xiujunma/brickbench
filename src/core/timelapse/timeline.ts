/**
 * The plan for a time-lapse video of a model being built: which bricks each
 * frame shows (in place, or still dropping into it) and where the camera is,
 * circling the finished model. Pure, so it is tested without a browser.
 */
import type { Vec3 } from '../grid';
import { planSteps, type StepOrder } from '../instructions/steps';
import { buildSpatialIndex } from '../model/spatial';
import { allStuds, type StudInstance } from '../model/studs';
import type { Brick } from '../model/types';
import type { PartLookup } from '../parts/types';

export type VideoShape = 'landscape' | 'square' | 'portrait';
export type VideoSize = '1080p' | '720p';

export interface TimelapseOptions {
  readonly order: StepOrder;
  readonly seconds: number;
  readonly shape: VideoShape;
  readonly size: VideoSize;
  /** Circle the model while it builds, rather than keep still. */
  readonly turn: boolean;
  /** Count the bricks in a corner as they arrive. */
  readonly counter: boolean;
}

export const DEFAULT_TIMELAPSE_OPTIONS: TimelapseOptions = {
  order: 'build-order',
  seconds: 20,
  shape: 'landscape',
  size: '1080p',
  turn: true,
  counter: true,
};

export const VIDEO_LENGTHS = [5, 10, 20, 30, 60] as const;
export const FRAME_RATE = 30;

/** Width and height in pixels; even, as video encoders want. */
export function videoSize(shape: VideoShape, size: VideoSize): { readonly width: number; readonly height: number } {
  const short = size === '1080p' ? 1080 : 720;
  const long = (short * 16) / 9;
  if (shape === 'square') return { width: short, height: short };
  return shape === 'landscape' ? { width: long, height: short } : { width: short, height: long };
}

/** How long a brick takes to drop into place, and from how many plates above it. */
const DROP_SECONDS = 0.4;
export const DROP_PLATES = 9;
/** The finished model stays on screen this long at the end, or a quarter of a short video. */
const HOLD_SECONDS = 2.5;

export interface Timeline {
  readonly frames: number;
  readonly frameRate: number;
  /** For each brick, in building order, the frame it starts to drop in; never decreasing. */
  readonly starts: readonly number[];
  readonly dropFrames: number;
}

/** The order bricks arrive in: as the user placed them, or bottom up a layer at a time like the instructions. */
export function buildingOrder(bricks: readonly Brick[], lookup: PartLookup, order: StepOrder): Brick[] {
  if (order === 'build-order') return [...bricks];
  return planSteps(bricks, lookup, { order: 'layers', partsPerStep: 1 }).flatMap((step) => step.added);
}

/** Spreads the bricks evenly over the video, so the last one lands as the closing hold begins. */
export function planTimeline(count: number, seconds: number, frameRate: number = FRAME_RATE): Timeline {
  const frames = Math.max(2, Math.round(seconds * frameRate));
  const dropFrames = Math.max(1, Math.round(DROP_SECONDS * frameRate));
  const hold = Math.min(Math.round(HOLD_SECONDS * frameRate), Math.floor(frames / 4));
  const lastStart = Math.max(0, frames - 1 - hold - dropFrames);
  const starts = Array.from({ length: count }, (_, i) => (count <= 1 ? 0 : Math.round((i * lastStart) / (count - 1))));
  return { frames, frameRate, starts, dropFrames };
}

export interface FrameBricks {
  readonly landed: readonly Brick[];
  /** Bricks on their way down, raised by how far they still have to fall. */
  readonly falling: readonly Brick[];
  /** Bricks on show, landed or falling. */
  readonly shown: number;
}

const easeOut = (t: number): number => 1 - (1 - t) ** 3;

/** The bricks a frame shows. `ordered` is in building order, matching the timeline's starts. */
export function bricksAt(frame: number, ordered: readonly Brick[], timeline: Timeline): FrameBricks {
  const landed: Brick[] = [];
  const falling: Brick[] = [];
  for (const [i, brick] of ordered.entries()) {
    const start = timeline.starts[i] ?? 0;
    // starts never decrease, so the rest arrive later still
    if (frame < start) break;
    const progress = (frame - start) / timeline.dropFrames;
    if (progress >= 1) landed.push(brick);
    else falling.push({ ...brick, y: brick.y + DROP_PLATES * (1 - easeOut(progress)) });
  }
  return { landed, falling, shown: landed.length + falling.length };
}

/**
 * When each stud of the finished model is on show: from the moment its brick
 * lands until an opaque brick lands on top of it, if one does. Worked out
 * once, so each frame only filters a list instead of looking at every brick.
 */
export interface StudSchedule {
  readonly studs: readonly StudInstance[];
  /** Building-order index of the stud's brick. */
  readonly from: Int32Array;
  /** Building-order index of the opaque brick that covers it, or the brick count when none does. */
  readonly until: Int32Array;
}

export function scheduleStuds(ordered: readonly Brick[], lookup: PartLookup, isOpaque: (colorId: number) => boolean): StudSchedule {
  const index = buildSpatialIndex(ordered, lookup);
  const order = new Map(ordered.map((brick, i) => [brick.id, i]));
  const colours = new Map(ordered.map((brick) => [brick.id, brick.colorId]));
  const studs: StudInstance[] = [];
  const from: number[] = [];
  const until: number[] = [];
  for (const [i, brick] of ordered.entries()) {
    for (const stud of allStuds([brick], lookup)) {
      const cover = index.ownerAt(stud.x + 0.5, stud.y, stud.z + 0.5);
      const covered = cover !== undefined && isOpaque(colours.get(cover) ?? -1) ? order.get(cover) : undefined;
      studs.push(stud);
      from.push(i);
      until.push(covered ?? ordered.length);
    }
  }
  return { studs, from: Int32Array.from(from), until: Int32Array.from(until) };
}

/** The studs on show once the first `landed` bricks in building order are in place. */
export function studsAt(schedule: StudSchedule, landed: number): StudInstance[] {
  const shown: StudInstance[] = [];
  schedule.studs.forEach((stud, i) => {
    if ((schedule.from[i] ?? 0) < landed && (schedule.until[i] ?? 0) >= landed) shown.push(stud);
  });
  return shown;
}

/** A point in the picture, as fractions of its half-width and half-height from the middle (up and right positive). */
export interface PicturePoint {
  readonly x: number;
  readonly y: number;
}

/** A camera circling the finished model at a steady height and distance, so the model never leaves the frame. */
export interface Orbit {
  readonly target: Vec3;
  readonly distance: number;
  /** Angle above the horizon, in radians. */
  readonly elevation: number;
  readonly startYaw: number;
  /** How far it circles over the whole video, in radians. */
  readonly sweep: number;
  /**
   * Where the middle of the model falls in the picture, sampled evenly along
   * the circle: the lens shifts by it so the model sits in the middle.
   */
  readonly centres: readonly PicturePoint[];
}

/** The camera for one frame: where it is, what it looks at, and the lens shift that centres the model. */
export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly shift: PicturePoint;
}

const DEGREES = Math.PI / 180;
const MIN_ELEVATION = 12 * DEGREES;
const MAX_ELEVATION = 60 * DEGREES;
/** The share of the picture's width and height the model may fill, leaving a margin around it. */
const FILL = 0.88;
/** A video this long or longer circles the model once; shorter ones circle part of the way. */
const FULL_TURN_SECONDS = 20;
/** Camera positions checked along the circle when fitting the model in. */
const FIT_SAMPLES = 48;

type Basis = { readonly forward: Vec3; readonly right: Vec3; readonly up: Vec3 };

/** Which way the camera looks at a turn and height: forward (camera to model), right and up. */
function basisAt(yaw: number, elevation: number): Basis {
  const flat = Math.cos(elevation);
  const forward = { x: Math.sin(yaw) * flat, y: -Math.sin(elevation), z: Math.cos(yaw) * flat };
  // right = forward × world up, normalised; up = right × forward
  const right = { x: -Math.cos(yaw), y: 0, z: Math.sin(yaw) };
  const up = { x: right.y * forward.z - right.z * forward.y, y: right.z * forward.x - right.x * forward.z, z: right.x * forward.y - right.y * forward.x };
  return { forward, right, up };
}

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** Where the points fall in a perspective picture, as fractions of its half-width and half-height. */
interface Extent {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

interface Lens {
  readonly tanAcross: number;
  readonly tanUp: number;
}

/** Points nearer the camera than this are too close to frame. */
const NEAR = 0.5;

/**
 * The picture the points (relative to the target) make from `distance`
 * along `basis`: a point p sits at depth distance + p·forward. Null when one
 * is behind or nearly at the camera.
 */
function extentAt(points: readonly Vec3[], basis: Basis, distance: number, lens: Lens): Extent | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    const depth = distance + dot(p, basis.forward);
    if (depth < NEAR) return null;
    const x = dot(p, basis.right) / (depth * lens.tanAcross);
    const y = dot(p, basis.up) / (depth * lens.tanUp);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

/** Whether a picture fits within FILL of the frame once centred. */
const fits = (extent: Extent | null): boolean => extent !== null && extent.maxX - extent.minX <= 2 * FILL && extent.maxY - extent.minY <= 2 * FILL;

/**
 * A distance at which, centred, every point fits: each within FILL of the
 * middle, which is always enough since centring only helps. Then the
 * nearest such distance, halving the gap to a distance that is too near.
 */
function fitDistance(points: readonly Vec3[], basis: Basis, lens: Lens): number {
  let far = NEAR;
  for (const p of points) {
    const depth = dot(p, basis.forward);
    far = Math.max(far, Math.abs(dot(p, basis.right)) / (lens.tanAcross * FILL) - depth, Math.abs(dot(p, basis.up)) / (lens.tanUp * FILL) - depth);
  }
  let near = 0;
  // twenty halvings pin the distance to a millionth of the range: far finer than a pixel
  for (let i = 0; i < 20; i++) {
    const middle = (near + far) / 2;
    if (fits(extentAt(points, basis, middle, lens))) far = middle;
    else near = middle;
  }
  return far;
}

/** Points without repeats: neighbouring bricks share most corners, and big models have hundreds of thousands. */
function uniquePoints(points: readonly Vec3[]): Vec3[] {
  const seen = new Map<string, Vec3>();
  for (const p of points) seen.set(`${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`, p);
  return [...seen.values()];
}

/** The eight corners of a box. */
export function boxCorners(box: { readonly min: Vec3; readonly max: Vec3 }): Vec3[] {
  return [box.min.x, box.max.x].flatMap((x) => [box.min.y, box.max.y].flatMap((y) => [box.min.z, box.max.z].map((z) => ({ x, y, z }))));
}

/**
 * Plans the camera from the editor's view direction (camera to model): the
 * same side and height, circling the middle of the model at the nearest
 * steady distance that keeps every point given (the corners of each brick's
 * box, say) in the picture all the way round.
 */
export function planOrbit(
  points: readonly Vec3[],
  direction: Vec3,
  aspect: number,
  fovDegrees: number,
  turn: boolean,
  seconds: number,
): Orbit {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of points) {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
    max.z = Math.max(max.z, p.z);
  }
  const target = points.length > 0 ? { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 } : { x: 0, y: 0, z: 0 };
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
  const elevation = Math.min(Math.max(Math.asin(Math.min(1, Math.max(-1, -direction.y / length))), MIN_ELEVATION), MAX_ELEVATION);
  const startYaw = Math.atan2(direction.x, direction.z);
  const sweep = turn ? 2 * Math.PI * Math.min(1, seconds / FULL_TURN_SECONDS) : 0;

  const relative = uniquePoints(points).map((p) => ({ x: p.x - target.x, y: p.y - target.y, z: p.z - target.z }));
  const tan = Math.tan((fovDegrees * DEGREES) / 2);
  const lens: Lens = { tanAcross: tan * aspect, tanUp: tan };
  const samples = sweep === 0 ? 1 : FIT_SAMPLES;
  const bases = Array.from({ length: samples }, (_, i) => basisAt(startYaw + (samples === 1 ? 0 : (sweep * i) / (samples - 1)), elevation));
  // one distance for the whole video: the farthest any view along the circle needs
  const distance = Math.max(1, ...bases.map((basis) => fitDistance(relative, basis, lens)));
  const centres = bases.map((basis): PicturePoint => {
    const extent = extentAt(relative, basis, distance, lens);
    return extent ? { x: (extent.minX + extent.maxX) / 2, y: (extent.minY + extent.maxY) / 2 } : { x: 0, y: 0 };
  });
  return { target, distance, elevation, startYaw, sweep, centres };
}

/** The lens shift at a point of the circle, `along` from 0 to 1, between the sampled ones. */
function centreAt(centres: readonly PicturePoint[], along: number): PicturePoint {
  if (centres.length <= 1) return centres[0] ?? { x: 0, y: 0 };
  const at = along * (centres.length - 1);
  const i = Math.min(Math.floor(at), centres.length - 2);
  const a = centres[i] ?? { x: 0, y: 0 };
  const b = centres[i + 1] ?? a;
  const f = at - i;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

/** The camera at a point of the video, `t` from 0 to 1; it starts and stops circling gently. */
export function cameraAt(orbit: Orbit, t: number): CameraPose {
  const eased = (1 - Math.cos(Math.PI * Math.min(Math.max(t, 0), 1))) / 2;
  const { forward } = basisAt(orbit.startYaw + orbit.sweep * eased, orbit.elevation);
  const { target, distance } = orbit;
  return {
    position: { x: target.x - forward.x * distance, y: target.y - forward.y * distance, z: target.z - forward.z * distance },
    target,
    shift: centreAt(orbit.centres, eased),
  };
}

/** What the corner of each frame says: "312 / 1,504 bricks". */
export function counterText(shown: number, total: number): string {
  return `${shown.toLocaleString('en')} / ${total.toLocaleString('en')} ${total === 1 ? 'brick' : 'bricks'}`;
}
