/**
 * Reads geometry from an LDraw library on disk, for the opt-in LDraw checks.
 * Test support that reads files from disk; never bundled into the app.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type V3 = readonly [number, number, number];

export interface Transform {
  /** Row-major 3×3 matrix a..i, as in LDraw type-1 lines. */
  readonly m: readonly number[];
  readonly t: V3;
}

export interface Box {
  readonly min: V3;
  readonly max: V3;
}

export function apply(tr: Transform, [x, y, z]: V3): V3 {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0, i = 0] = tr.m;
  return [a * x + b * y + c * z + tr.t[0], d * x + e * y + f * z + tr.t[1], g * x + h * y + i * z + tr.t[2]];
}

function resolve(dir: string, name: string): string | null {
  const file = name.replace(/\\/g, '/').toLowerCase();
  for (const base of ['parts', 'p']) {
    const path = join(dir, base, file);
    if (existsSync(path)) return path;
  }
  return null;
}

/** Loads LDraw part files and flattens them (sub-files included) into vertex lists. */
export class LDrawLibrary {
  private readonly cache = new Map<string, V3[]>();

  constructor(private readonly dir: string) {}

  /** All line, triangle and quad vertices of a part in its own frame. */
  vertices(name: string): V3[] {
    const key = name.toLowerCase();
    const cached = this.cache.get(key);
    if (cached) return cached;
    const path = resolve(this.dir, name);
    if (!path) throw new Error(`LDraw file not found: ${name}`);

    const out: V3[] = [];
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const tokens = line.trim().split(/\s+/);
      const type = tokens[0];
      const nums = tokens.slice(2).map(Number);
      if (type === '1') {
        const tr: Transform = { t: [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0], m: nums.slice(3, 12) };
        for (const v of this.vertices(tokens.slice(14).join(' '))) out.push(apply(tr, v));
      } else if (type === '2' || type === '3' || type === '4') {
        for (let k = 0; k < Number(type); k++) out.push([nums[k * 3] ?? 0, nums[k * 3 + 1] ?? 0, nums[k * 3 + 2] ?? 0]);
      }
    }
    this.cache.set(key, out);
    return out;
  }
}

export function bounds(points: readonly V3[]): Box {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] ?? Infinity, p[k] ?? 0);
      max[k] = Math.max(max[k] ?? -Infinity, p[k] ?? 0);
    }
  }
  return { min: [min[0] ?? 0, min[1] ?? 0, min[2] ?? 0], max: [max[0] ?? 0, max[1] ?? 0, max[2] ?? 0] };
}
