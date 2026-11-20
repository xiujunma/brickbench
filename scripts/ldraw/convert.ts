import { CONNECTOR_KINDS, MAIN_COLOUR, type ConnectorEntry, type SideStudEntry, type SolidBox } from '../../src/core/ldraw/format.ts';
import { FACINGS, facingOfVector } from '../../src/core/orientation.ts';
import { filledCells } from './cells.ts';
import { colourFor, type ColourTable } from './colours.ts';
import { finishConnectors } from './connectors.ts';
import type { Flattener, FlatTriangle } from './flatten.ts';
import { fitPart, type PartFit } from './fit.ts';
import { buildMesh, joinColourMeshes, type LayeredMeshData, type MeshTriangle } from './mesh.ts';
import type { V3 } from './parse.ts';

/** LDraw units per stud. */
const LDU = 20;
/** Meshes beyond this are left out: a few twisted strings run to 300k vertices. */
export const MAX_VERTICES = 200_000;

export type Conversion =
  | {
      readonly ok: true;
      readonly mesh: LayeredMeshData;
      readonly fit: PartFit;
      /** The cells the part fills, when it leaves some of its box empty; null when it fills it all. */
      readonly solids: readonly SolidBox[] | null;
      /** Its studs that face sideways or down, where they stand on the placed part (see SideStudEntry). */
      readonly sideStuds: readonly SideStudEntry[];
      /** Its Technic and click-hinge connections, in the placed part's frame (see ConnectorEntry). */
      readonly connectors: readonly ConnectorEntry[];
      readonly triangles: number;
    }
  | { readonly ok: false; readonly reason: 'empty' | 'too detailed' };

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

/** The brick's own colour first, then the colours the part fixes, by code. */
function byColour(a: number, b: number): number {
  if (a === MAIN_COLOUR || b === MAIN_COLOUR) return a === MAIN_COLOUR ? -1 : 1;
  return a - b;
}

/**
 * The part's mesh, in layers by colour when it is drawn in several, such as
 * a wheel with its tyre: the brick's own colour, then each colour the part
 * fixes. A part drawn all in one colour, even a fixed one, takes the brick's
 * colour. Colours whose triangles all collapse are left out.
 */
function buildPartMesh(triangles: readonly (MeshTriangle & { readonly color: number })[], colours: ColourTable): LayeredMeshData {
  const codes = [...new Set(triangles.map((t) => t.color))].sort(byColour);
  if (codes.length <= 1) return buildMesh(triangles);
  const layers = codes
    .map((code) => ({
      mesh: buildMesh(triangles.filter((t) => t.color === code)),
      code,
      ...(code === MAIN_COLOUR ? { hex: '#ffffff', finish: 'solid' as const } : colourFor(colours, code)),
    }))
    .filter((layer) => layer.mesh.indices.length > 0);
  const only = layers.length === 1 ? layers[0] : undefined;
  if (only?.code === MAIN_COLOUR) return only.mesh;
  return joinColourMeshes(layers);
}

/**
 * Converts one LDraw part into an editor mesh standing on its grid footprint,
 * with the colours it fixes (from LDraw's colour table) in layers of its own.
 */
export function convertPart(file: string, flattener: Flattener, colours: ColourTable = new Map()): Conversion {
  const part = flattener.flatten(file);
  if (part.triangles.length === 0) return { ok: false, reason: 'empty' };

  const body = bodyBounds(part.triangles);
  if (!body) return { ok: false, reason: 'empty' };
  const fit = fitPart(body.min, body.max, part.topStuds.map(toEditor));
  const [ox, oy, oz] = fit.offset;
  const place = (p: V3): V3 => {
    const [x, y, z] = toEditor(p);
    return [x + ox, y + oy, z + oz];
  };
  const placed = part.triangles.map((t) => ({ a: place(t.a), b: place(t.b), c: place(t.c), doubleSided: t.doubleSided, color: t.color }));
  const mesh = buildPartMesh(placed, colours);
  if (mesh.positions.length / 3 > MAX_VERTICES) return { ok: false, reason: 'too detailed' };
  const sideStuds = part.sideStuds.flatMap((stud): SideStudEntry[] => {
    const [x, y, z] = place(stud.at);
    const [dx, dy, dz] = toEditor(stud.dir).map((v) => v * LDU);
    const facing = facingOfVector({ x: dx ?? 0, y: dy ?? 0, z: dz ?? 0 });
    return facing && facing !== '+y' ? [[x, y, z, FACINGS.indexOf(facing)]] : [];
  });
  const connectors = finishConnectors(part.connectors).map((connector): ConnectorEntry => {
    const [x, y, z] = place(connector.at);
    const [ax, ay, az] = toEditor(connector.axis);
    const size = Math.hypot(ax, ay, az);
    return [CONNECTOR_KINDS.indexOf(connector.kind), x, y, z, ax / size, ay / size, az / size, connector.length / LDU];
  });
  return { ok: true, mesh, fit, solids: filledCells(placed, fit), sideStuds, connectors, triangles: part.triangles.length };
}
