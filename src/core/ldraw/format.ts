/**
 * File formats of the shipped LDraw library, shared by the build-time
 * converter (scripts/ldraw, run by Bun) and the app, so it imports nothing.
 *
 * index.json lists the parts (see LDrawIndex); parts/<id>.bin holds one
 * mesh per part, optionally gzip-compressed, in this binary layout:
 *
 * Layout (little-endian):
 *   0  u32  magic "BBM2"
 *   4  u32  vertex count
 *   8  u32  index count
 *   12 f32  position scale (world units per int16 step)
 *   16 u32  flags (bit 0: 32-bit indices)
 *   20 u32  layer count
 *   24      16 bytes per layer, the indices split into runs by colour, in order:
 *           u32 first index, u32 index count, u32 LDraw colour code (16: the
 *           brick's own), u8 × 3 that colour's RGB, u8 finish (see FINISHES)
 *           int16 positions × 3 per vertex
 *           int8 normals × 3 per vertex, padded to 4 bytes
 *           uint16 or uint32 indices
 *
 * "BBM1", the first format, has no layer table: it is drawn wholly in the
 * brick's colour.
 */
/**
 * A box of cells a part fills, [x0, y0, z0, x1, y1, z1]: studs along X and Z
 * and plates up Y, counted from the corner of its footprint, ends exclusive.
 */
export type SolidBox = readonly [x0: number, y0: number, z0: number, x1: number, y1: number, z1: number];

/** At most this many boxes describe one part's shape; a part that needs more keeps its whole box. */
export const MAX_SOLIDS = 2048;

/** One part in index.json. */
export interface LDrawIndexEntry {
  /** LDraw part number, e.g. "3001" or "3040b". */
  readonly id: string;
  readonly name: string;
  /** LDraw category, e.g. "Brick" or "Technic". */
  readonly category: string;
  readonly keywords?: readonly string[];
  readonly author?: string;
  /** Footprint in studs along X and Z, and height in plates. */
  readonly w: number;
  readonly d: number;
  readonly h: number;
  /** Where the LDraw origin sits in the part's local frame, in studs. */
  readonly origin: readonly [number, number, number];
  /** The body lands on whole studs and plates. */
  readonly snug: boolean;
  /**
   * The cells the part fills, when its shape leaves some of its box empty,
   * as under an arch or in the corner of an L-shaped plate. Absent, it fills
   * the whole box.
   */
  readonly solids?: readonly SolidBox[];
  /** A printed or stickered part. */
  readonly printed?: true;
  /** For a printed part, the plain part it decorates, when the library has it: "3068b" for "3068bp01". */
  readonly base?: string;
  /**
   * How far off the grid its top studs sit along X and Z, in studs: half a
   * stud along a jumper plate, whose stud stands between cells. Absent, its
   * studs stand on cells.
   */
  readonly studOffset?: readonly [number, number];
}

/**
 * The index format written now. Version 2 added solids, version 3 parts
 * drawn in several colours, version 4 the part numbers LDraw renamed,
 * version 5 printed and stickered parts, version 6 the studs of jumper
 * plates.
 */
export const LDRAW_INDEX_VERSION = 6;

/** Index formats the app reads: in a version 1 library every part fills its whole box. */
export const READABLE_INDEX_VERSIONS = [1, 2, 3, 4, 5, 6] as const;

export interface LDrawIndex {
  readonly version: (typeof READABLE_INDEX_VERSIONS)[number];
  readonly generated: string;
  readonly parts: readonly LDrawIndexEntry[];
  /**
   * Old part numbers and the kept part each now is, e.g. ["4073", "6141"]:
   * LDraw moved or merged them, but parts lists still use them. Optional, so
   * libraries built before it still load.
   */
  readonly aliases?: readonly (readonly [string, string])[];
}

/** Most renamed part numbers an index may list. */
export const MAX_ALIASES = 20_000;

/** LDraw's colour code for "the colour of whatever uses this": the brick's own colour. */
export const MAIN_COLOUR = 16;

/** How a colour is drawn; the same finishes as the app's palette. */
export type MeshFinish = 'solid' | 'transparent' | 'pearl' | 'chrome';

/** Finishes in the order their numbers are stored. */
const FINISHES: readonly MeshFinish[] = ['solid', 'transparent', 'pearl', 'chrome'];

/**
 * A run of a mesh's indices drawn in one colour: the brick's own (code 16),
 * or one fixed by the part, such as a wheel's black tyre.
 */
export interface MeshLayer {
  readonly start: number;
  readonly count: number;
  /** The LDraw colour code. */
  readonly code: number;
  /** That colour as #rrggbb, for colours the app's palette does not have. */
  readonly hex: string;
  readonly finish: MeshFinish;
}

export interface PartMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  /** The indices split into runs by colour, in order; without them, all of it is the brick's colour. */
  readonly layers?: readonly MeshLayer[];
}

/** A mesh's colour layers: one in the brick's colour when it has none of its own. */
export function meshLayers(mesh: PartMesh): readonly MeshLayer[] {
  return mesh.layers ?? [{ start: 0, count: mesh.indices.length, code: MAIN_COLOUR, hex: '#ffffff', finish: 'solid' }];
}

const MAGIC = 0x324d4242; // "BBM2"
const MAGIC_FIRST = 0x314d4242; // "BBM1", without layers
const HEADER_BYTES = 24;
const HEADER_BYTES_FIRST = 20;
const LAYER_BYTES = 16;
/** More colours than any LDraw part uses. */
const MAX_LAYERS = 256;
const WIDE_INDICES = 1;
/** Finest position step, in studs; parts larger than ±32 studs get a coarser one. */
const MIN_SCALE = 1 / 1000;

function align4(n: number): number {
  return Math.ceil(n / 4) * 4;
}

function writeLayers(view: DataView, layers: readonly MeshLayer[]): void {
  view.setUint32(20, layers.length, true);
  layers.forEach((layer, i) => {
    const at = HEADER_BYTES + i * LAYER_BYTES;
    const rgb = Number.parseInt(layer.hex.slice(1), 16);
    view.setUint32(at, layer.start, true);
    view.setUint32(at + 4, layer.count, true);
    view.setUint32(at + 8, layer.code, true);
    view.setUint8(at + 12, (rgb >> 16) & 0xff);
    view.setUint8(at + 13, (rgb >> 8) & 0xff);
    view.setUint8(at + 14, rgb & 0xff);
    view.setUint8(at + 15, Math.max(0, FINISHES.indexOf(layer.finish)));
  });
}

export function encodePartMesh(mesh: PartMesh): Uint8Array {
  const layers = meshLayers(mesh);
  const vertexCount = mesh.positions.length / 3;
  const indexCount = mesh.indices.length;
  const wide = vertexCount > 0xffff;
  let extent = 0;
  for (const value of mesh.positions) extent = Math.max(extent, Math.abs(value));
  const scale = Math.max(MIN_SCALE, extent / 32767);

  const headerBytes = HEADER_BYTES + layers.length * LAYER_BYTES;
  const positionBytes = vertexCount * 6;
  const normalBytes = align4(vertexCount * 3);
  const indexBytes = indexCount * (wide ? 4 : 2);
  const buffer = new ArrayBuffer(headerBytes + align4(positionBytes) + normalBytes + indexBytes);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, vertexCount, true);
  view.setUint32(8, indexCount, true);
  view.setFloat32(12, scale, true);
  view.setUint32(16, wide ? WIDE_INDICES : 0, true);
  writeLayers(view, layers);

  let offset = headerBytes;
  for (const value of mesh.positions) {
    view.setInt16(offset, Math.round(value / scale), true);
    offset += 2;
  }
  offset = headerBytes + align4(positionBytes);
  for (const value of mesh.normals) {
    view.setInt8(offset, Math.max(-127, Math.min(127, Math.round(value * 127))));
    offset += 1;
  }
  offset = headerBytes + align4(positionBytes) + normalBytes;
  for (const index of mesh.indices) {
    if (wide) view.setUint32(offset, index, true);
    else view.setUint16(offset, index, true);
    offset += wide ? 4 : 2;
  }
  return new Uint8Array(buffer);
}

/** Reads the layer table: whole triangles, in order, covering every index exactly once. */
function readLayers(view: DataView, count: number, indexCount: number): MeshLayer[] {
  const layers: MeshLayer[] = [];
  let next = 0;
  for (let i = 0; i < count; i++) {
    const at = HEADER_BYTES + i * LAYER_BYTES;
    const start = view.getUint32(at, true);
    const length = view.getUint32(at + 4, true);
    const finish = FINISHES[view.getUint8(at + 15)];
    if (start !== next || length % 3 !== 0 || !finish) throw new Error('The part mesh is damaged.');
    const hex = `#${[12, 13, 14].map((k) => view.getUint8(at + k).toString(16).padStart(2, '0')).join('')}`;
    layers.push({ start, count: length, code: view.getUint32(at + 8, true), hex, finish });
    next = start + length;
  }
  if (next !== indexCount) throw new Error('The part mesh is damaged.');
  return layers;
}

export function decodePartMesh(data: ArrayBuffer | Uint8Array): PartMesh {
  // copy views into a standalone buffer so offsets below are absolute
  const buffer = data instanceof Uint8Array ? new Uint8Array(data).buffer : data;
  if (buffer.byteLength < HEADER_BYTES_FIRST) throw new Error('This is not a BrickBench part mesh.');
  const view = new DataView(buffer);
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC && magic !== MAGIC_FIRST) throw new Error('This is not a BrickBench part mesh.');
  const vertexCount = view.getUint32(4, true);
  const indexCount = view.getUint32(8, true);
  const scale = view.getFloat32(12, true);
  if (!(scale > 0) || !Number.isFinite(scale) || indexCount % 3 !== 0) throw new Error('The part mesh is damaged.');
  const wide = (view.getUint32(16, true) & WIDE_INDICES) !== 0;
  const layerCount = magic === MAGIC ? (buffer.byteLength >= HEADER_BYTES ? view.getUint32(20, true) : 0) : 0;
  if (magic === MAGIC && (layerCount < 1 || layerCount > MAX_LAYERS)) throw new Error('The part mesh is damaged.');
  const headerBytes = magic === MAGIC ? HEADER_BYTES + layerCount * LAYER_BYTES : HEADER_BYTES_FIRST;
  const positionBytes = align4(vertexCount * 6);
  const normalBytes = align4(vertexCount * 3);
  const expected = headerBytes + positionBytes + normalBytes + indexCount * (wide ? 4 : 2);
  if (buffer.byteLength < expected) throw new Error('The part mesh is truncated.');
  const layers = magic === MAGIC ? readLayers(view, layerCount, indexCount) : undefined;

  const positions = new Float32Array(vertexCount * 3);
  const rawPositions = new Int16Array(buffer.slice(headerBytes, headerBytes + vertexCount * 6));
  for (let i = 0; i < positions.length; i++) positions[i] = (rawPositions[i] ?? 0) * scale;

  const normals = new Float32Array(vertexCount * 3);
  const rawNormals = new Int8Array(buffer, headerBytes + positionBytes, vertexCount * 3);
  // 8-bit normals come back a little off unit length; renderers and exporters expect exactly 1
  for (let i = 0; i < normals.length; i += 3) {
    const x = rawNormals[i] ?? 0;
    const y = rawNormals[i + 1] ?? 0;
    const z = rawNormals[i + 2] ?? 0;
    const length = Math.hypot(x, y, z) || 1;
    normals[i] = x / length;
    normals[i + 1] = y / length;
    normals[i + 2] = z / length;
  }

  const indexStart = headerBytes + positionBytes + normalBytes;
  const indices = wide
    ? new Uint32Array(buffer.slice(indexStart, indexStart + indexCount * 4))
    : new Uint16Array(buffer.slice(indexStart, indexStart + indexCount * 2));
  for (const index of indices) {
    if (index >= vertexCount) throw new Error('The part mesh is damaged.');
  }
  const mesh = { positions, normals, indices };
  return { ...mesh, layers: layers ?? meshLayers(mesh) };
}
