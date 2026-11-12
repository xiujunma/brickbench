import type { MeshBuilder, V3 } from './meshBuilder';
import type { PathPoint } from './path';

/**
 * Spins a profile (u = radius, v = height) around the Y axis. The profile
 * normals are used as-is, so sharp creases and smooth curves both survive.
 */
export function revolve(builder: MeshBuilder, profile: readonly PathPoint[], segments: number, offset: V3 = [0, 0, 0]): void {
  const starts: number[] = [];
  for (const p of profile) {
    starts.push(builder.vertexCount);
    for (let s = 0; s <= segments; s++) {
      const angle = (s / segments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      builder.vertex(
        [offset[0] + p.u * cos, offset[1] + p.v, offset[2] + p.u * sin],
        [p.nu * cos, p.nv, p.nu * sin],
      );
    }
  }
  for (let i = 0; i < profile.length - 1; i++) {
    const a = starts[i]!;
    const b = starts[i + 1]!;
    for (let s = 0; s < segments; s++) builder.quad(a + s, a + s + 1, b + s + 1, b + s);
  }
}
