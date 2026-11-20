/**
 * Plugging parts together by their Technic and click-hinge connections: a
 * pin into a pin hole, a beam onto a pin, an axle through a hole, a gear or
 * wheel along an axle, a hinge's finger into its fork. The part being built
 * turns so its connection lines up with the one under the cursor and goes
 * exactly where that puts it, loose: at any angle, and plugged into its
 * neighbour rather than colliding with it.
 */
import { LDU_PER_UNIT, PLATE_HEIGHT, type Vec3 } from '../grid';
import { along, brickConnectors, dot, mates, type WorldConnector } from '../model/connections';
import { brickCellBox, placeLoose } from '../model/geometry';
import type { Brick } from '../model/types';
import { multiplyTurns, rotateBy, turnAbout, type Turn } from '../orientation';
import type { Connector, PartLookup } from '../parts/types';
import type { Attachment } from './attach';
import type { Payload, PayloadBrick } from './payload';
import type { Hit } from './ray';

/** How the part being built is turned by R and T: quarter turns about the connection from the best fit, and turned end over end. */
export interface ConnectTurn {
  readonly spin: number;
  readonly flipped: boolean;
}

/** How near a hole's mouth the cursor must be to plug into it, and how near a pin, axle or hinge, in studs. */
const MOUTH_REACH = 0.45;
const REACH = 0.6;
/** Parts slide along an axle in half studs. */
const SLIDE_STEP = 0.5;

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
  return connector.kind === 'pinhole' || connector.kind === 'axlehole';
}

/** How far the cursor is from a connection it could plug into: from a hole's nearer mouth, or from anywhere along a pin, axle or hinge. */
function reachTo(socket: WorldConnector, point: Vec3): number {
  const s = dot(minus(point, socket.at), socket.axis);
  const half = socket.length / 2;
  const nearest = along(socket.at, socket.axis, isHole(socket) ? (s < 0 ? -half : half) : Math.min(Math.max(s, -half), half));
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

/** One way the part can plug in: how it is turned, where its origin and its connection's middle go (world units), and how well it sits. */
interface Fit {
  readonly turn: Turn;
  readonly origin: Vec3;
  readonly middle: Vec3;
  readonly score: readonly number[];
}

/** Where a plug's middle goes on a socket, plugged in along `axis` (one way or the other along the socket). */
function middleOn(plug: Connector, socket: WorldConnector, axis: Vec3, hit: Hit): Vec3 {
  const half = socket.length / 2;
  // which end of the socket the cursor is at: +1 the end its axis points to
  const side = dot(minus(hit.point, socket.at), socket.axis) < 0 ? -1 : 1;
  if (plug.kind === 'pin' && isHole(socket)) {
    // in at the mouth under the cursor, as far as it goes
    return along(along(socket.at, socket.axis, side * half), axis, plug.length / 2);
  }
  if (plug.kind === 'axle' && isHole(socket)) {
    // through the hole, its far end flush with the far face, the rest towards the cursor
    return along(along(socket.at, socket.axis, -side * half), socket.axis, side * (plug.length / 2));
  }
  if (socket.kind === 'pin') {
    // onto the pin from its base, as far as the hole reaches
    return along(along(socket.at, socket.axis, -half), socket.axis, plug.length / 2);
  }
  if (socket.kind === 'axle') {
    // along the axle to where the cursor is, in half studs from its end
    const room = Math.max(half - plug.length / 2, 0);
    const s = Math.min(Math.max(dot(minus(hit.point, socket.at), socket.axis), -room), room);
    const fromEnd = Math.round((s - plug.length / 2 + half) / SLIDE_STEP) * SLIDE_STEP;
    return along(socket.at, socket.axis, Math.min(Math.max(fromEnd - half + plug.length / 2, -room), room));
  }
  // a hinge's finger in its fork, middle to middle
  return socket.at;
}

/** The ways a plug can point along a socket: a pin's tip into the hole, away from the cursor; anything else, either way. */
function endsFor(plug: Connector, socket: WorldConnector, hit: Hit): Vec3[] {
  const flip = (v: Vec3): Vec3 => ({ x: -v.x, y: -v.y, z: -v.z });
  if (plug.kind === 'pin' && isHole(socket)) return [dot(minus(hit.point, socket.at), socket.axis) < 0 ? socket.axis : flip(socket.axis)];
  return [socket.axis, flip(socket.axis)];
}

function overlap(a: Box, b: Box): number {
  const span = (lo0: number, hi0: number, lo1: number, hi1: number): number => Math.max(0, Math.min(hi0, hi1) - Math.max(lo0, lo1));
  return span(a.x0, a.x1, b.x0, b.x1) * span(a.y0, a.y1, b.y0, b.y1) * span(a.z0, a.z1, b.z0, b.z1);
}

type Box = ReturnType<typeof brickCellBox>;

/** Every way the payload's part plugs into the socket, scored: most upright, then least in the target's way, then turned least. */
function fitsOf(part: readonly Connector[], brick: PayloadBrick, socket: WorldConnector, hit: Hit, target: Box, lookup: PartLookup): Fit[] {
  const fits: Fit[] = [];
  for (const plug of part) {
    if (!mates(plug.kind, socket.kind)) continue;
    for (const axis of endsFor(plug, socket, hit)) {
      const lined = turnTaking(plug.axis, axis);
      const middle = middleOn(plug, socket, axis, hit);
      for (let spin = 0; spin < 4; spin++) {
        const turn = multiplyTurns(turnAbout(axis, (spin * Math.PI) / 2), lined);
        const origin = minus(middle, rotateBy(turn, plug.at));
        const [a, , , , e, , , , i] = turn;
        fits.push({ turn, origin, middle, score: [-e, overlap(brickCellBox(placedAt(brick, origin, turn, lookup), lookup), target), -(a + e + i)] });
      }
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

/**
 * Where the payload plugs into the connection of `target` under the cursor:
 * the best fit, turned by R (`spin`) about the connection and end over end
 * by T (`flipped`); null when the payload is more than one part, has no
 * connection that mates one of the target's, or the cursor is not at one.
 */
export function attachToConnector(hit: Hit, target: Brick, payload: Payload, turned: ConnectTurn, lookup: PartLookup): Attachment | null {
  const [only] = payload.bricks;
  const plugs = only ? (lookup(only.partId)?.connectors ?? []) : [];
  if (payload.bricks.length !== 1 || !only || plugs.length === 0) return null;
  const sockets = brickConnectors(target, lookup).filter((socket) => plugs.some((plug) => mates(plug.kind, socket.kind)));
  const near = sockets
    .map((socket) => ({ socket, reach: reachTo(socket, hit.point) }))
    .filter(({ socket, reach }) => reach <= (isHole(socket) ? MOUTH_REACH : REACH))
    .sort((a, b) => a.reach - b.reach);
  const socket = near[0]?.socket;
  if (!socket) return null;
  const best = fitsOf(plugs, only, socket, hit, brickCellBox(target, lookup), lookup).reduce<Fit | null>((top, fit) => (top === null || better(fit, top) ? fit : top), null);
  if (!best) return null;
  // from the best fit, T turns the part end over end where it stands, and R a quarter turn about the connection for each press
  const bestBox = brickCellBox(placedAt(only, best.origin, best.turn, lookup), lookup);
  const centre = { x: (bestBox.x0 + bestBox.x1) / 2, y: ((bestBox.y0 + bestBox.y1) / 2) * PLATE_HEIGHT, z: (bestBox.z0 + bestBox.z1) / 2 };
  const over = turned.flipped ? turnAbout(overAxis(best, socket.axis, centre), Math.PI) : IDENTITY;
  const turn = multiplyTurns(turnAbout(socket.axis, (turned.spin * Math.PI) / 2), over);
  const origin = along(best.middle, rotateBy(turn, minus(best.origin, best.middle)), 1);
  const placed = placedAt(only, origin, multiplyTurns(turn, best.turn), lookup);
  const box = brickCellBox(placed, lookup);
  const size = { w: box.x1 - box.x0, h: box.y1 - box.y0, d: box.z1 - box.z0 };
  return {
    payload: { bricks: [{ ...placed, x: 0, y: 0, z: 0 }], size, grab: { x: size.w / 2, y: size.h / 2, z: size.d / 2 } },
    offset: { x: placed.x, y: placed.y, z: placed.z },
  };
}
