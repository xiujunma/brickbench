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

export interface FlatPart {
  readonly triangles: readonly FlatTriangle[];
  /** Centres of upward-facing top studs, in LDraw coordinates. */
  readonly topStuds: readonly V3[];
}

/** Every stud primitive, top or underside. */
const STUD_PRIMITIVE = /^(48\/|8\/)?stud[^/]*\.dat$/;
/** Studs that stand on a top face, centred on a grid cell. */
const TOP_STUD = /^stud(2a?|a|26|6a?|9|10|13|15|17a?|el|h[lr]?|p01|-logo\d*|2-logo\d*)?\.dat$/;

function apply(tr: Transform, [x, y, z]: V3): V3 {
  const [a, b, c, d, e, f, g, h, i] = tr.m;
  return [a * x + b * y + c * z + tr.t[0], d * x + e * y + f * z + tr.t[1], g * x + h * y + i * z + tr.t[2]];
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

function dedupe(points: readonly V3[]): V3[] {
  const seen = new Set<string>();
  return points.filter(([x, y, z]) => {
    const key = `${Math.round(x * 100)},${Math.round(y * 100)},${Math.round(z * 100)}`;
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
        const flip = state.invertNext !== determinant(line.matrix) < 0;
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
        if (keepsUp(line.matrix)) for (const stud of child.topStuds) topStuds.push(apply(line.matrix, stud));
      }
    }
    return { triangles, topStuds: dedupe(topStuds) };
  }
}

/** Flattens a part and everything it references into front-facing triangles. */
export function flattenPart(name: string, source: LibrarySource, flattener = new Flattener(source)): FlatPart {
  return flattener.flatten(name);
}
