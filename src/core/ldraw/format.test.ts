import { describe, expect, it } from 'bun:test';
import { decodePartMesh, encodePartMesh, type PartMesh } from './format';

function mesh(vertexCount: number, extent = 2): PartMesh {
  const positions = new Float32Array(vertexCount * 3).map((_, i) => ((i * 37) % 101) / 101 * 2 * extent - extent);
  const normals = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v++) normals.set([0, 1, 0], v * 3);
  const indices = new Uint32Array(Math.floor(vertexCount / 3) * 3).map((_, i) => i);
  return { positions, normals, indices };
}

describe('part mesh format', () => {
  it('round-trips positions closely, normals roughly and indices exactly', () => {
    const original = mesh(300);
    const decoded = decodePartMesh(encodePartMesh(original));
    expect(decoded.indices).toEqual(Uint16Array.from(original.indices));
    for (let i = 0; i < original.positions.length; i++) {
      expect(Math.abs((decoded.positions[i] ?? 0) - (original.positions[i] ?? 0))).toBeLessThan(1e-3);
    }
    expect(decoded.normals[1]).toBeCloseTo(1, 2);
  });

  it('returns unit-length normals despite 8-bit storage', () => {
    const tilted: PartMesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0.3, 0.5, 0.8124, 0.6, 0.64, 0.48, 0.0, 0.70710678, 0.70710678]),
      indices: new Uint16Array([0, 1, 2]),
    };
    const { normals } = decodePartMesh(encodePartMesh(tilted));
    for (let i = 0; i < normals.length; i += 3) {
      expect(Math.hypot(normals[i] ?? 0, normals[i + 1] ?? 0, normals[i + 2] ?? 0)).toBeCloseTo(1, 6);
    }
    expect(normals[0]).toBeCloseTo(0.3, 2);
  });

  it('switches to 32-bit indices for large meshes and keeps big parts in range', () => {
    const big = mesh(70_000, 30);
    const decoded = decodePartMesh(encodePartMesh(big));
    expect(decoded.indices).toBeInstanceOf(Uint32Array);
    expect(decoded.indices[decoded.indices.length - 1]).toBe(big.indices[big.indices.length - 1]);
    const worst = big.positions.reduce((max, value, i) => Math.max(max, Math.abs(value - (decoded.positions[i] ?? 0))), 0);
    expect(worst).toBeLessThan(2e-3);
  });

  it('rejects data that is not a part mesh', () => {
    expect(() => decodePartMesh(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).toThrow(/not a BrickBench part mesh/);
    const truncated = encodePartMesh(mesh(30)).slice(0, 40);
    expect(() => decodePartMesh(truncated.buffer)).toThrow(/truncated/);
  });

  it('keeps colour layers: a run of triangles per colour, and the colour to draw it in', () => {
    const layers = [
      { start: 0, count: 3, code: 16, hex: '#ffffff', finish: 'solid' },
      { start: 3, count: 6, code: 256, hex: '#1b2a34', finish: 'solid' },
      { start: 9, count: 3, code: 47, hex: '#fcfcfc', finish: 'transparent' },
    ] as const;
    const decoded = decodePartMesh(encodePartMesh({ ...mesh(12), layers }));
    expect(decoded.layers).toEqual(layers);
  });

  it('reads a mesh without layers as one layer in the colour of the brick', () => {
    expect(decodePartMesh(encodePartMesh(mesh(12))).layers).toEqual([{ start: 0, count: 12, code: 16, hex: '#ffffff', finish: 'solid' }]);
  });

  it('still reads meshes from before parts had colour layers', () => {
    // the first format: the same without the layer table, under the magic "BBM1"
    const current = encodePartMesh(mesh(12));
    const first = new Uint8Array(current.length - 20);
    first.set(current.subarray(0, 20));
    first.set(current.subarray(40), 20);
    new DataView(first.buffer).setUint32(0, 0x314d4242, true);
    const decoded = decodePartMesh(first);
    expect(decoded.indices).toEqual(Uint16Array.from(mesh(12).indices));
    expect(decoded.layers).toEqual([{ start: 0, count: 12, code: 16, hex: '#ffffff', finish: 'solid' }]);
  });

  it('rejects layers that leave triangles out or overlap', () => {
    const bytes = encodePartMesh({ ...mesh(12), layers: [{ start: 0, count: 6, code: 16, hex: '#ffffff', finish: 'solid' }, { start: 6, count: 6, code: 0, hex: '#000000', finish: 'solid' }] });
    const view = new DataView(bytes.buffer);
    // the second layer's index count
    view.setUint32(24 + 16 + 4, 3, true);
    expect(() => decodePartMesh(bytes)).toThrow(/damaged/);
  });

  it('rejects meshes whose triangles point past their vertices', () => {
    const bytes = encodePartMesh(mesh(30));
    const view = new DataView(bytes.buffer);
    view.setUint16(bytes.length - 2, 999, true);
    expect(() => decodePartMesh(bytes)).toThrow(/damaged/);
  });
});
