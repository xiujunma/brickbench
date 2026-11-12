/** Minimal LDraw line parser: meta lines, sub-file references, triangles and quads. Edge lines are dropped. */
export type V3 = readonly [number, number, number];

export interface Transform {
  /** Row-major 3 × 3 matrix a..i of a type-1 line. */
  readonly m: readonly [number, number, number, number, number, number, number, number, number];
  readonly t: V3;
}

export type LDrawLine =
  | { readonly kind: 'meta'; readonly text: string }
  | { readonly kind: 'ref'; readonly color: number; readonly matrix: Transform; readonly file: string }
  | { readonly kind: 'tri'; readonly color: number; readonly points: readonly [V3, V3, V3] }
  | { readonly kind: 'quad'; readonly color: number; readonly points: readonly [V3, V3, V3, V3] };

function point(n: readonly number[], at: number): V3 {
  return [n[at] ?? 0, n[at + 1] ?? 0, n[at + 2] ?? 0];
}

function parseLine(raw: string): LDrawLine | null {
  const line = raw.trim();
  if (line.length === 0) return null;
  const type = line[0];
  if (type === '0') return { kind: 'meta', text: line.slice(1).trim() };
  const tokens = line.split(/\s+/);
  const color = Number(tokens[1]);
  if (type === '1') {
    const n = tokens.slice(2, 14).map(Number);
    if (n.length < 12 || n.some(Number.isNaN)) return null;
    const m = n.slice(3, 12) as unknown as Transform['m'];
    return { kind: 'ref', color, matrix: { m, t: point(n, 0) }, file: tokens.slice(14).join(' ') };
  }
  if (type === '3' || type === '4') {
    const count = type === '3' ? 3 : 4;
    const n = tokens.slice(2, 2 + count * 3).map(Number);
    if (n.length < count * 3 || n.some(Number.isNaN)) return null;
    return type === '3'
      ? { kind: 'tri', color, points: [point(n, 0), point(n, 3), point(n, 6)] }
      : { kind: 'quad', color, points: [point(n, 0), point(n, 3), point(n, 6), point(n, 9)] };
  }
  return null;
}

export function parseLDraw(text: string): LDrawLine[] {
  const lines: LDrawLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = parseLine(raw);
    if (line) lines.push(line);
  }
  return lines;
}
