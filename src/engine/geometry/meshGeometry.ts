import { BufferAttribute, BufferGeometry } from 'three';
import type { PartMesh } from '../../core/ldraw/format';

const KEPT_ATTRIBUTES = new Set(['position', 'normal']);

/**
 * Replaces a geometry's contents in place, so every mesh already drawing it
 * (say, a placeholder box) shows the new shape. Disposing first frees the
 * old GPU buffers; renderers upload the new ones on their next frame.
 */
function replaceContents(geometry: BufferGeometry, positions: BufferAttribute, normals: BufferAttribute, index: BufferAttribute | null): void {
  geometry.dispose();
  for (const name of Object.keys(geometry.attributes)) {
    if (!KEPT_ATTRIBUTES.has(name)) geometry.deleteAttribute(name);
  }
  geometry.setAttribute('position', positions);
  geometry.setAttribute('normal', normals);
  geometry.setIndex(index);
  geometry.clearGroups();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

/** Puts a library mesh into an existing geometry; the arrays are shared, not copied. */
export function fillGeometry(geometry: BufferGeometry, mesh: PartMesh): void {
  replaceContents(
    geometry,
    new BufferAttribute(mesh.positions, 3),
    new BufferAttribute(mesh.normals, 3),
    new BufferAttribute(mesh.indices, 1),
  );
}

export function geometryFromMesh(mesh: PartMesh): BufferGeometry {
  const geometry = new BufferGeometry();
  fillGeometry(geometry, mesh);
  return geometry;
}

/**
 * Normals averaged over every vertex sharing a position. Outlines push a
 * mesh out along its normals; with split normals a box's hull would tear
 * open along every hard edge, with averaged ones it stays closed.
 */
export function averagedNormals(geometry: BufferGeometry): Float32Array {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const sums = new Map<string, [number, number, number]>();
  const keys: string[] = [];
  for (let i = 0; i < position.count; i++) {
    const key = `${position.getX(i)},${position.getY(i)},${position.getZ(i)}`;
    keys.push(key);
    const sum = sums.get(key) ?? [0, 0, 0];
    sums.set(key, [sum[0] + normal.getX(i), sum[1] + normal.getY(i), sum[2] + normal.getZ(i)]);
  }
  const result = new Float32Array(position.count * 3);
  keys.forEach((key, i) => {
    const [x, y, z] = sums.get(key) ?? [0, 1, 0];
    const length = Math.hypot(x, y, z) || 1;
    result[i * 3] = x / length;
    result[i * 3 + 1] = y / length;
    result[i * 3 + 2] = z / length;
  });
  return result;
}

/** Fills `target` with `source`'s shape and averaged normals, for outlines. */
export function fillOutlineGeometry(target: BufferGeometry, source: BufferGeometry): void {
  const position = source.getAttribute('position');
  const index = source.getIndex();
  // fresh attribute objects over the same arrays: each geometry owns its GPU buffers
  replaceContents(
    target,
    new BufferAttribute(position.array, 3),
    new BufferAttribute(averagedNormals(source), 3),
    index ? new BufferAttribute(index.array, 1) : null,
  );
}

export function outlineGeometryFor(source: BufferGeometry): BufferGeometry {
  const geometry = new BufferGeometry();
  fillOutlineGeometry(geometry, source);
  return geometry;
}
