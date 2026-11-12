/**
 * Curve of an arch opening, in the arch's local frame (x centred, y = 0 at
 * the bottom). Openings at least as tall as half their span are semicircles
 * on straight legs; flatter openings use a circular segment.
 */
export interface ArchCurve {
  readonly halfSpan: number;
  readonly radius: number;
  readonly centerY: number;
  /** Height where the curve meets the straight inner face of the legs. */
  readonly springY: number;
}

/**
 * @param span opening width in studs
 * @param rise opening height at the centre, in world units
 */
export function archCurve(span: number, rise: number): ArchCurve {
  const halfSpan = span / 2;
  if (rise >= halfSpan) {
    return { halfSpan, radius: halfSpan, centerY: rise - halfSpan, springY: rise - halfSpan };
  }
  const radius = (halfSpan * halfSpan + rise * rise) / (2 * rise);
  return { halfSpan, radius, centerY: rise - radius, springY: 0 };
}

/** Height of the arch underside at horizontal offset x from the centre. */
export function archHeightAt(curve: ArchCurve, x: number): number {
  const ax = Math.min(Math.abs(x), curve.halfSpan);
  const dy = Math.sqrt(Math.max(0, curve.radius * curve.radius - ax * ax));
  return Math.max(curve.springY, curve.centerY + dy);
}
