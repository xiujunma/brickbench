import { BufferAttribute, BufferGeometry } from 'three';
import { describe, expect, it, vi } from 'bun:test';
import type { PartMesh } from '../../core/ldraw/format';
import { averagedNormals, fillGeometry, geometryFromMesh, outlineGeometryFor } from './meshGeometry';

const TRIANGLE: PartMesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint16Array([0, 1, 2]),
};

describe('library mesh geometry', () => {
  it('wraps a mesh without copying its arrays', () => {
    const geometry = geometryFromMesh(TRIANGLE);
    expect(geometry.getAttribute('position').array).toBe(TRIANGLE.positions);
    expect(geometry.getIndex()?.array).toBe(TRIANGLE.indices);
    expect(geometry.boundingSphere?.radius).toBeGreaterThan(0);
  });

  it('replaces a placeholder in place, dropping what the mesh does not have', () => {
    const placeholder = new BufferGeometry();
    placeholder.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    placeholder.setAttribute('uv', new BufferAttribute(new Float32Array(8), 2));
    placeholder.addGroup(0, 6, 1);
    const disposed = vi.fn();
    placeholder.addEventListener('dispose', disposed);

    fillGeometry(placeholder, TRIANGLE);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(Object.keys(placeholder.attributes).sort()).toEqual(['normal', 'position']);
    expect(placeholder.getAttribute('position').count).toBe(3);
    expect(placeholder.groups).toEqual([]);
  });

  it('averages normals over vertices that share a spot', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0, 1, 0, 0]), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), 3));
    const normals = averagedNormals(geometry);
    expect(normals[0]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(normals[1]).toBeCloseTo(Math.SQRT1_2, 5);
    expect([...normals.slice(6)]).toEqual([0, 0, 1]);
  });

  it('builds outlines for meshes with and without an index', () => {
    const indexed = outlineGeometryFor(geometryFromMesh(TRIANGLE));
    expect(indexed.getIndex()?.count).toBe(3);
    const loose = new BufferGeometry();
    loose.setAttribute('position', new BufferAttribute(TRIANGLE.positions, 3));
    loose.setAttribute('normal', new BufferAttribute(TRIANGLE.normals, 3));
    const outline = outlineGeometryFor(loose);
    expect(outline.getIndex()).toBeNull();
    expect(outline.getAttribute('position')).not.toBe(loose.getAttribute('position'));
    expect(outline.getAttribute('position').array).toBe(loose.getAttribute('position').array);
  });
});
