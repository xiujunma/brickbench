import { MAX_SOLIDS, type SolidBox } from '../../src/core/ldraw/format.ts';
import type { MeshTriangle } from './mesh.ts';

/**
 * Which cells of its box a part really fills, so an L-shaped plate leaves its
 * corner free and an arch its opening. A cell is filled when the part's
 * surface reaches into it, or when it lies in space the part encloses: shut
 * in on every side and above, as under a brick, whose hollow underside is
 * kept for the studs below. Space reached from the sides or from above is
 * free; the floor counts as closed, since the part stands on something.
 */

/** Plate height in studs, as in fit.ts. */
const PLATE = 0.4;
/**
 * Surface reaching less than this into a cell (two LDraw units, in studs)
 * leaves it free: about as lenient as the openings of the basic arches, and
 * half the overhang fit.ts allows a part at its sides.
 */
const SLIVER = 0.1;
/** Samples per stud across and per plate up when looking for enclosed space. */
const ACROSS = 4;
const UP = 2;
/** A sample line passing this close to a triangle (in studs) hits it, so hairline seams do not leak. */
const SEAM = 0.005;
/** Rounding slack, so a face exactly a sliver into a cell counts the same on every side of a part. */
const EPS = 1e-9;
/** Bigger parts keep their whole box, which is never wrong, only cautious. */
const MAX_CELLS = 1 << 20;
const MAX_SAMPLES = 1 << 23;
/** Parts reaching further outside their box than this many sample layers keep their whole box too. */
const MAX_PAD = 8;

export interface CellSize {
  readonly w: number;
  readonly d: number;
  readonly h: number;
}

/** A limit, loosened by rounding slack in proportion to its size. */
const loosen = (limit: number): number => limit + EPS * (1 + Math.abs(limit));

/** Separating-axis test of a triangle against a box given by its centre and half sizes. */
function touchesBox(t: MeshTriangle, ox: number, oy: number, oz: number, hx: number, hy: number, hz: number): boolean {
  const ax = t.a[0] - ox, ay = t.a[1] - oy, az = t.a[2] - oz;
  const bx = t.b[0] - ox, by = t.b[1] - oy, bz = t.b[2] - oz;
  const cx = t.c[0] - ox, cy = t.c[1] - oy, cz = t.c[2] - oz;
  const apart = (p: number, q: number, r: number, reach: number): boolean => Math.min(p, q, r) > loosen(reach) || Math.max(p, q, r) < -loosen(reach);
  if (apart(ax, bx, cx, hx) || apart(ay, by, cy, hy) || apart(az, bz, cz, hz)) return false;
  const edges = [
    [bx - ax, by - ay, bz - az],
    [cx - bx, cy - by, cz - bz],
    [ax - cx, ay - cy, az - cz],
  ] as const;
  for (const [ex, ey, ez] of edges) {
    // the edge crossed with each of the box's axes
    if (apart(ez * ay - ey * az, ez * by - ey * bz, ez * cy - ey * cz, hy * Math.abs(ez) + hz * Math.abs(ey))) return false;
    if (apart(ex * az - ez * ax, ex * bz - ez * bx, ex * cz - ez * cx, hx * Math.abs(ez) + hz * Math.abs(ex))) return false;
    if (apart(ey * ax - ex * ay, ey * bx - ex * by, ey * cx - ex * cy, hx * Math.abs(ey) + hy * Math.abs(ex))) return false;
  }
  const [ux, uy, uz] = edges[0];
  const [vx, vy, vz] = edges[1];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  return Math.abs(nx * ax + ny * ay + nz * az) <= loosen(hx * Math.abs(nx) + hy * Math.abs(ny) + hz * Math.abs(nz));
}

/** Cells (one flag each, x fastest, then z, then y) that the surface reaches into by more than a sliver. */
function surfaceCells(triangles: readonly MeshTriangle[], { w, d, h }: CellSize): Uint8Array {
  const filled = new Uint8Array(w * d * h);
  const plateSliver = SLIVER / PLATE;
  for (const t of triangles) {
    const xs = [t.a[0] + w / 2, t.b[0] + w / 2, t.c[0] + w / 2];
    const ys = [t.a[1] / PLATE, t.b[1] / PLATE, t.c[1] / PLATE];
    const zs = [t.a[2] + d / 2, t.b[2] + d / 2, t.c[2] + d / 2];
    // the cells it may reach a sliver into; touchesBox decides, so these err on the wide side
    const x0 = Math.max(0, Math.ceil(Math.min(...xs) - 1 + SLIVER - EPS)), x1 = Math.min(w - 1, Math.floor(Math.max(...xs) - SLIVER + EPS));
    const y0 = Math.max(0, Math.ceil(Math.min(...ys) - 1 + plateSliver - EPS)), y1 = Math.min(h - 1, Math.floor(Math.max(...ys) - plateSliver + EPS));
    const z0 = Math.max(0, Math.ceil(Math.min(...zs) - 1 + SLIVER - EPS)), z1 = Math.min(d - 1, Math.floor(Math.max(...zs) - SLIVER + EPS));
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const cell = (y * d + z) * w + x;
          if (filled[cell] === 0 && touchesBox(t, x + 0.5 - w / 2, (y + 0.5) * PLATE, z + 0.5 - d / 2, 0.5 - SLIVER, PLATE / 2 - SLIVER, 0.5 - SLIVER)) {
            filled[cell] = 1;
          }
        }
      }
    }
  }
  return filled;
}

/** One axis of the sample grid: where its samples sit and how far apart they are in the flat array. */
interface SampleAxis {
  readonly count: number;
  readonly stride: number;
  /** The bit marking a blocked step from a sample to the next one along this axis. */
  readonly bit: number;
  readonly at: (index: number) => number;
  /** The last sample at or before a position. */
  readonly below: (value: number) => number;
}

/** Sample layers added outside each side of the box but the bottom. */
interface Pads {
  readonly left: number;
  readonly right: number;
  readonly back: number;
  readonly front: number;
  readonly top: number;
}

/**
 * Enough layers outside the box that the outermost lies beyond everything the
 * part reaches there (a body may overhang its box, studs stand on top), so
 * the flood starts outside the part. Null when that is too many.
 */
function padsFor(triangles: readonly MeshTriangle[], { w, d, h }: CellSize): Pads | null {
  let left = 0, right = 0, back = 0, front = 0, top = 0;
  for (const t of triangles) {
    for (const [x, y, z] of [t.a, t.b, t.c]) {
      left = Math.max(left, -w / 2 - x);
      right = Math.max(right, x - w / 2);
      back = Math.max(back, -d / 2 - z);
      front = Math.max(front, z - d / 2);
      top = Math.max(top, y - h * PLATE);
    }
  }
  // the outermost of n layers spaced s apart sits (n - 0.5) s outside the box
  const layers = (beyond: number, spacing: number): number => Math.floor(beyond / spacing + 0.5) + 1;
  const pads = { left: layers(left, 1 / ACROSS), right: layers(right, 1 / ACROSS), back: layers(back, 1 / ACROSS), front: layers(front, 1 / ACROSS), top: layers(top, PLATE / UP) };
  return Object.values(pads).every((n) => n <= MAX_PAD) ? pads : null;
}

/**
 * Samples a little inside every cell, plus layers around the sides and over
 * the top of the box whose outermost counts as outside; none below, so the
 * floor is closed.
 */
function sampleAxes({ w, d, h }: CellSize, pad: Pads): readonly [SampleAxis, SampleAxis, SampleAxis] {
  const nx = pad.left + w * ACROSS + pad.right, ny = h * UP + pad.top, nz = pad.back + d * ACROSS + pad.front;
  return [
    { count: nx, stride: 1, bit: 1, at: (i) => (i - pad.left + 0.5) / ACROSS - w / 2, below: (v) => Math.floor((v + w / 2) * ACROSS - 0.5 + pad.left) },
    { count: ny, stride: nx * nz, bit: 2, at: (j) => ((j + 0.5) * PLATE) / UP, below: (v) => Math.floor((v * UP) / PLATE - 0.5) },
    { count: nz, stride: nx, bit: 4, at: (k) => (k - pad.back + 0.5) / ACROSS - d / 2, below: (v) => Math.floor((v + d / 2) * ACROSS - 0.5 + pad.back) },
  ];
}

/** Marks the steps between neighbouring samples along one axis that a triangle cuts. */
function blockSteps(t: MeshTriangle, axes: readonly [SampleAxis, SampleAxis, SampleAxis], along: 0 | 1 | 2, blocked: Uint8Array): void {
  const b = ((along + 1) % 3) as 0 | 1 | 2;
  const c = ((along + 2) % 3) as 0 | 1 | 2;
  const [a1, b1, c1] = [t.a[b], t.b[b], t.c[b]];
  const [a2, b2, c2] = [t.a[c], t.b[c], t.c[c]];
  // twice the triangle's area seen along the axis, which is also its normal's part along it
  const area = (b1 - a1) * (c2 - a2) - (b2 - a2) * (c1 - a1);
  if (Math.abs(area) < 1e-12) return;
  const sign = Math.sign(area);
  const corners = [[a1, a2], [b1, b2], [c1, c2]] as const;
  const inside = (p: number, q: number): boolean =>
    corners.every(([pFrom, qFrom], i) => {
      const [pTo, qTo] = corners[(i + 1) % 3] ?? corners[0];
      const length = Math.hypot(pTo - pFrom, qTo - qFrom);
      return length === 0 || (sign * ((pTo - pFrom) * (q - qFrom) - (qTo - qFrom) * (p - pFrom))) / length >= -SEAM;
    });
  const [line, side, cut] = [axes[b], axes[c], axes[along]];
  const n = [
    (t.b[1] - t.a[1]) * (t.c[2] - t.a[2]) - (t.b[2] - t.a[2]) * (t.c[1] - t.a[1]),
    (t.b[2] - t.a[2]) * (t.c[0] - t.a[0]) - (t.b[0] - t.a[0]) * (t.c[2] - t.a[2]),
    (t.b[0] - t.a[0]) * (t.c[1] - t.a[1]) - (t.b[1] - t.a[1]) * (t.c[0] - t.a[0]),
  ] as const;
  const p0 = Math.max(0, line.below(Math.min(a1, b1, c1) - SEAM - 1e-9) + 1);
  const p1 = Math.min(line.count - 1, line.below(Math.max(a1, b1, c1) + SEAM));
  const q0 = Math.max(0, side.below(Math.min(a2, b2, c2) - SEAM - 1e-9) + 1);
  const q1 = Math.min(side.count - 1, side.below(Math.max(a2, b2, c2) + SEAM));
  for (let i = p0; i <= p1; i++) {
    const p = line.at(i);
    for (let j = q0; j <= q1; j++) {
      const q = side.at(j);
      if (!inside(p, q)) continue;
      // where the line along the axis meets the triangle's plane
      const hit = t.a[along] - (n[b] * (p - a1) + n[c] * (q - a2)) / n[along];
      const step = cut.below(hit);
      if (step >= 0 && step < cut.count - 1) {
        const sample = step * cut.stride + i * line.stride + j * side.stride;
        blocked[sample] = (blocked[sample] ?? 0) | cut.bit;
      }
    }
  }
}

/** Floods the sample grid from its outermost layers; returns which samples the outside reaches. */
function floodOutside(axes: readonly [SampleAxis, SampleAxis, SampleAxis], blocked: Uint8Array): Uint8Array {
  const [x, y, z] = axes;
  const total = x.count * y.count * z.count;
  const outside = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const reach = (sample: number): void => {
    if (outside[sample] === 0) {
      outside[sample] = 1;
      queue[tail++] = sample;
    }
  };
  for (let j = 0; j < y.count; j++) {
    for (let k = 0; k < z.count; k++) {
      reach(j * y.stride + k * z.stride);
      reach(j * y.stride + k * z.stride + x.count - 1);
    }
    for (let i = 0; i < x.count; i++) {
      reach(j * y.stride + i);
      reach(j * y.stride + (z.count - 1) * z.stride + i);
    }
  }
  for (let k = 0; k < z.count; k++) for (let i = 0; i < x.count; i++) reach((y.count - 1) * y.stride + k * z.stride + i);

  while (head < tail) {
    const sample = queue[head++] ?? 0;
    const i = sample % x.count;
    const k = Math.floor(sample / z.stride) % z.count;
    const j = Math.floor(sample / y.stride);
    const steps = blocked[sample] ?? 0;
    if (i + 1 < x.count && !(steps & x.bit)) reach(sample + 1);
    if (i > 0 && !((blocked[sample - 1] ?? 0) & x.bit)) reach(sample - 1);
    if (k + 1 < z.count && !(steps & z.bit)) reach(sample + z.stride);
    if (k > 0 && !((blocked[sample - z.stride] ?? 0) & z.bit)) reach(sample - z.stride);
    if (j + 1 < y.count && !(steps & y.bit)) reach(sample + y.stride);
    if (j > 0 && !((blocked[sample - y.stride] ?? 0) & y.bit)) reach(sample - y.stride);
  }
  return outside;
}

/** Fills the cells left empty by the surface that hold space the outside cannot reach. */
function fillEnclosed(triangles: readonly MeshTriangle[], size: CellSize, filled: Uint8Array): boolean {
  const pads = padsFor(triangles, size);
  if (!pads) return false;
  const axes = sampleAxes(size, pads);
  const [x, y, z] = axes;
  if (x.count * y.count * z.count > MAX_SAMPLES) return false;
  const blocked = new Uint8Array(x.count * y.count * z.count);
  for (const t of triangles) for (const along of [0, 1, 2] as const) blockSteps(t, axes, along, blocked);
  const outside = floodOutside(axes, blocked);
  const { w, d, h } = size;
  for (let cy = 0; cy < h; cy++) {
    for (let cz = 0; cz < d; cz++) {
      for (let cx = 0; cx < w; cx++) {
        const cell = (cy * d + cz) * w + cx;
        if (filled[cell] === 1) continue;
        search: for (let j = cy * UP; j < (cy + 1) * UP; j++) {
          for (let k = pads.back + cz * ACROSS; k < pads.back + (cz + 1) * ACROSS; k++) {
            for (let i = pads.left + cx * ACROSS; i < pads.left + (cx + 1) * ACROSS; i++) {
              if (outside[j * y.stride + k * z.stride + i] === 0) {
                filled[cell] = 1;
                break search;
              }
            }
          }
        }
      }
    }
  }
  return true;
}

/** Merges filled cells into boxes, greedily: along x, then z, then up. */
function mergeBoxes(filled: Uint8Array, { w, d, h }: CellSize): SolidBox[] {
  const used = new Uint8Array(filled.length);
  const open = (x: number, y: number, z: number): boolean => {
    const cell = (y * d + z) * w + x;
    return filled[cell] === 1 && used[cell] === 0;
  };
  const rowOpen = (x0: number, x1: number, y: number, z: number): boolean => {
    for (let x = x0; x < x1; x++) if (!open(x, y, z)) return false;
    return true;
  };
  const boxes: SolidBox[] = [];
  for (let y = 0; y < h; y++) {
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        if (!open(x, y, z)) continue;
        let x1 = x + 1;
        while (x1 < w && open(x1, y, z)) x1++;
        let z1 = z + 1;
        while (z1 < d && rowOpen(x, x1, y, z1)) z1++;
        let y1 = y + 1;
        const layerOpen = (layer: number): boolean => {
          for (let zz = z; zz < z1; zz++) if (!rowOpen(x, x1, layer, zz)) return false;
          return true;
        };
        while (y1 < h && layerOpen(y1)) y1++;
        for (let yy = y; yy < y1; yy++) for (let zz = z; zz < z1; zz++) for (let xx = x; xx < x1; xx++) used[(yy * d + zz) * w + xx] = 1;
        boxes.push([x, y, z, x1, y1, z1]);
      }
    }
  }
  return boxes;
}

/**
 * The cells of its box a part fills, as boxes, or null when that is every
 * cell (or the part is too big or too sketchy to tell). Triangles are in
 * editor units as the mesh is built: the footprint centred on x = z = 0 and
 * the body standing on y = 0, a plate being 0.4 high.
 */
export function filledCells(triangles: readonly MeshTriangle[], size: CellSize): SolidBox[] | null {
  const cells = size.w * size.d * size.h;
  if (triangles.length === 0 || cells > MAX_CELLS) return null;
  const filled = surfaceCells(triangles, size);
  if (filled.every((cell) => cell === 1)) return null;
  if (!fillEnclosed(triangles, size, filled)) return null;
  const count = filled.reduce((sum, cell) => sum + cell, 0);
  if (count === cells || count === 0) return null;
  const boxes = mergeBoxes(filled, size);
  return boxes.length > MAX_SOLIDS ? null : boxes;
}
