/**
 * Plugging parts together by their Technic and click-hinge connections: a
 * pin into a pin hole, a beam onto a pin, an axle through a hole, a gear or
 * wheel along an axle, a hinge's finger into its fork. The part being built
 * turns so its connection lines up with the one under the cursor and goes
 * exactly where that puts it, loose: at any angle, and plugged into its
 * neighbour rather than colliding with it.
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

/** How the part being built is turned by R and T: quarter turns about the connection from the best fit, and turned end over end. */
export interface ConnectTurn {
  readonly spin: number;
  readonly flipped: boolean;
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
/** Parts slide along an axle in half studs. */
const SLIDE_STEP = 0.5;
/** ... and as many of those from where the cursor asks, to stand clear of what is on the axle already. */
const SLIDE_REACH = 2;
/** How much of a pin a hole must go onto, and of a hole an axle or a bar into, to hold, in studs: this, or all of the shorter of the two. */
const GRIP = 1;

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

/** How far a part may reach from its bar's line and still be a bar to stand in an open stud, in studs: a sword's crossguard or a claw's clip reaches about half a stud. */
const SLIM_REACH = 0.8;
/** A bar's end is free when the part reaches no further past it than this, in studs: an LDraw unit or so of rounding. */
const FREE_END = 0.06;

/** The corners of the shape a part's reach is judged by: what it really fills, when the index says; its whole cells otherwise. */
function shapeCorners(part: PartDef): Vec3[] {
  const { min, max } = part.extent ?? { min: { x: -part.w / 2, y: 0, z: -part.d / 2 }, max: { x: part.w / 2, y: part.h * PLATE_HEIGHT, z: part.d / 2 } };
  return [min.x, max.x].flatMap((x) => [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) => ({ x, y, z }))));
}

/** Whether a part is little more than its bar: its shape stays within SLIM_REACH of the bar's line. */
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

/** One way the part can plug in: how it is turned, where its origin and its connection's middle go (world units), and how well it sits. */
interface Fit {
  readonly turn: Turn;
  readonly origin: Vec3;
  readonly middle: Vec3;
  readonly score: readonly number[];
}

/**
 * Where a plug's middle goes on a socket, clear of the stretches of it that
 * parts already plugged into it take (`taken`); null when what is left of
 * the socket has no room for the plug. `way` is the way the plug points
 * along the socket with its part standing as the socket's does: the side of
 * a minifigure's hips its leg belongs on (see endsFor).
 */
function placeOn(plug: Connector, socket: WorldConnector, hit: Hit, taken: readonly Stretch[], way: 1 | -1): Vec3 | null {
  const half = socket.length / 2;
  const reach = plug.length / 2;
  /** The point `far` along the socket from where `from` along it is: from its middle, along its axis. */
  const at = (from: number, far: number): Vec3 => along(along(socket.at, socket.axis, from), socket.axis, far);
  const clear = (middle: number): boolean => hasRoom(socket, { from: middle - reach, to: middle + reach, way }, taken);
  // how much of a pin a hole must go onto, or of a hole an axle into, to hold
  const grip = Math.min(GRIP, plug.length, socket.length);
  const enough = grip - playOf(grip);
  if (isHole(socket)) {
    // the end of the hole the part goes in at: +1 the end its axis points to
    const side = mouthOf(socket, hit.point);
    if (plug.kind === 'pin') {
      // in at the mouth under the cursor, as far as it goes: to its collar
      return clear(side * (half - reach)) ? at(side * half, -side * reach) : null;
    }
    // an axle through a beam, a bar down an open stud: to the hole's far face, or as far as what is already in it, the rest towards the cursor
    const stop = Math.min(taken.reduce((far, stretch) => Math.max(far, side > 0 ? stretch.to : -stretch.from), -half), half);
    return half - stop >= enough ? at(side * stop, side * reach) : null;
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
    // along the axle or bar to where the cursor is, in half studs from its end; clear of what is on it, at the nearest such place
    const room = Math.max(half - reach, 0);
    const asked = Math.min(Math.max(dot(minus(hit.point, socket.at), socket.axis), -room), room);
    const last = Math.ceil((2 * room) / SLIDE_STEP);
    const step = Math.min(Math.max(Math.round((asked - reach + half) / SLIDE_STEP), 0), last);
    const middleAt = (k: number): number => Math.min(Math.max(k * SLIDE_STEP - half + reach, -room), room);
    for (let away = 0; away <= SLIDE_REACH; away++) {
      for (const k of away === 0 ? [step] : [step + away, step - away]) {
        if (k >= 0 && k <= last && clear(middleAt(k))) return along(socket.at, socket.axis, middleAt(k));
      }
    }
    return null;
  }
  // a hinge's finger in its fork, a bar in a clip, or a minifigure's joint: middle to middle
  return clear(0) ? socket.at : null;
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
 * Every way the payload's part plugs into the socket, scored: the most of
 * its connections plugged into the target's (a torso on both the hips'
 * studs, not one), then most upright, then, on a bar that sticks out of
 * its part, by the clip the part is drawn about before any other of its
 * clips (drawnAbout), unless that would leave it under the ground or out
 * of the build area, then least in the target's way as its box and the
 * target's tell it, then (but for round connections, whose turn means nothing)
 * facing most as the target does, then turned least. Which of its own
 * connections a part goes on by is settled here: R and T turn it about
 * that one. A hinge's or a turntable's half goes on
 * one way, as the two are drawn together (restTurn), from which R and T
 * still turn it. A part goes into one of the target's
 * hinges, not into two on different lines at once: fingers hold a part to
 * one side of them, so that would lay it through the target, as a hinge
 * plate with fingers on both ends lies turned round onto its twin. And it
 * goes into none of the target's connections where another part already
 * is: a pin into no hole a pin fills, a second top onto no hinge.
 */
function fitsOf(part: PartDef, brick: PayloadBrick, socket: WorldConnector, hit: Hit, target: Brick, lookup: PartLookup, takenOf: TakenOf): Fit[] {
  const plugs = part.connectors ?? [];
  const targetBox = brickCellBox(target, lookup);
  const facing = isRound(socket.kind) ? null : brickTurn(target);
  const sockets = brickConnectors(target, lookup);
  // the socket as its own part has it, to tell a bar that sticks out of that part
  const targetPart = lookup(target.partId);
  const own = socket.kind === 'bar' ? targetPart?.connectors?.[sockets.findIndex((other) => other.kind === socket.kind && length(minus(other.at, socket.at)) < 1e-9 && Math.abs(dot(other.axis, socket.axis)) > 1 - 1e-9)] : undefined;
  const fits: Fit[] = [];
  for (const plug of plugs) {
    if (!plugsInto(plug, socket, part)) continue;
    const asTarget = dot(rotateBy(brickTurn(target), plug.axis), socket.axis) < 0 ? -1 : 1;
    const middle = placeOn(plug, socket, hit, takenOf(socket), asTarget);
    if (middle === null) continue;
    // an arm on a shoulder: by the clip it is drawn about (only a clip goes onto a bar), onto a bar with a free end
    const about = drawnAbout(plug, part) && own !== undefined && targetPart !== undefined && sticksOut(own, targetPart);
    for (const turn of turnsFor(plug, socket, hit, part, target, asTarget)) {
      const origin = minus(middle, rotateBy(turn, plug.at));
      const [a, , , , e, , , , i] = turn;
      const placed = placedAt(brick, origin, turn, lookup);
      const box = brickCellBox(placed, lookup);
      const seated = seatsOf(plugs, sockets, origin, turn);
      if (!haveRoom(seated, takenOf)) continue;
      const [hinge, ...hinges] = seated.map(([, [into]]) => into).filter((other) => FINGERED.includes(other.kind));
      if (hinge && hinges.some((other) => !onOneLine(hinge, other))) continue;
      const byItsOwn = about && !isOutOfBounds(placed, lookup) ? 0 : 1;
      fits.push({ turn, origin, middle, score: [-seated.length, -e, byItsOwn, overlap(box, targetBox), facing ? -closeness(facing, turn) : 0, -(a + e + i)] });
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

/** The best way the part plugs into the nearest of `sockets` that has room for it, with that socket. */
function bestFit(part: PartDef, brick: PayloadBrick, sockets: readonly WorldConnector[], hit: Hit, target: Brick, lookup: PartLookup, takenOf: TakenOf): { readonly socket: WorldConnector; readonly best: Fit } | null {
  for (const socket of sockets) {
    const best = fitsOf(part, brick, socket, hit, target, lookup, takenOf).reduce<Fit | null>((top, fit) => (top === null || better(fit, top) ? fit : top), null);
    if (best) return { socket, best };
  }
  return null;
}

/** Where a part plugs in, and whether it has room there: false where another part already is, and it has nowhere else to go. */
export interface Plugging extends Attachment {
  readonly free: boolean;
}

/**
 * Where the payload plugs into the connection of `target` under the cursor:
 * the best fit, turned by R (`spin`) about the connection and end over end
 * by T (`flipped`); null when the payload is more than one part, has no
 * connection that mates one of the target's, or the cursor is not at one.
 *
 * A connection that a part among `others` (the bricks already there; the
 * target among them is skipped) is plugged into is taken: the payload goes
 * into the nearest in reach that has room for it, onto a pin against what
 * is on it, along an axle clear of what is on it. With none, it depends on
 * what the connection is. At a hinge or a turntable the payload does not
 * plug in (null), and builds on the target as on any brick, as it does on
 * one that comes ready put together. At a hole, a pin, a clip or a
 * minifigure's joint it has nowhere else to go: it comes back where it
 * would have gone, with no room there (`free` false).
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
  const free = bestFit(part, only, near, hit, target, lookup, takenOf);
  const found =
    free ??
    bestFit(
      part,
      only,
      near.filter((socket) => !BRICK_JOINTS.includes(socket.kind)),
      hit,
      target,
      lookup,
      NOTHING_TAKEN,
    );
  if (!found) return null;
  const { socket, best } = found;
  // from the best fit, T turns the part end over end where it stands (but in an open stud, open only at its top), and R a quarter turn about the connection for each press
  const bestBox = brickCellBox(placedAt(only, best.origin, best.turn, lookup), lookup);
  const centre = { x: (bestBox.x0 + bestBox.x1) / 2, y: ((bestBox.y0 + bestBox.y1) / 2) * PLATE_HEIGHT, z: (bestBox.z0 + bestBox.z1) / 2 };
  const over = turned.flipped && socket.kind !== 'barhole' ? turnAbout(overAxis(best, socket.axis, centre), Math.PI) : IDENTITY;
  const turn = multiplyTurns(turnAbout(socket.axis, (turned.spin * Math.PI) / 2), over);
  const origin = along(best.middle, rotateBy(turn, minus(best.origin, best.middle)), 1);
  const facing = multiplyTurns(turn, best.turn);
  const placed = placedAt(only, origin, facing, lookup);
  const box = brickCellBox(placed, lookup);
  const size = { w: box.x1 - box.x0, h: box.y1 - box.y0, d: box.z1 - box.z0 };
  return {
    payload: { bricks: [{ ...placed, x: 0, y: 0, z: 0 }], size, grab: { x: size.w / 2, y: size.h / 2, z: size.d / 2 } },
    offset: { x: placed.x, y: placed.y, z: placed.z },
    // as it ends up, turned by R and T: another of its connections may have come to one that is taken, or clear of one
    free: haveRoom(seatsOf(plugs, brickConnectors(target, lookup), origin, facing), takenOf),
  };
}
