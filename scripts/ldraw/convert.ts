import type { SolidBox } from '../../src/core/ldraw/format.ts';
import { filledCells } from './cells.ts';
import type { Flattener, FlatTriangle } from './flatten.ts';
import { fitPart, type PartFit } from './fit.ts';
import { buildMesh, type MeshData } from './mesh.ts';
import type { V3 } from './parse.ts';

/** LDraw units per stud. */
const LDU = 20;
/** Meshes beyond this are left out: a few twisted strings run to 300k vertices. */
export const MAX_VERTICES = 200_000;

export type Conversion =
  | {
      readonly ok: true;
      readonly mesh: MeshData;
      readonly fit: PartFit;
      /** The cells the part fills, when it leaves some of its box empty; null when it fills it all. */
      readonly solids: readonly SolidBox[] | null;
      readonly triangles: number;
    }
  | { readonly ok: false; readonly reason: 'empty' | 'multicolour' | 'too detailed' };

/** LDraw (-Y up, LDU) to editor units (+Y up, studs): a half turn about X, so windings survive. */
export function toEditor([x, y, z]: V3): V3 {
  return [x / LDU, -y / LDU, -z / LDU];
}

interface Box {
  readonly min: V3;
  readonly max: V3;
}

function bounds(triangles: readonly FlatTriangle[], include: (t: FlatTriangle) => boolean): Box | null {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let found = false;
  for (const t of triangles) {
    if (!include(t)) continue;
    found = true;
    for (const p of [t.a, t.b, t.c]) {
      const q = toEditor(p);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k] ?? Infinity, q[k] ?? 0);
        max[k] = Math.max(max[k] ?? -Infinity, q[k] ?? 0);
      }
    }
  }
  return found ? { min: [min[0] ?? 0, min[1] ?? 0, min[2] ?? 0], max: [max[0] ?? 0, max[1] ?? 0, max[2] ?? 0] } : null;
}

/**
 * The box a part fills: sides and top from everything but stud primitives
 * (top studs poke out above, side studs sideways), bottom from everything,
 * since the tubes under plates and round parts are stud primitives too.
 */
function bodyBounds(triangles: readonly FlatTriangle[]): Box | null {
  const all = bounds(triangles, () => true);
  if (!all) return null;
  const body = bounds(triangles, (t) => !t.stud) ?? all;
  return { min: [body.min[0], Math.min(body.min[1], all.min[1]), body.min[2]], max: body.max };
}

/**
 * Converts one LDraw part into an editor mesh standing on its grid footprint.
 * Parts drawn in more than one fixed colour are skipped: the editor colours
 * a part as a whole.
 */
export function convertPart(file: string, flattener: Flattener): Conversion {
  const part = flattener.flatten(file);
  if (part.triangles.length === 0) return { ok: false, reason: 'empty' };
  if (new Set(part.triangles.map((t) => t.color)).size > 1) return { ok: false, reason: 'multicolour' };

  const body = bodyBounds(part.triangles);
  if (!body) return { ok: false, reason: 'empty' };
  const fit = fitPart(body.min, body.max, part.topStuds.map(toEditor));
  const [ox, oy, oz] = fit.offset;
  const place = (p: V3): V3 => {
    const [x, y, z] = toEditor(p);
    return [x + ox, y + oy, z + oz];
  };
  const placed = part.triangles.map((t) => ({ a: place(t.a), b: place(t.b), c: place(t.c), doubleSided: t.doubleSided }));
  const mesh = buildMesh(placed);
  if (mesh.positions.length / 3 > MAX_VERTICES) return { ok: false, reason: 'too detailed' };
  return { ok: true, mesh, fit, solids: filledCells(placed, fit), triangles: part.triangles.length };
}
