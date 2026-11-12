import { BufferGeometry, Float32BufferAttribute } from 'three';

export type V3 = readonly [number, number, number];

const DEGENERATE_AREA = 1e-14;

/**
 * Accumulates an indexed triangle mesh with explicit normals. Triangles are
 * turned to face the same way as their vertex normals, so generators only
 * have to get the normals right; zero-area triangles are dropped.
 */
export class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  vertex(p: V3, n: V3): number {
    this.positions.push(p[0], p[1], p[2]);
    const length = Math.hypot(n[0], n[1], n[2]) || 1;
    this.normals.push(n[0] / length, n[1] / length, n[2] / length);
    return this.vertexCount - 1;
  }

  triangle(a: number, b: number, c: number): void {
    const p = this.positions;
    const ax = p[a * 3]!, ay = p[a * 3 + 1]!, az = p[a * 3 + 2]!;
    const e1x = p[b * 3]! - ax, e1y = p[b * 3 + 1]! - ay, e1z = p[b * 3 + 2]! - az;
    const e2x = p[c * 3]! - ax, e2y = p[c * 3 + 1]! - ay, e2z = p[c * 3 + 2]! - az;
    const fx = e1y * e2z - e1z * e2y;
    const fy = e1z * e2x - e1x * e2z;
    const fz = e1x * e2y - e1y * e2x;
    if (fx * fx + fy * fy + fz * fz < DEGENERATE_AREA) return;

    const n = this.normals;
    const sx = n[a * 3]! + n[b * 3]! + n[c * 3]!;
    const sy = n[a * 3 + 1]! + n[b * 3 + 1]! + n[c * 3 + 1]!;
    const sz = n[a * 3 + 2]! + n[b * 3 + 2]! + n[c * 3 + 2]!;
    if (fx * sx + fy * sy + fz * sz < 0) this.indices.push(a, c, b);
    else this.indices.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.triangle(a, b, c);
    this.triangle(a, c, d);
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(this.normals, 3));
    geometry.setIndex(this.indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}
