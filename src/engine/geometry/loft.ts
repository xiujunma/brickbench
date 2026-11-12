import { ShapeUtils, Vector2 } from 'three';
import type { MeshBuilder, V3 } from './meshBuilder';
import type { PathPoint } from './path';

/** Maps the outline plane (u, v) and the extrusion axis w onto world axes. */
export interface LoftAxes {
  readonly u: V3;
  readonly v: V3;
  readonly w: V3;
}

export interface LoftOptions {
  readonly from: number;
  readonly to: number;
  /** Radius of the rounded edge around both end caps. */
  readonly bevel: number;
  readonly bevelSegments: number;
}

const DEDUPE = 1e-7;

function toWorld(axes: LoftAxes, u: number, v: number, w: number): V3 {
  return [
    axes.u[0] * u + axes.v[0] * v + axes.w[0] * w,
    axes.u[1] * u + axes.v[1] * v + axes.w[1] * w,
    axes.u[2] * u + axes.v[2] * v + axes.w[2] * w,
  ];
}

interface Ring {
  readonly w: number;
  /** Fraction of the bevel radius the outline is pulled in by. */
  readonly inset: number;
  /** Mix between outline normal (0) and axis normal (±1). */
  readonly cos: number;
  readonly sin: number;
}

function rings(options: LoftOptions): Ring[] {
  const { from, to, bevel, bevelSegments } = options;
  if (bevel <= 0 || bevelSegments <= 0) {
    return [
      { w: from, inset: 0, cos: 1, sin: 0 },
      { w: to, inset: 0, cos: 1, sin: 0 },
    ];
  }
  const out: Ring[] = [];
  for (let i = bevelSegments; i >= 0; i--) {
    const phi = (Math.PI / 2) * (i / bevelSegments);
    out.push({ w: from + bevel - bevel * Math.sin(phi), inset: 1 - Math.cos(phi), cos: Math.cos(phi), sin: -Math.sin(phi) });
  }
  for (let i = 0; i <= bevelSegments; i++) {
    const phi = (Math.PI / 2) * (i / bevelSegments);
    out.push({ w: to - bevel + bevel * Math.sin(phi), inset: 1 - Math.cos(phi), cos: Math.cos(phi), sin: Math.sin(phi) });
  }
  return out;
}

function cap(builder: MeshBuilder, outline: readonly PathPoint[], axes: LoftAxes, w: number, inset: number, sign: number): void {
  const contour: Vector2[] = [];
  for (const p of outline) {
    const next = new Vector2(p.u - p.nu * inset, p.v - p.nv * inset);
    const last = contour[contour.length - 1];
    if (!last || last.distanceTo(next) > DEDUPE) contour.push(next);
  }
  while (contour.length > 1 && contour[0]!.distanceTo(contour[contour.length - 1]!) <= DEDUPE) contour.pop();
  if (contour.length < 3) return;

  const normal: V3 = [axes.w[0] * sign, axes.w[1] * sign, axes.w[2] * sign];
  const indices = contour.map((p) => builder.vertex(toWorld(axes, p.x, p.y, w), normal));
  for (const [a, b, c] of ShapeUtils.triangulateShape([...contour], [])) {
    builder.triangle(indices[a!]!, indices[b!]!, indices[c!]!);
  }
}

/**
 * Extrudes a closed outline along w with rounded edges at both ends. Corners
 * of the outline should be filleted with at least the bevel radius so the
 * pulled-in end rings stay valid.
 */
export function loft(builder: MeshBuilder, outline: readonly PathPoint[], axes: LoftAxes, options: LoftOptions): void {
  const n = outline.length;
  const ringList = rings(options);
  const ringStarts: number[] = [];

  for (const ring of ringList) {
    ringStarts.push(builder.vertexCount);
    const pull = ring.inset * options.bevel;
    for (const p of outline) {
      const position = toWorld(axes, p.u - p.nu * pull, p.v - p.nv * pull, ring.w);
      const nu = p.nu * ring.cos;
      const nv = p.nv * ring.cos;
      const normal: V3 = [
        axes.u[0] * nu + axes.v[0] * nv + axes.w[0] * ring.sin,
        axes.u[1] * nu + axes.v[1] * nv + axes.w[1] * ring.sin,
        axes.u[2] * nu + axes.v[2] * nv + axes.w[2] * ring.sin,
      ];
      builder.vertex(position, normal);
    }
  }

  for (let r = 0; r < ringList.length - 1; r++) {
    const a0 = ringStarts[r]!;
    const b0 = ringStarts[r + 1]!;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      builder.quad(a0 + i, a0 + j, b0 + j, b0 + i);
    }
  }

  const fullInset = options.bevel > 0 && options.bevelSegments > 0 ? options.bevel : 0;
  cap(builder, outline, axes, options.from, fullInset, -1);
  cap(builder, outline, axes, options.to, fullInset, 1);
}
