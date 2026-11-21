import { barPiece, connectorOf, connectorPrimitive, placeConnector, type FlatConnector } from './connectors.ts';
import { HINGE_JOINTS } from './hingeJoints.ts';
import { MINIFIG_JOINTS } from './minifigJoints.ts';
import { normalizeName, type LibrarySource } from './library.ts';
import { parseLDraw, type Transform, type V3 } from './parse.ts';

/** LDraw colour code meaning "the colour of whatever uses this". */
export const MAIN_COLOR = 16;

export interface FlatTriangle {
  /** Corners in counter-clockwise order seen from the front, in the part's LDraw coordinates. */
  readonly a: V3;
  readonly b: V3;
  readonly c: V3;
  readonly color: number;
  /** Seen from both sides (NOCLIP); the mesh needs a back-facing copy. */
  readonly doubleSided: boolean;
  /** Comes from a stud primitive; left out when measuring the part's body. */
  readonly stud: boolean;
}

/** A stud standing out of a side or the underside: where its base sits and which way it points, in LDraw coordinates. */
export interface DirectedStud {
  readonly at: V3;
  /** A unit vector along an axis; never LDraw's up, (0, -1, 0): those are top studs. */
  readonly dir: V3;
}

export interface FlatPart {
  readonly triangles: readonly FlatTriangle[];
  /** Centres of upward-facing top studs, in LDraw coordinates. */
  readonly topStuds: readonly V3[];
  /** Studs facing sideways or down, square to the axes, as on bricks with studs on their sides and on brackets. */
  readonly sideStuds: readonly DirectedStud[];
  /** The pieces of its Technic and hinge connections (see connectors.ts), not yet joined up. */
  readonly connectors: readonly FlatConnector[];
}

/** Every stud primitive, top or underside. */
const STUD_PRIMITIVE = /^(48\/|8\/)?stud[^/]*\.dat$/;
/** Studs that stand on a top face, centred on a grid cell. */
const TOP_STUD = /^stud(2a?|a|26|6a?|9|10|13|15|17a?|el|h[lr]?|p01|-logo\d*|2-logo\d*)?\.dat$/;

function apply(tr: Transform, [x, y, z]: V3): V3 {
  const [a, b, c, d, e, f, g, h, i] = tr.m;
  return [a * x + b * y + c * z + tr.t[0], d * x + e * y + f * z + tr.t[1], g * x + h * y + i * z + tr.t[2]];
}

/** The transform's turn alone, applied to a direction. */
function turn(tr: Transform, [x, y, z]: V3): V3 {
  const [a, b, c, d, e, f, g, h, i] = tr.m;
  return [a * x + b * y + c * z, d * x + e * y + f * z, g * x + h * y + i * z];
}

/** The axis direction a vector points along, as a unit vector; null when it points between axes. */
function axisOf(v: V3): V3 | null {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length === 0) return null;
  for (let k = 0; k < 3; k++) {
    const share = (v[k] ?? 0) / length;
    if (Math.abs(share) > 0.99) return [k === 0 ? Math.sign(share) : 0, k === 1 ? Math.sign(share) : 0, k === 2 ? Math.sign(share) : 0];
  }
  return null;
}

const STUD_UP: V3 = [0, -1, 0];

function isUp(dir: V3): boolean {
  return dir[0] === 0 && dir[1] === -1 && dir[2] === 0;
}

function determinant(tr: Transform): number {
  const [a, b, c, d, e, f, g, h, i] = tr.m;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/**
 * Does the transform keep a stud's up direction (LDraw -Y) pointing up? It
 * maps (0, -1, 0) to minus the matrix's second column, so that column's Y
 * must stay positive.
 */
function keepsUp(tr: Transform): boolean {
  const [, b, , , e, , , h] = tr.m;
  const length = Math.hypot(b, e, h);
  return length > 0 && e / length > 0.99;
}

function pointKey([x, y, z]: V3): string {
  return `${Math.round(x * 100)},${Math.round(y * 100)},${Math.round(z * 100)}`;
}

function dedupe(points: readonly V3[]): V3[] {
  const seen = new Set<string>();
  return points.filter((point) => {
    const key = pointKey(point);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeDirected(studs: readonly DirectedStud[]): DirectedStud[] {
  const seen = new Set<string>();
  return studs.filter((stud) => {
    const key = `${pointKey(stud.at)}|${stud.dir.join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface BfcState {
  certified: boolean;
  clockwise: boolean;
  invertNext: boolean;
  noClip: boolean;
}

function applyBfc(state: BfcState, text: string): void {
  const words = text.toUpperCase().split(/\s+/);
  if (words[0] !== 'BFC') return;
  if (words.includes('CERTIFY')) state.certified = true;
  if (words.includes('NOCERTIFY')) state.certified = false;
  if (words.includes('CW')) state.clockwise = true;
  if (words.includes('CCW')) state.clockwise = false;
  if (words.includes('INVERTNEXT')) state.invertNext = true;
  if (words.includes('NOCLIP')) state.noClip = true;
  else if (words.includes('CLIP')) state.noClip = false;
}

/**
 * Resolves parts into plain triangles, following LDraw's back-face culling
 * rules (BFC): winding, INVERTNEXT, mirrored matrices and NOCLIP sections.
 * Shared primitives are flattened once and reused.
 */
export class Flattener {
  private readonly primitives = new Map<string, FlatPart>();
  private readonly source: LibrarySource;

  constructor(source: LibrarySource) {
    this.source = source;
  }

  flatten(name: string): FlatPart {
    const key = normalizeName(name);
    const cached = this.primitives.get(key);
    if (cached) return cached;
    const file = this.source.read(key);
    if (file === null) throw new Error(`LDraw file not found: ${name}`);
    const result = this.resolve(key, file.text);
    if (file.primitive) this.primitives.set(key, result);
    return result;
  }

  private resolve(key: string, text: string): FlatPart {
    const isStud = STUD_PRIMITIVE.test(key);
    const triangles: FlatTriangle[] = [];
    const topStuds: V3[] = TOP_STUD.test(key) ? [[0, 0, 0]] : [];
    const sideStuds: DirectedStud[] = [];
    const connectors: FlatConnector[] = [];
    const state: BfcState = { certified: false, clockwise: false, invertNext: false, noClip: false };

    const push = (p0: V3, p1: V3, p2: V3, color: number): void => {
      const [b, c] = state.clockwise ? [p2, p1] : [p1, p2];
      triangles.push({ a: p0, b, c, color, doubleSided: state.noClip || !state.certified, stud: isStud });
    };

    for (const line of parseLDraw(text)) {
      if (line.kind === 'meta') {
        applyBfc(state, line.text);
      } else if (line.kind === 'tri') {
        push(line.points[0], line.points[1], line.points[2], line.color);
      } else if (line.kind === 'quad') {
        const [a, b, c, d] = line.points;
        push(a, b, c, line.color);
        push(a, c, d, line.color);
      } else {
        const child = this.flatten(line.file);
        // a mirrored reference keeps its surfaces facing out once its winding is turned back; INVERTNEXT turns them inside out
        const inverted = state.invertNext;
        const flip = inverted !== determinant(line.matrix) < 0;
        state.invertNext = false;
        for (const t of child.triangles) {
          const a = apply(line.matrix, t.a);
          const b = apply(line.matrix, t.b);
          const c = apply(line.matrix, t.c);
          triangles.push({
            a,
            b: flip ? c : b,
            c: flip ? b : c,
            color: t.color === MAIN_COLOR ? line.color : t.color,
            doubleSided: t.doubleSided || state.noClip || !state.certified,
            stud: t.stud || isStud,
          });
        }
        if (keepsUp(line.matrix)) {
          for (const stud of child.topStuds) topStuds.push(apply(line.matrix, stud));
        } else {
          // top studs turned to face another way: a side stud, or one facing down
          const dir = axisOf(turn(line.matrix, STUD_UP));
          if (dir && !isUp(dir)) for (const stud of child.topStuds) sideStuds.push({ at: apply(line.matrix, stud), dir });
        }
        for (const stud of child.sideStuds) {
          const dir = axisOf(turn(line.matrix, stud.dir));
          if (dir && !isUp(dir)) sideStuds.push({ at: apply(line.matrix, stud.at), dir });
        }
        for (const connector of child.connectors) {
          const placed = placeConnector(connector, line.matrix, inverted);
          if (placed) connectors.push(placed);
        }
        // a bar drawn as a plain cylinder; the cylinders studs are drawn with are studs, not bars
        const bar = isStud ? null : barPiece(line.file, line.matrix, inverted);
        if (bar) connectors.push(bar);
      }
    }
    const primitive = connectorPrimitive(key);
    // a connection primitive is one piece of a connection, whatever smaller ones it is drawn from
    const own = primitive ? connectorOf(primitive, triangles) : null;
    // the files minifigures, the older hinges and turntables are drawn from carry their joints too
    const joints = MINIFIG_JOINTS[key] ?? HINGE_JOINTS[key] ?? [];
    return { triangles, topStuds: dedupe(topStuds), sideStuds: dedupeDirected(sideStuds), connectors: own ? [own] : [...connectors, ...joints] };
  }
}

/** Flattens a part and everything it references into front-facing triangles. */
export function flattenPart(name: string, source: LibrarySource, flattener = new Flattener(source)): FlatPart {
  return flattener.flatten(name);
}
