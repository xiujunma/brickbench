import type { BufferGeometry } from 'three';
import { PLATE_HEIGHT, STUD_HEIGHT, STUD_RADIUS } from '../../core/grid';
import { archCurve } from '../../core/parts/arch';
import type { PartDef } from '../../core/parts/types';
import { loft, type LoftAxes } from './loft';
import { MeshBuilder, type V3 } from './meshBuilder';
import { buildPath, roundedRect, type Corner } from './path';
import { revolve } from './revolve';

/** Inset on every side so neighbouring bricks show a hairline seam (0.1 mm). */
export const BRICK_GAP = 0.0125;
export const BEVEL = 0.03;
const BEVEL_SEGMENTS = 3;
const SLOPE_LIP = 0.2;
const SLOPE_TOP_FLAT = 0.2;
const ARCH_SEGMENTS = 24;
const STUD_FILLET = 0.035;
/** Studs sink slightly into the face below so no crack shows at grazing angles. */
const STUD_SINK = 0.02;

export interface StudDetail {
  readonly radialSegments: number;
  readonly filletSegments: number;
}

export const STUD_DETAIL: StudDetail = { radialSegments: 20, filletSegments: 3 };
export const STUD_DETAIL_LOW: StudDetail = { radialSegments: 12, filletSegments: 1 };

const ALONG_Y: LoftAxes = { u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] };
const ALONG_X: LoftAxes = { u: [0, 0, 1], v: [0, 1, 0], w: [1, 0, 0] };
const ALONG_Z: LoftAxes = { u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] };

function addStud(builder: MeshBuilder, base: V3, detail: StudDetail): void {
  const profile = buildPath(
    [
      { u: STUD_RADIUS, v: -STUD_SINK },
      { u: STUD_RADIUS, v: STUD_HEIGHT, radius: STUD_FILLET },
      { u: 0, v: STUD_HEIGHT },
    ],
    detail.filletSegments,
    false,
  );
  revolve(builder, profile, detail.radialSegments, base);
}

/** One stud standing on y = 0, for instanced stud rendering. */
export function buildStudGeometry(detail: StudDetail = STUD_DETAIL): BufferGeometry {
  const builder = new MeshBuilder();
  addStud(builder, [0, 0, 0], detail);
  return builder.build();
}

function addBox(builder: MeshBuilder, part: PartDef, height: number): void {
  const outline = buildPath(roundedRect(part.w / 2 - BRICK_GAP, part.d / 2 - BRICK_GAP, BEVEL), BEVEL_SEGMENTS, true);
  loft(builder, outline, ALONG_Y, { from: 0, to: height, bevel: BEVEL, bevelSegments: BEVEL_SEGMENTS });
}

/** Side profile of a slope in (z, y), counter-clockwise; stud rows at -Z. */
function slopeCorners(part: PartDef, height: number, run: number, inverted: boolean): Corner[] {
  const back = -part.d / 2 + BRICK_GAP;
  const front = part.d / 2 - BRICK_GAP;
  const rowEdge = -part.d / 2 + (part.d - run);
  const lip = Math.min(SLOPE_LIP, height / 3);
  const r = BEVEL;
  if (inverted) {
    return [
      { u: back, v: 0, radius: r },
      { u: rowEdge, v: 0, radius: r },
      { u: front, v: height - lip, radius: r },
      { u: front, v: height, radius: r },
      { u: back, v: height, radius: r },
    ];
  }
  // stud-less slopes (cheese) keep a short flat at the back of the top, like the real part
  const topEdge = rowEdge > back + 1e-6 ? rowEdge : back + SLOPE_TOP_FLAT;
  return [
    { u: back, v: 0, radius: r },
    { u: front, v: 0, radius: r },
    { u: front, v: lip, radius: r },
    { u: topEdge, v: height, radius: r },
    { u: back, v: height, radius: r },
  ];
}

function addSlope(builder: MeshBuilder, part: PartDef, height: number, run: number, inverted: boolean): void {
  const outline = buildPath(slopeCorners(part, height, run, inverted), BEVEL_SEGMENTS, true);
  const half = part.w / 2 - BRICK_GAP;
  loft(builder, outline, ALONG_X, { from: -half, to: half, bevel: BEVEL, bevelSegments: BEVEL_SEGMENTS });
}

/** Front profile of an arch in (x, y), counter-clockwise around the solid. */
function archCorners(part: PartDef, height: number, span: number, rise: number): Corner[] {
  const outer = part.w / 2 - BRICK_GAP;
  const curve = archCurve(span, rise);
  const r = BEVEL;
  const arc: Corner[] = [];
  const startAngle = Math.atan2(curve.springY - curve.centerY, -curve.halfSpan);
  const endAngle = Math.atan2(curve.springY - curve.centerY, curve.halfSpan);
  for (let i = 1; i < ARCH_SEGMENTS; i++) {
    const a = startAngle + ((endAngle - startAngle) * i) / ARCH_SEGMENTS;
    arc.push({ u: Math.cos(a) * curve.radius, v: curve.centerY + Math.sin(a) * curve.radius, mode: 'smooth' });
  }
  const leftSpring: Corner[] = curve.springY > 1e-6 ? [{ u: -curve.halfSpan, v: curve.springY, mode: 'smooth' }] : [];
  const rightSpring: Corner[] = curve.springY > 1e-6 ? [{ u: curve.halfSpan, v: curve.springY, mode: 'smooth' }] : [];
  return [
    { u: -outer, v: 0, radius: r },
    { u: -curve.halfSpan, v: 0, radius: r },
    ...leftSpring,
    ...arc,
    ...rightSpring,
    { u: curve.halfSpan, v: 0, radius: r },
    { u: outer, v: 0, radius: r },
    { u: outer, v: height, radius: r },
    { u: -outer, v: height, radius: r },
  ];
}

function addArch(builder: MeshBuilder, part: PartDef, height: number, span: number, rise: number): void {
  const outline = buildPath(archCorners(part, height, span, rise), BEVEL_SEGMENTS, true);
  const half = part.d / 2 - BRICK_GAP;
  loft(builder, outline, ALONG_Z, { from: -half, to: half, bevel: BEVEL, bevelSegments: BEVEL_SEGMENTS });
}

function addRound(builder: MeshBuilder, part: PartDef, height: number, profile: 'cylinder' | 'cone'): void {
  const radius = Math.min(part.w, part.d) / 2 - BRICK_GAP;
  const corners: Corner[] =
    profile === 'cone'
      ? [
          { u: 0, v: 0 },
          { u: radius, v: 0, radius: BEVEL },
          { u: radius, v: 0.16, radius: BEVEL },
          { u: STUD_RADIUS + 0.03, v: height, radius: BEVEL },
          { u: 0, v: height },
        ]
      : [
          { u: 0, v: 0 },
          { u: radius, v: 0, radius: BEVEL },
          { u: radius, v: height, radius: BEVEL },
          { u: 0, v: height },
        ];
  revolve(builder, buildPath(corners, BEVEL_SEGMENTS, false), Math.max(24, Math.round(radius * 40)));
}

function addBody(builder: MeshBuilder, part: PartDef): void {
  const height = part.h * PLATE_HEIGHT;
  const shape = part.shape;
  switch (shape.kind) {
    case 'box':
      addBox(builder, part, height);
      return;
    case 'slope':
      addSlope(builder, part, height, shape.run, shape.inverted);
      return;
    case 'arch':
      addArch(builder, part, height, shape.span, shape.rise);
      return;
    case 'round':
      addRound(builder, part, height, shape.profile);
      return;
    case 'mesh':
      // library parts bring their own mesh; this box stands in while it loads
      addBox(builder, part, height);
      return;
  }
}

/** A size×size slab whose top face sits at y = 0, for the baseplate. */
export function buildBaseplateGeometry(size: number, thickness: number): BufferGeometry {
  const builder = new MeshBuilder();
  const half = size / 2 - BRICK_GAP;
  const outline = buildPath(roundedRect(half, half, BEVEL), BEVEL_SEGMENTS, true);
  loft(builder, outline, ALONG_Y, { from: -thickness, to: 0, bevel: BEVEL, bevelSegments: BEVEL_SEGMENTS });
  return builder.build();
}

/** Centre of a stud's base in the part's local frame. */
export function studBase(part: PartDef, lx: number, lz: number): V3 {
  return [lx + 0.5 - part.w / 2, part.h * PLATE_HEIGHT, lz + 0.5 - part.d / 2];
}

/** Part body without studs, for instanced rendering. */
export function buildBodyGeometry(part: PartDef): BufferGeometry {
  const builder = new MeshBuilder();
  addBody(builder, part);
  return builder.build();
}

/** Body plus studs, for single meshes, previews and exports. */
export function buildPartGeometry(part: PartDef, detail: StudDetail = STUD_DETAIL): BufferGeometry {
  const builder = new MeshBuilder();
  addBody(builder, part);
  for (const [lx, lz] of part.studs) addStud(builder, studBase(part, lx, lz), detail);
  return builder.build();
}
