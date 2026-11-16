/**
 * File formats of the shipped LDraw library, shared by the build-time
 * converter (scripts/ldraw, run by Bun) and the app, so it imports nothing.
 *
 * index.json lists the parts (see LDrawIndex); parts/<id>.bin holds one
 * mesh per part, optionally gzip-compressed, in this binary layout:
 *
 * Layout (little-endian):
 *   0  u32  magic "BBM1"
 *   4  u32  vertex count
 *   8  u32  index count
 *   12 f32  position scale (world units per int16 step)
 *   16 u32  flags (bit 0: 32-bit indices)
 *   20      int16 positions × 3 per vertex
 *           int8 normals × 3 per vertex, padded to 4 bytes
 *           uint16 or uint32 indices
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
}

/** The index format written now. Version 2 added solids. */
export const LDRAW_INDEX_VERSION = 2;

/** Index formats the app reads: in a version 1 library every part fills its whole box. */
export const READABLE_INDEX_VERSIONS = [1, 2] as const;

export interface LDrawIndex {
  readonly version: (typeof READABLE_INDEX_VERSIONS)[number];
  readonly generated: string;
  readonly parts: readonly LDrawIndexEntry[];
}

export interface PartMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
}

const MAGIC = 0x314d4242; // "BBM1"
const HEADER_BYTES = 20;
const WIDE_INDICES = 1;
/** Finest position step, in studs; parts larger than ±32 studs get a coarser one. */
const MIN_SCALE = 1 / 1000;

function align4(n: number): number {
  return Math.ceil(n / 4) * 4;
}

export function encodePartMesh(mesh: PartMesh): Uint8Array {
  const vertexCount = mesh.positions.length / 3;
  const indexCount = mesh.indices.length;
  const wide = vertexCount > 0xffff;
  let extent = 0;
  for (const value of mesh.positions) extent = Math.max(extent, Math.abs(value));
  const scale = Math.max(MIN_SCALE, extent / 32767);

  const positionBytes = vertexCount * 6;
  const normalBytes = align4(vertexCount * 3);
  const indexBytes = indexCount * (wide ? 4 : 2);
  const buffer = new ArrayBuffer(HEADER_BYTES + align4(positionBytes) + normalBytes + indexBytes);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, vertexCount, true);
  view.setUint32(8, indexCount, true);
  view.setFloat32(12, scale, true);
  view.setUint32(16, wide ? WIDE_INDICES : 0, true);

  let offset = HEADER_BYTES;
  for (const value of mesh.positions) {
    view.setInt16(offset, Math.round(value / scale), true);
    offset += 2;
  }
  offset = HEADER_BYTES + align4(positionBytes);
  for (const value of mesh.normals) {
    view.setInt8(offset, Math.max(-127, Math.min(127, Math.round(value * 127))));
    offset += 1;
  }
  offset = HEADER_BYTES + align4(positionBytes) + normalBytes;
  for (const index of mesh.indices) {
    if (wide) view.setUint32(offset, index, true);
    else view.setUint16(offset, index, true);
    offset += wide ? 4 : 2;
  }
  return new Uint8Array(buffer);
}

export function decodePartMesh(data: ArrayBuffer | Uint8Array): PartMesh {
  // copy views into a standalone buffer so offsets below are absolute
  const buffer = data instanceof Uint8Array ? new Uint8Array(data).buffer : data;
  if (buffer.byteLength < HEADER_BYTES) throw new Error('This is not a BrickBench part mesh.');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('This is not a BrickBench part mesh.');
  const vertexCount = view.getUint32(4, true);
  const indexCount = view.getUint32(8, true);
  const scale = view.getFloat32(12, true);
  if (!(scale > 0) || !Number.isFinite(scale) || indexCount % 3 !== 0) throw new Error('The part mesh is damaged.');
  const wide = (view.getUint32(16, true) & WIDE_INDICES) !== 0;
  const positionBytes = align4(vertexCount * 6);
  const normalBytes = align4(vertexCount * 3);
  const expected = HEADER_BYTES + positionBytes + normalBytes + indexCount * (wide ? 4 : 2);
  if (buffer.byteLength < expected) throw new Error('The part mesh is truncated.');

  const positions = new Float32Array(vertexCount * 3);
  const rawPositions = new Int16Array(buffer.slice(HEADER_BYTES, HEADER_BYTES + vertexCount * 6));
  for (let i = 0; i < positions.length; i++) positions[i] = (rawPositions[i] ?? 0) * scale;

  const normals = new Float32Array(vertexCount * 3);
  const rawNormals = new Int8Array(buffer, HEADER_BYTES + positionBytes, vertexCount * 3);
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

  const indexStart = HEADER_BYTES + positionBytes + normalBytes;
  const indices = wide
    ? new Uint32Array(buffer.slice(indexStart, indexStart + indexCount * 4))
    : new Uint16Array(buffer.slice(indexStart, indexStart + indexCount * 2));
  for (const index of indices) {
    if (index >= vertexCount) throw new Error('The part mesh is damaged.');
  }
  return { positions, normals, indices };
}
