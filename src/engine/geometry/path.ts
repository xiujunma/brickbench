/**
 * 2D paths with rounded corners and outward normals, used as loft outlines
 * and lathe profiles. Paths run with the solid on their left (counter-
 * clockwise around it), so the outward normal is the right-hand side.
 */
export interface PathPoint {
  readonly u: number;
  readonly v: number;
  /** Outward unit normal. */
  readonly nu: number;
  readonly nv: number;
}

export type CornerMode = 'fillet' | 'smooth' | 'sharp';

export interface Corner {
  readonly u: number;
  readonly v: number;
  /** fillet: round with `radius`; smooth: part of a curve; sharp: crease with two normals. */
  readonly mode?: CornerMode;
  readonly radius?: number;
}

const COLLINEAR = 1e-6;

interface Dir {
  readonly u: number;
  readonly v: number;
  readonly length: number;
}

function direction(from: Corner, to: Corner): Dir {
  const du = to.u - from.u;
  const dv = to.v - from.v;
  const length = Math.hypot(du, dv);
  return length > 0 ? { u: du / length, v: dv / length, length } : { u: 0, v: 0, length: 0 };
}

/** Outward normal of an edge running in direction d (its right-hand side). */
function rightOf(d: Dir): readonly [number, number] {
  return [d.v, -d.u];
}

function point(u: number, v: number, nu: number, nv: number): PathPoint {
  const length = Math.hypot(nu, nv) || 1;
  return { u, v, nu: nu / length, nv: nv / length };
}

function fillet(corner: Corner, din: Dir, dout: Dir, radius: number, segments: number): PathPoint[] {
  const cross = din.u * dout.v - din.v * dout.u;
  const turn = Math.acos(Math.min(1, Math.max(-1, din.u * dout.u + din.v * dout.v)));
  if (turn < COLLINEAR) {
    const [nu, nv] = rightOf(din);
    return [point(corner.u, corner.v, nu, nv)];
  }
  const halfTan = Math.tan(turn / 2);
  const tangent = Math.min(radius * halfTan, din.length / 2, dout.length / 2);
  const r = tangent / halfTan;
  const convex = cross > 0;
  // centre sits on the inside of the turn
  const side = convex ? 1 : -1;
  const t1u = corner.u - din.u * tangent;
  const t1v = corner.v - din.v * tangent;
  const cu = t1u - din.v * r * side;
  const cv = t1v + din.u * r * side;
  const start = Math.atan2(t1v - cv, t1u - cu);
  const sweep = convex ? turn : -turn;

  const points: PathPoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = start + (sweep * i) / segments;
    const pu = cu + Math.cos(a) * r;
    const pv = cv + Math.sin(a) * r;
    const nu = convex ? pu - cu : cu - pu;
    const nv = convex ? pv - cv : cv - pv;
    points.push(point(pu, pv, nu, nv));
  }
  return points;
}

/**
 * Expands corners into a sampled path. Closed paths wrap around; open paths
 * keep their first and last points as plain end points.
 */
export function buildPath(corners: readonly Corner[], segments: number, closed: boolean): PathPoint[] {
  const n = corners.length;
  const out: PathPoint[] = [];
  for (let i = 0; i < n; i++) {
    const corner = corners[i]!;
    const prev = closed ? corners[(i - 1 + n) % n] : corners[i - 1];
    const next = closed ? corners[(i + 1) % n] : corners[i + 1];
    const din = prev ? direction(prev, corner) : null;
    const dout = next ? direction(corner, next) : null;

    if (!din || !dout) {
      const edge = (din ?? dout)!;
      const [nu, nv] = rightOf(edge);
      out.push(point(corner.u, corner.v, nu, nv));
      continue;
    }

    const mode = corner.mode ?? 'fillet';
    if (mode === 'fillet' && (corner.radius ?? 0) > 0) {
      out.push(...fillet(corner, din, dout, corner.radius ?? 0, segments));
    } else if (mode === 'sharp') {
      const [ainu, ainv] = rightOf(din);
      const [aonu, aonv] = rightOf(dout);
      out.push(point(corner.u, corner.v, ainu, ainv), point(corner.u, corner.v, aonu, aonv));
    } else {
      const [ainu, ainv] = rightOf(din);
      const [aonu, aonv] = rightOf(dout);
      out.push(point(corner.u, corner.v, ainu + aonu, ainv + aonv));
    }
  }
  return out;
}

/** Corners of an axis-aligned rectangle, counter-clockwise, all filleted. */
export function roundedRect(halfU: number, halfV: number, radius: number): Corner[] {
  return [
    { u: -halfU, v: -halfV, radius },
    { u: halfU, v: -halfV, radius },
    { u: halfU, v: halfV, radius },
    { u: -halfU, v: halfV, radius },
  ];
}
