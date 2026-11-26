/**
 * Plugging parts together by their Technic and click-hinge connections: a
 * pin into a pin hole, a beam onto a pin, an axle into a hole, a gear or
 * wheel along an axle, a hinge's finger into its fork. The part being built
 * turns so its connection lines up with the one under the cursor and goes
 * exactly where that puts it, loose: at any angle, and plugged into its
 * neighbour rather than colliding with it. Of its connections that fit,
 * it goes on by the one that leaves it best placed, or the one C chooses;
 * an axle goes a stud into a hole, or as much further as D pushes it.
 */
import { LDU_PER_UNIT, PLATE_HEIGHT, type Vec3 } from '../grid';
import {
  along,
  brickConnectors,
  connectionsAround,
  dot,
  engaged,
  hasRoom,
  isRound,
  mates,
  onOneLine,
  placeConnector,
  playOf,
  SET_JOINTS,
  stretchOn,
  takenOn,
  type Stretch,
  type WorldConnector,
} from '../model/connections';
import { brickCellBox, brickTurn, placeLoose } from '../model/geometry';
import { isOutOfBounds } from '../model/spatial';
import type { Brick } from '../model/types';
import { multiplyTurns, rotateBy, transposeTurn, turnAbout, type Turn } from '../orientation';
import type { Connector, PartDef, PartLookup } from '../parts/types';
import type { Attachment } from './attach';
import type { Payload, PayloadBrick } from './payload';
import type { Hit } from './ray';

/**
 * How the part being built is held: which of its own connections it goes
 * on by (C), how R and T turn it from the way it fits best by that one,
 * quarter turns about the connection and end over end, and how far D
 * pushes an axle into a hole.
 */
export interface ConnectTurn {
  readonly spin: number;
  readonly flipped: boolean;
  /** The connection it goes on by, as its index among its own, where that one plugs in; unset, or where it does not, whichever fits best. */
  readonly via?: number;
  /** Which of the places an axle can go into a hole it goes to (see furtherIn), from 0, a stud in; past the last there is, the last. Unset, 0. */
  readonly deeper?: number;
}

/** How far into a hole an axle goes, of how far it could (D): the `at`-th of `of` places, from 0, a stud in. */
export interface PlugDepths {
  readonly at: number;
  readonly of: number;
}

/**
 * The ways a part can plug in where it does, and which it takes: for each
 * way, the connection of its own it goes on by (its index among them), the
 * way it takes by itself first; and `at`, the way it takes.
 */
export interface PlugWays {
  readonly at: number;
  readonly plugs: readonly number[];
}

/**
 * How near a hole's mouth the cursor must be to plug into it, how near a
 * pin, an axle or a hinge's fingers, and how near a joint that lies deeper
 * inside the box its part is picked by (a minifigure's, a hinge brick's, a
 * turntable's), in studs.
 */
const MOUTH_REACH = 0.45;
const REACH = 0.6;
const JOINT_REACH = 1;
/** Parts slide along an axle in half studs, and an axle further into a hole. */
const SLIDE_STEP = 0.5;
/** ... and as many of those from where the cursor asks, to stand clear of what is on the axle already. */
const SLIDE_REACH = 2;
/**
 * How much of a pin a hole must go onto, and of a hole an axle or a bar
 * into, to hold, in studs: this, or all of the shorter of the two. It is
 * as far as an axle goes into a hole by itself, which leaves the rest of
 * an axle joiner for another axle.
 */
const GRIP = 1;
/** Places an axle can go to in a hole that lie nearer each other than the play a connection has are one: a far face a whisker past a half stud. */
const SAME_PLACE = playOf(SLIDE_STEP);

const IDENTITY: Turn = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function minus(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function unit(v: Vec3): Vec3 {
  const size = length(v);
  return { x: v.x / size, y: v.y / size, z: v.z / size };
}

function isHole(connector: { readonly kind: string }): boolean {
  return connector.kind === 'pinhole' || connector.kind === 'axlehole' || connector.kind === 'barhole';
}

/** How near the cursor must be to a connection to plug into it (see MOUTH_REACH). */
function reachOf(socket: WorldConnector): number {
  if (isHole(socket)) return MOUTH_REACH;
  return isRound(socket.kind) || ['finger', 'fork', 'fingers2', 'fingers3', 'clip'].includes(socket.kind) ? REACH : JOINT_REACH;
}

/**
 * Which end of a hole a part goes in at, +1 the end its axis points to: an
 * open stud's top, the only end it is open at; for a hole through a part,
 * the one nearer the cursor.
 */
function mouthOf(socket: WorldConnector, point: Vec3): 1 | -1 {
  if (socket.kind === 'barhole') return 1;
  return dot(minus(point, socket.at), socket.axis) < 0 ? -1 : 1;
}

/** How far the cursor is from a connection it could plug into: from a hole's mouth, or from anywhere along a pin, axle or hinge. */
function reachTo(socket: WorldConnector, point: Vec3): number {
  const s = dot(minus(point, socket.at), socket.axis);
  const half = socket.length / 2;
  const nearest = along(socket.at, socket.axis, isHole(socket) ? mouthOf(socket, point) * half : Math.min(Math.max(s, -half), half));
  return length(minus(point, nearest));
}

/** A unit axis square to `v`: the upright one, or X's square part when `v` is upright itself. */
function squareTo(v: Vec3): Vec3 {
  const upright = minus({ x: 0, y: 1, z: 0 }, { x: v.x * v.y, y: v.y * v.y, z: v.z * v.y });
  return length(upright) > 1e-6 ? unit(upright) : unit(minus({ x: 1, y: 0, z: 0 }, { x: v.x * v.x, y: v.y * v.x, z: v.z * v.x }));
}

/** The rotation that takes one unit vector to another the shortest way; end over end about an axis square to them (the upright one, if it can), when they are opposite. */
function turnTaking(from: Vec3, to: Vec3): Turn {
  const c = dot(from, to);
  if (c > 1 - 1e-12) return IDENTITY;
  if (c < -1 + 1e-12) return turnAbout(squareTo(from), Math.PI);
  const axis = unit({ x: from.y * to.z - from.z * to.y, y: from.z * to.x - from.x * to.z, z: from.x * to.y - from.y * to.x });
  return turnAbout(axis, Math.acos(c));
}

/**
 * How far a part may reach from its bar's line and still be a bar to stand
 * in an open stud, in studs: a sword's crossguard or a claw's clip reaches
 * about half a stud; and from its hole's line and be little more than the
 * hole, as an axle joiner or a bush is, which may hang off an axle's end.
 */
const SLIM_REACH = 0.8;
/** A bar's end is free when the part reaches no further past it than this, in studs: an LDraw unit or so of rounding. */
const FREE_END = 0.06;

/** The corners of the shape a part's reach is judged by: what it really fills, when the index says; its whole cells otherwise. */
function shapeCorners(part: PartDef): Vec3[] {
  const { min, max } = part.extent ?? { min: { x: -part.w / 2, y: 0, z: -part.d / 2 }, max: { x: part.w / 2, y: part.h * PLATE_HEIGHT, z: part.d / 2 } };
  return [min.x, max.x].flatMap((x) => [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) => ({ x, y, z }))));
}

/** Whether a part is little more than its bar, or its hole: its shape stays within SLIM_REACH of the connection's line. */
function isSlimAbout(bar: Connector, part: PartDef): boolean {
  return shapeCorners(part).every((corner) => {
    const off = minus(corner, bar.at);
    const s = dot(off, bar.axis);
    return length(minus(off, { x: bar.axis.x * s, y: bar.axis.y * s, z: bar.axis.z * s })) <= SLIM_REACH;
  });
}

/**
 * The ends of a part's bar that go down an open stud, each as the way the
 * bar's own axis then points: +1 out of the stud (its near end went in), -1
 * into it (its far end did). An end goes in when it is free, the part
 * reaching no further that way, so the rest of the part stands out of the
 * stud; and a bar that stands upright in its part goes in by its bottom
 * only, so an antenna stacks on its base rather than standing on its head.
 */
function barEnds(bar: Connector, part: PartDef): (1 | -1)[] {
  if (!isSlimAbout(bar, part)) return [];
  const upright = Math.abs(bar.axis.y) > 0.999;
  // the far end (where the axis points) is the top of an upright bar whose axis points up, the near end of one whose axis points down
  const isTop = (way: 1 | -1): boolean => upright && way * bar.axis.y > 0;
  const goesIn = (way: 1 | -1): boolean => isFreeEnd(bar, part, way) && !isTop(way);
  return [...(goesIn(-1) ? [1 as const] : []), ...(goesIn(1) ? [-1 as const] : [])];
}

/** Whether a bar's end is free: its far end (`way` 1, where its axis points) or its near one, the part reaching no further that way than the bar does. */
function isFreeEnd(bar: Connector, part: PartDef, way: 1 | -1): boolean {
  const reach = Math.max(...shapeCorners(part).map((corner) => way * dot(minus(corner, bar.at), bar.axis)));
  return reach <= bar.length / 2 + FREE_END;
}

/** Whether a bar sticks out of its part, an end of it free: a droid's shoulder, where its neck and the bar of its hips lie between the rest of it. */
function sticksOut(bar: Connector, part: PartDef): boolean {
  return isFreeEnd(bar, part, 1) || isFreeEnd(bar, part, -1);
}

/**
 * Whether building a part plugs this connection of it into a socket. An
 * open stud is somewhere to put a bar, not a way onto one, and studs are
 * where parts stack: so a part's own open stud never plugs it in, and only
 * a part that is little more than a bar, by a free end of it, stands in
 * one. A plate with a handle stacks on the stud instead.
 */
function plugsInto(plug: Connector, socket: WorldConnector, part: PartDef): boolean {
  if (!mates(plug.kind, socket.kind) || plug.kind === 'barhole') return false;
  return socket.kind !== 'barhole' || barEnds(plug, part).length > 0;
}

/** One way the part can plug in: by which of its connections (its index among them), how it is turned, where its origin and that connection's middle go (world units), and how well it sits. */
interface Fit {
  readonly plug: number;
  readonly turn: Turn;
  readonly origin: Vec3;
  readonly middle: Vec3;
  readonly score: readonly number[];
}

/** How much of a pin a hole must go onto, or of a hole an axle into, to hold (GRIP): a stud, or all of the shorter of the two. */
function gripOf(plug: Connector, socket: WorldConnector): number {
  return Math.min(GRIP, plug.length, socket.length);
}

/**
 * How far a part can go into a hole from its mouth at `side` (see mouthOf):
 * to its far face, or as far as what is already in it; as where that is,
 * from the hole's middle towards the mouth.
 */
function stopIn(socket: WorldConnector, side: 1 | -1, taken: readonly Stretch[]): number {
  const half = socket.length / 2;
  return Math.min(taken.reduce((far, stretch) => Math.max(far, side > 0 ? stretch.to : -stretch.from), -half), half);
}

/**
 * How far a part with a hole may hang off each end of an axle it goes onto,
 * in studs: off the end its axis points from, then off the end it points
 * to. Off a free end only, one the axle's own part reaches no further past
 * (not a stop, not a motor's housing): a part that is little more than its
 * hole, an axle joiner or a bush, as far as leaves a stud of the hole on
 * the axle, so another axle can go into the rest; another part, a wheel or
 * a gear, only as far as it must, its hole being longer than the axle.
 * `own` is the axle as its own part, `owner`, has it. Off nothing else.
 */
function offEnds(plug: Connector, part: PartDef, socket: WorldConnector, own: Connector | undefined, owner: PartDef | undefined): readonly [number, number] {
  if (socket.kind !== 'axle' || own === undefined || owner === undefined) return [0, 0];
  const over = isSlimAbout(plug, part) ? plug.length - gripOf(plug, socket) : Math.max(plug.length - socket.length, 0);
  return [isFreeEnd(own, owner, -1) ? over : 0, isFreeEnd(own, owner, 1) ? over : 0];
}

/** Whether a plug goes into a socket as D can push it: an axle into an axle hole or a pin hole. */
function pushesIn(plug: Connector, socket: WorldConnector): boolean {
  return plug.kind === 'axle' && (socket.kind === 'axlehole' || socket.kind === 'pinhole');
}

/**
 * Where the middle of an axle, or of a bar, goes in a hole from its mouth
 * at `side` (see mouthOf): a stud in, or all of itself where it is
 * shorter, so another axle can come in at the other end; or, `through`, as
 * far as it goes, as a bar does down an open stud and an axle that came
 * through the hole from its far side (see inByFreeEnd); and no further
 * than the hole's far face or what is already in it, the rest towards the
 * cursor. Null where too little of the hole is left for it to hold by.
 */
function seatIn(plug: Connector, socket: WorldConnector, side: 1 | -1, taken: readonly Stretch[], through: boolean): Vec3 | null {
  const half = socket.length / 2;
  const grip = gripOf(plug, socket);
  const stop = stopIn(socket, side, taken);
  const room = half - stop;
  if (room < grip - playOf(grip)) return null;
  const depth = through ? room : Math.min(grip, room);
  // where its end in the hole is, from the hole's middle: as far as it goes reckoned as ever, so that no part's place moves by a rounding
  const end = depth === room ? stop : half - depth;
  return along(along(socket.at, socket.axis, side * end), socket.axis, side * (plug.length / 2));
}

/**
 * Whether an axle, its part turned by `turn`, goes into a hole from its
 * mouth at `side` by a free end of it, one its part reaches no further past
 * (see isFreeEnd). Turned the other way, the rest of its part would be in
 * the hole: so it has come through the hole from its far side, and goes as
 * far as it goes, its part beyond the far face.
 */
function inByFreeEnd(plug: Connector, part: PartDef, turn: Turn, socket: WorldConnector, side: 1 | -1): boolean {
  // the end of the axle that points into the hole, away from its mouth: 1 the end its own axis points to
  const inwards = side * dot(rotateBy(turn, plug.axis), socket.axis) < 0 ? 1 : -1;
  return isFreeEnd(plug, part, inwards);
}

/**
 * Where a plug's middle goes on a socket, clear of the stretches of it that
 * parts already plugged into it take (`taken`); null when what is left of
 * the socket has no room for the plug. `way` is the way the plug points
 * along the socket with its part standing as the socket's does: the side of
 * a minifigure's hips its leg belongs on (see endsFor). `off` is how far
 * the plug may hang off each end of an axle (see offEnds).
 */
function placeOn(plug: Connector, socket: WorldConnector, hit: Hit, taken: readonly Stretch[], way: 1 | -1, off: readonly [number, number]): Vec3 | null {
  const half = socket.length / 2;
  const reach = plug.length / 2;
  /** The point `far` along the socket from where `from` along it is: from its middle, along its axis. */
  const at = (from: number, far: number): Vec3 => along(along(socket.at, socket.axis, from), socket.axis, far);
  const clear = (middle: number): boolean => hasRoom(socket, { from: middle - reach, to: middle + reach, way }, taken);
  const grip = gripOf(plug, socket);
  const enough = grip - playOf(grip);
  if (isHole(socket)) {
    // the end of the hole the part goes in at: +1 the end its axis points to
    const side = mouthOf(socket, hit.point);
    if (plug.kind === 'pin') {
      // in at the mouth under the cursor, as far as it goes: to its collar
      return clear(side * (half - reach)) ? at(side * half, -side * reach) : null;
    }
    // a bar down an open stud as far as it goes; an axle a stud in, by a free end of it (fitsOf seats it for each way it is turned)
    return seatIn(plug, socket, side, taken, socket.kind === 'barhole');
  }
  if (socket.kind === 'pin') {
    // onto the pin from its base, or against what is already on it, where the hole has room
    let from = -half;
    for (const stretch of [...taken].sort((a, b) => a.from - b.from)) {
      if (stretch.from - from >= plug.length - playOf(plug.length)) break;
      from = Math.max(from, stretch.to);
    }
    return half - from >= enough ? at(from, reach) : null;
  }
  if (socket.kind === 'axle' || socket.kind === 'bar') {
    // along the axle or bar to where the cursor is, in half studs from its end, and off its ends as far as `off` lets it; clear of what is on it, at the
    // nearest such place. A plug longer than the axle that may hang off neither end goes over its middle.
    const [before, beyond] = off;
    const low = -half + reach - before;
    const high = half - reach + beyond;
    if (low > high) return clear(0) ? socket.at : null;
    const asked = Math.min(Math.max(dot(minus(hit.point, socket.at), socket.axis), low), high);
    // the k-th place, k half studs on from the one with the plug's near end at the axle's (reckoned as ever, so that no place moves by a rounding)
    const middleAt = (k: number): number => Math.min(Math.max(k * SLIDE_STEP - half + reach, low), high);
    const first = before > 0 ? -Math.ceil(before / SLIDE_STEP) : 0;
    const last = Math.ceil((2 * (half - reach) + beyond) / SLIDE_STEP);
    const step = Math.min(Math.max(Math.round((asked - reach + half) / SLIDE_STEP), first), last);
    for (let away = 0; away <= SLIDE_REACH; away++) {
      for (const k of away === 0 ? [step] : [step + away, step - away]) {
        if (k >= first && k <= last && clear(middleAt(k))) return along(socket.at, socket.axis, middleAt(k));
      }
    }
    return null;
  }
  // a hinge's finger in its fork, a bar in a clip, or a minifigure's joint: middle to middle
  return clear(0) ? socket.at : null;
}

/**
 * The places an axle can go to in a hole (D), as how much further in than
 * placeOn puts it each lies, in studs: half a stud on from each other, as
 * far as the hole's far face or what is already in it, and no further than
 * the axle's own end, so its part stays out of the hole. Null for anything
 * else: a pin goes into a hole as far as its collar, a bar down an open
 * stud as far as it goes, a part onto a pin or an axle where it does.
 */
function furtherIn(plug: Connector, socket: WorldConnector, hit: Hit, taken: readonly Stretch[]): number[] | null {
  if (plug.kind !== 'axle' || (socket.kind !== 'axlehole' && socket.kind !== 'pinhole')) return null;
  const room = socket.length / 2 - stopIn(socket, mouthOf(socket, hit.point), taken);
  const further = Math.min(room, plug.length) - Math.min(gripOf(plug, socket), room);
  const places = [0];
  for (let by = SLIDE_STEP; by < further - SAME_PLACE; by += SLIDE_STEP) places.push(by);
  return further > SAME_PLACE ? [...places, further] : places;
}

/**
 * The ways a plug can point along a socket: a pin's tip into the hole, away
 * from the cursor; a bar down an open stud, by an end that goes in
 * (barEnds); a leg along a minifigure's hips the way it does on a figure
 * standing as one (`asTarget`), on its own side of them, where T can still
 * turn it over to the other; anything else, either way.
 */
function endsFor(plug: Connector, socket: WorldConnector, hit: Hit, part: PartDef, asTarget: 1 | -1): Vec3[] {
  const flip = (v: Vec3): Vec3 => ({ x: -v.x, y: -v.y, z: -v.z });
  if (plug.kind === 'pin' && isHole(socket)) return [mouthOf(socket, hit.point) < 0 ? socket.axis : flip(socket.axis)];
  // an open stud's axis points out of it
  if (socket.kind === 'barhole') return barEnds(plug, part).map((way) => (way > 0 ? socket.axis : flip(socket.axis)));
  if (socket.kind === 'hip') return [asTarget > 0 ? socket.axis : flip(socket.axis)];
  return [socket.axis, flip(socket.axis)];
}

function overlap(a: Box, b: Box): number {
  const span = (lo0: number, hi0: number, lo1: number, hi1: number): number => Math.max(0, Math.min(hi0, hi1) - Math.max(lo0, lo1));
  return span(a.x0, a.x1, b.x0, b.x1) * span(a.y0, a.y1, b.y0, b.y1) * span(a.z0, a.z1, b.z0, b.z1);
}

type Box = ReturnType<typeof brickCellBox>;

/** trace(aᵀ · b): the larger, the less one rotation turns from the other. */
function closeness(a: Turn, b: Turn): number {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

/** Hinges whose fingers hold a part to one side of their pivot: click hinges, and the older hinge plates. */
const FINGERED: readonly string[] = ['finger', 'fork', 'fingers2', 'fingers3'];

/**
 * The joints of hinges and turntables, whose halves are bricks in their own
 * right: with its joint taken, a half is still a brick to build on or
 * beside. What goes into any other connection (a pin, a bar, a minifigure's
 * arm) is little without it.
 */
const BRICK_JOINTS: readonly string[] = [...FINGERED, ...SET_JOINTS];

/** The stretches of one of the target's connections that parts already plugged into it take. */
type TakenOf = (socket: WorldConnector) => readonly Stretch[];

const NOTHING_TAKEN: TakenOf = () => [];

/**
 * A connection of the part being built, placed, with those of the target's
 * it is plugged into: more than one, where LDraw draws a long pin or an
 * axle in pieces, end to end, and a hole reaches over two of them.
 */
type Seat = readonly [placed: WorldConnector, into: readonly [WorldConnector, ...WorldConnector[]]];

/** How near the point LDraw draws a part about one of its clips must be to be the one the part goes on by, in studs. */
const DRAWN_ABOUT = 0.05;

/**
 * Whether a part is drawn about this connection of its own: LDraw draws a
 * part that turns on something about the point it turns on, a droid's or a
 * skeleton's arm about the clip at its shoulder. Such a part goes onto a
 * bar that sticks out of its part, a shoulder, by that clip rather than by
 * another of its clips, its hand's, where it stands as upright either way
 * and is not left under the ground (see fitsOf).
 */
function drawnAbout(plug: Connector, part: PartDef): boolean {
  const origin = part.ldraw?.origin;
  return origin !== undefined && Math.hypot(plug.at.x - origin[0], plug.at.y - origin[1], plug.at.z - origin[2]) < DRAWN_ABOUT;
}

/** The part's connections that are plugged into the target's, with the part placed at `origin`, turned by `turn`. */
function seatsOf(plugs: readonly Connector[], sockets: readonly WorldConnector[], origin: Vec3, turn: Turn): Seat[] {
  return plugs.flatMap((plug): Seat[] => {
    const placed = placeConnector(plug, origin, turn);
    const [first, ...rest] = sockets.filter((other) => engaged(placed, other));
    return first ? [[placed, [first, ...rest]]] : [];
  });
}

/** Whether each of those has room in every connection it is in, besides what is plugged in there already. */
function haveRoom(seated: readonly Seat[], takenOf: TakenOf): boolean {
  return seated.every(([placed, into]) => into.every((socket) => hasRoom(socket, stretchOn(socket, placed), takenOf(socket))));
}

/** How far an axle must reach into a hole to be in it, telling whether a hole has two of a part's axles, in studs: a hair, clear of the lattice parts are drawn on and of rounding. */
const INTO = 0.005;

/**
 * Whether a hole of the target, `sockets`, has two axles of the part in
 * it, the part placed at `origin`, turned by `turn`. Pieces of one part's
 * axle that lie on one line are what its part holds them by apart, a stop
 * or a ring, which goes into no hole (the library build joins pieces a
 * notch apart into one: scripts/ldraw).
 */
function twoInOne(plugs: readonly Connector[], sockets: readonly WorldConnector[], origin: Vec3, turn: Turn): boolean {
  const axles = plugs.filter((plug) => plug.kind === 'axle').map((plug) => placeConnector(plug, origin, turn));
  const reachIn = (hole: WorldConnector, axle: WorldConnector): number => {
    const s = dot(minus(axle.at, hole.at), hole.axis);
    return Math.min(hole.length / 2, s + axle.length / 2) - Math.max(-hole.length / 2, s - axle.length / 2);
  };
  return axles.length > 1 && sockets.some((hole) => isHole(hole) && hole.kind !== 'barhole' && axles.filter((axle) => onOneLine(hole, axle) && reachIn(hole, axle) > INTO).length > 1);
}

/**
 * How the half of a hinge or a turntable goes onto its other half, there
 * already, at rest (see SET_JOINTS): turned as that half is, and from there
 * the shortest way that lines its pivot up with the other's. LDraw draws
 * the two halves of most as they go together, so that is no turn at all:
 * a top goes onto its base as LDraw's assembled hinge has it, whether the
 * base stands, lies on its side or hangs upside down. Where their pivots
 * point opposite ways, one half goes on turned half round: the halves of a
 * 1 × 8 hinge brick, which LDraw draws the same way round though they face
 * each other.
 */
function restTurn(plug: Connector, socket: WorldConnector, target: Brick): Turn {
  const facing = brickTurn(target);
  return multiplyTurns(facing, turnTaking(plug.axis, rotateBy(transposeTurn(facing), socket.axis)));
}

/**
 * The ways a plug is turned to try it in a socket: the one way a hinge's
 * or a turntable's half goes on at rest; for any other connection, each
 * way it can point along the socket (endsFor), at every quarter turn about
 * it.
 */
function turnsFor(plug: Connector, socket: WorldConnector, hit: Hit, part: PartDef, target: Brick, asTarget: 1 | -1): Turn[] {
  if (SET_JOINTS.includes(socket.kind)) return [restTurn(plug, socket, target)];
  return endsFor(plug, socket, hit, part, asTarget).flatMap((axis) => {
    const lined = turnTaking(plug.axis, axis);
    return [0, 1, 2, 3].map((spin) => multiplyTurns(turnAbout(axis, (spin * Math.PI) / 2), lined));
  });
}

/**
 * Every way the payload's part plugs into the socket, scored: first a way
 * it can be built, inside the build area and not into the ground, then the
 * most of its connections plugged into the target's (a torso on both the
 * hips' studs, not one), then most upright, then, on a bar that sticks out
 * of its part, by the clip the part is drawn about before any other of its
 * clips (drawnAbout), then least in the target's way as its box and the
 * target's tell it, then (but for round connections, whose turn means
 * nothing) facing most as the target does, then an axle into a hole from
 * the side the cursor is on before one through it from the other (see
 * inByFreeEnd), then turned least. Which of its
 * own connections a part goes on by is settled here, unless C chooses
 * another: R and T turn it about that one. A hinge's or a turntable's half
 * goes on one way, as the two are drawn together (restTurn), from which R
 * and T still turn it. A part goes into one of the target's hinges, not
 * into two on different lines at once: fingers hold a part to one side of
 * them, so that would lay it through the target, as a hinge plate with
 * fingers on both ends lies turned round onto its twin. And it goes into
 * none of the target's connections where another part already is: a pin
 * into no hole a pin fills, a second top onto no hinge.
 */
function fitsOf(part: PartDef, brick: PayloadBrick, socket: WorldConnector, hit: Hit, target: Brick, lookup: PartLookup, takenOf: TakenOf): Fit[] {
  const plugs = part.connectors ?? [];
  const targetBox = brickCellBox(target, lookup);
  const facing = isRound(socket.kind) ? null : brickTurn(target);
  const sockets = brickConnectors(target, lookup);
  // the socket as its own part has it, to tell a bar that sticks out of that part, or the ends of an axle a part may hang off
  const targetPart = lookup(target.partId);
  const own =
    socket.kind === 'bar' || socket.kind === 'axle'
      ? targetPart?.connectors?.[sockets.findIndex((other) => other.kind === socket.kind && length(minus(other.at, socket.at)) < 1e-9 && Math.abs(dot(other.axis, socket.axis)) > 1 - 1e-9)]
      : undefined;
  const fits: Fit[] = [];
  for (const [index, plug] of plugs.entries()) {
    if (!plugsInto(plug, socket, part)) continue;
    const asTarget = dot(rotateBy(brickTurn(target), plug.axis), socket.axis) < 0 ? -1 : 1;
    const middle = placeOn(plug, socket, hit, takenOf(socket), asTarget, offEnds(plug, part, socket, own, targetPart));
    if (middle === null) continue;
    // an axle turned to have come through a hole, the rest of its part beyond the far face, goes as far as it goes
    const side = mouthOf(socket, hit.point);
    const through = pushesIn(plug, socket) ? seatIn(plug, socket, side, takenOf(socket), true) : null;
    // an arm on a shoulder: by the clip it is drawn about (only a clip goes onto a bar), onto a bar with a free end
    const about = socket.kind === 'bar' && drawnAbout(plug, part) && own !== undefined && targetPart !== undefined && sticksOut(own, targetPart);
    for (const turn of turnsFor(plug, socket, hit, part, target, asTarget)) {
      const by = through && !inByFreeEnd(plug, part, turn, socket, side) ? 1 : 0;
      const seat = by ? (through ?? middle) : middle;
      const origin = minus(seat, rotateBy(turn, plug.at));
      const [a, , , , e, , , , i] = turn;
      const placed = placedAt(brick, origin, turn, lookup);
      const box = brickCellBox(placed, lookup);
      const seated = seatsOf(plugs, sockets, origin, turn);
      if (!haveRoom(seated, takenOf) || twoInOne(plugs, sockets, origin, turn)) continue;
      const [hinge, ...hinges] = seated.map(([, [into]]) => into).filter((other) => FINGERED.includes(other.kind));
      if (hinge && hinges.some((other) => !onOneLine(hinge, other))) continue;
      const outside = isOutOfBounds(placed, lookup) ? 1 : 0;
      fits.push({ plug: index, turn, origin, middle: seat, score: [outside, -seated.length, -e, about ? 0 : 1, overlap(box, targetBox), facing ? -closeness(facing, turn) : 0, by, -(a + e + i)] });
    }
  }
  return fits;
}

function placedAt<B extends PayloadBrick>(brick: B, origin: Vec3, turn: Turn, lookup: PartLookup): B {
  return placeLoose(brick, lookup, { x: origin.x * LDU_PER_UNIT, y: origin.y * LDU_PER_UNIT, z: origin.z * LDU_PER_UNIT }, turn);
}

/**
 * The line a part turns end over end about, through its connection's
 * middle and square to the connection: the one of its own axes that points
 * most from there towards its middle, so it turns over where it stands.
 */
function overAxis(fit: Fit, connection: Vec3, middle: Vec3): Vec3 {
  const [a, b, c, d, e, f, g, h, i] = fit.turn;
  const own = [
    { x: a, y: d, z: g },
    { x: b, y: e, z: h },
    { x: c, y: f, z: i },
  ].filter((v) => Math.abs(dot(v, connection)) < 1e-6);
  const towards = minus(middle, fit.middle);
  const square = minus(towards, { x: connection.x * dot(towards, connection), y: connection.y * dot(towards, connection), z: connection.z * dot(towards, connection) });
  const best = own.reduce<Vec3 | null>((top, v) => (top === null || Math.abs(dot(v, square)) > Math.abs(dot(top, square)) ? v : top), null);
  return best ?? (length(square) > 1e-6 ? unit(square) : squareTo(connection));
}

function better(a: Fit, b: Fit): boolean {
  for (let k = 0; k < a.score.length; k++) {
    const d = (a.score[k] ?? 0) - (b.score[k] ?? 0);
    if (Math.abs(d) > 1e-9) return d < 0;
  }
  return false;
}

function bestOf(fits: readonly Fit[]): Fit | null {
  return fits.reduce<Fit | null>((top, fit) => (top === null || better(fit, top) ? fit : top), null);
}

/** Every way the part plugs into the nearest of `sockets` that has room for it, with that socket. */
function fitsAt(part: PartDef, brick: PayloadBrick, sockets: readonly WorldConnector[], hit: Hit, target: Brick, lookup: PartLookup, takenOf: TakenOf): { readonly socket: WorldConnector; readonly fits: readonly Fit[] } | null {
  for (const socket of sockets) {
    const fits = fitsOf(part, brick, socket, hit, target, lookup, takenOf);
    if (fits.length > 0) return { socket, fits };
  }
  return null;
}

/** One way a part plugs in: the connections of its own it goes on by that way, and its best fit. */
interface Way {
  readonly plugs: readonly number[];
  readonly best: Fit;
}

/** Whether a unit axis runs along one of the grid's, either way. */
function onGridAxis(axis: Vec3): boolean {
  return Math.max(Math.abs(axis.x), Math.abs(axis.y), Math.abs(axis.z)) > 1 - 1e-6;
}

/**
 * The ways a part can plug in at a connection, best first: one for each of
 * its own connections that goes on there, but one for all of those its
 * shape makes alike (PartDef.alike): a pin goes into a hole by either of its
 * two ends, and a beam onto a pin by the hole at one end lies as it would by
 * the hole at the other, turned half round. That holds while the quarter
 * turns R gives keep to the grid, the connection's axis and the part's own
 * running along the grid's; at a tilted one, a minifigure hand's clip, R's
 * quarters by one alike connection are not those by the other, so each is
 * a way of its own. Of two that fit as well, the one whose best fit came
 * first goes first, as that fit is the one the part takes by itself.
 */
function waysOf(part: PartDef, fits: readonly Fit[], socket: WorldConnector): Way[] {
  const ways = new Map<number, Way>();
  for (const fit of fits) {
    const own = part.connectors?.[fit.plug];
    const like = own && onGridAxis(own.axis) && onGridAxis(socket.axis) ? (part.alike?.[fit.plug] ?? fit.plug) : fit.plug;
    const way = ways.get(like);
    ways.set(like, way ? { plugs: way.plugs.includes(fit.plug) ? way.plugs : [...way.plugs, fit.plug], best: better(fit, way.best) ? fit : way.best } : { plugs: [fit.plug], best: fit });
  }
  const order = new Map(fits.map((fit, index) => [fit, index]));
  return [...ways.values()].sort((a, b) => (better(a.best, b.best) ? -1 : better(b.best, a.best) ? 1 : (order.get(a.best) ?? 0) - (order.get(b.best) ?? 0)));
}

/** The connection to plug in by for the way after the one taken (C), or before it (`back`); null where there is no other way. */
export function nextWay(ways: PlugWays, back: boolean): number | null {
  const count = ways.plugs.length;
  if (count < 2) return null;
  return ways.plugs[(ways.at + (back ? count - 1 : 1)) % count] ?? null;
}

/** The place an axle goes to in a hole after the one it is at, half a stud further in (D), or before it (`back`), round from the last to the first; null where it has no other. */
export function nextDepth(depths: PlugDepths, back: boolean): number | null {
  if (depths.of < 2) return null;
  return (depths.at + (back ? depths.of - 1 : 1)) % depths.of;
}

/**
 * Where a part plugs in, whether it has room there (false where another
 * part already is, and it has nowhere else to go), the ways it could plug
 * in there, C's to choose from, and, where it is an axle going into a hole,
 * how far in it goes of how far it could, D's.
 */
export interface Plugging extends Attachment {
  readonly free: boolean;
  readonly ways: PlugWays;
  readonly depths?: PlugDepths;
}

/**
 * Where the payload plugs into the connection of `target` under the cursor:
 * the best fit by the connection of its own C chose (`via`), where that one
 * plugs in there, by whichever fits best otherwise, an axle pushed further
 * into a hole by D (`deeper`), turned by R (`spin`) about the connection
 * and end over end by T (`flipped`); null when the payload is more than
 * one part, has no connection that mates one of the target's, or the
 * cursor is not at one.
 *
 * A connection that a part among `others` (the bricks already there; the
 * target among them is skipped) is plugged into is taken: the payload goes
 * into the nearest in reach that has room for it, onto a pin against what
 * is on it, along an axle clear of what is on it, into a hole as far as
 * what is in it. With none, it depends on what the connection is. At a
 * hinge or a turntable the payload does not plug in (null), and builds on
 * the target as on any brick, as it does on one that comes ready put
 * together. At a hole, a pin, a clip or a minifigure's joint it has nowhere
 * else to go: it comes back where it would have gone, with no room there
 * (`free` false).
 */
export function attachToConnector(hit: Hit, target: Brick, payload: Payload, turned: ConnectTurn, lookup: PartLookup, others: Iterable<Brick>): Plugging | null {
  const [only] = payload.bricks;
  const part = only ? lookup(only.partId) : undefined;
  const plugs = part?.connectors ?? [];
  if (payload.bricks.length !== 1 || !only || !part || plugs.length === 0) return null;
  const sockets = brickConnectors(target, lookup).filter((socket) => plugs.some((plug) => plugsInto(plug, socket, part)));
  const near = sockets
    .map((socket) => ({ socket, reach: reachTo(socket, hit.point) }))
    .filter(({ socket, reach }) => reach <= reachOf(socket))
    .sort((a, b) => a.reach - b.reach)
    .map(({ socket }) => socket);
  if (near.length === 0) return null;
  const around = connectionsAround(target, others, lookup);
  const taken = new Map<WorldConnector, readonly Stretch[]>();
  const takenOf: TakenOf = (socket) => {
    const known = taken.get(socket) ?? takenOn(socket, around);
    taken.set(socket, known);
    return known;
  };
  const roomy = fitsAt(part, only, near, hit, target, lookup, takenOf);
  const found =
    roomy ??
    fitsAt(
      part,
      only,
      near.filter((socket) => !BRICK_JOINTS.includes(socket.kind)),
      hit,
      target,
      lookup,
      NOTHING_TAKEN,
    );
  if (!found) return null;
  const { socket, fits } = found;
  const ways = waysOf(part, fits, socket);
  // by the connection chosen, where it goes on here; the best fit otherwise
  const best = bestOf(fits.filter((fit) => fit.plug === turned.via)) ?? bestOf(fits);
  const plug = best ? plugs[best.plug] : undefined;
  if (!best || !plug) return null;
  // from the best fit, T turns the part end over end where it stands (but in an open stud, open only at its top), and R a quarter turn about the connection for each press
  const bestBox = brickCellBox(placedAt(only, best.origin, best.turn, lookup), lookup);
  const centre = { x: (bestBox.x0 + bestBox.x1) / 2, y: ((bestBox.y0 + bestBox.y1) / 2) * PLATE_HEIGHT, z: (bestBox.z0 + bestBox.z1) / 2 };
  const over = turned.flipped && socket.kind !== 'barhole' ? turnAbout(overAxis(best, socket.axis, centre), Math.PI) : IDENTITY;
  const turn = multiplyTurns(turnAbout(socket.axis, (turned.spin * Math.PI) / 2), over);
  const facing = multiplyTurns(turn, best.turn);
  // an axle goes into a hole the way it ends up pointing: by a free end, a stud in or as much further as D pushes it (furtherIn), away from the
  // mouth; turned to have come through the hole, as far as it goes (see seatIn)
  const side = mouthOf(socket, hit.point);
  const pushes = pushesIn(plug, socket);
  const free = pushes && inByFreeEnd(plug, part, facing, socket, side);
  const places = (free ? furtherIn(plug, socket, hit, takenOf(socket)) : null) ?? [0];
  const deeper = Math.min(Math.max(turned.deeper ?? 0, 0), places.length - 1);
  const seat = pushes ? (seatIn(plug, socket, side, (roomy ? takenOf : NOTHING_TAKEN)(socket), !free) ?? best.middle) : best.middle;
  const further = places[deeper] ?? 0;
  const middle = further === 0 ? seat : along(seat, socket.axis, -side * further);
  const origin = along(middle, rotateBy(turn, minus(best.origin, best.middle)), 1);
  const placed = placedAt(only, origin, facing, lookup);
  const box = brickCellBox(placed, lookup);
  const size = { w: box.x1 - box.x0, h: box.y1 - box.y0, d: box.z1 - box.z0 };
  const all = brickConnectors(target, lookup);
  return {
    payload: { bricks: [{ ...placed, x: 0, y: 0, z: 0 }], size, grab: { x: size.w / 2, y: size.h / 2, z: size.d / 2 } },
    offset: { x: placed.x, y: placed.y, z: placed.z },
    // as it ends up, turned by R and T: another of its connections may have come to one that is taken, or clear of one
    free: haveRoom(seatsOf(plugs, all, origin, facing), takenOf) && !twoInOne(plugs, all, origin, facing),
    ways: { at: ways.findIndex((way) => way.plugs.includes(best.plug)), plugs: ways.map((way) => way.best.plug) },
    ...(pushes ? { depths: { at: deeper, of: places.length } } : {}),
  };
}
