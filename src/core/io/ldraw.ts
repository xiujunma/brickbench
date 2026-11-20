import { LDU_PER_UNIT, cleanZero } from '../grid';
import { brickOrigin, brickTurn } from '../model/geometry';
import { rotateBy, turnOf, type Orientation, type Turn } from '../orientation';
import { allBricks } from '../model/model';
import type { Model } from '../model/types';
import type { PartLookup } from '../parts/types';

export interface LDrawExport {
  readonly text: string;
  /** Bricks left out because their part has no LDraw equivalent. */
  readonly skipped: number;
}

const NEWLINE = '\r\n';

/** LDraw's axes are ours with y and z flipped, so a turn reads as the same turn with those flips on either side. */
const FLIP = [1, -1, -1] as const;

/** A rotation (or an orientation's) as LDraw writes it: row by row, in LDraw's own axes. */
export function ldrawTurn(turn: Orientation | Turn): number[] {
  const m = typeof turn === 'number' ? turnOf(turn) : turn;
  return m.map((value, i) => cleanZero(value * (FLIP[Math.floor(i / 3)] ?? 1) * (FLIP[i % 3] ?? 1)));
}

/** The same in reverse: a rotation LDraw writes, in our axes. */
export function fromLDrawTurn(matrix: ArrayLike<number>): number[] {
  return Array.from({ length: 9 }, (_, i) => cleanZero((matrix[i] ?? 0) * (FLIP[Math.floor(i / 3)] ?? 1) * (FLIP[i % 3] ?? 1)));
}

function formatNumber(n: number): string {
  return String(cleanZero(Math.round(n * 1e4) / 1e4));
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'model';
}

/** Keeps user text on a single LDraw comment line. */
function sanitizeLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim() || 'Untitled model';
}

/**
 * Writes the model as an LDraw file (.ldr). LDraw uses -Y up and 20 LDU per
 * stud, which is our world turned half a turn about X: (x, y, z) → (x, -y, -z).
 */
export function toLDraw(name: string, model: Model, lookup: PartLookup): LDrawExport {
  const lines = [
    `0 ${sanitizeLine(name)}`,
    `0 Name: ${slugify(name)}.ldr`,
    '0 Author: BrickBench',
    '0 !LDRAW_ORG Unofficial_Model',
    '',
  ];
  let skipped = 0;

  for (const brick of allBricks(model)) {
    const part = lookup(brick.partId);
    if (!part?.ldraw) {
      skipped += 1;
      continue;
    }
    const centre = brickOrigin(brick, lookup);
    const [ox, oy, oz] = part.ldraw.origin;
    const turn = brickTurn(brick);
    const turned = rotateBy(turn, { x: ox, y: oy, z: oz });
    const world = { x: centre.x + turned.x, y: centre.y + turned.y, z: centre.z + turned.z };
    const matrix = ldrawTurn(turn);
    const position = [world.x, -world.y, -world.z].map((v) => v * LDU_PER_UNIT);
    lines.push(
      ['1', brick.colorId, ...position, ...matrix].map((v) => (typeof v === 'number' ? formatNumber(v) : v)).join(' ') +
        ` ${part.ldraw.file}`,
    );
  }

  return { text: lines.join(NEWLINE) + NEWLINE, skipped };
}
