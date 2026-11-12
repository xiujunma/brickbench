import { LDU_PER_UNIT, cleanZero, rotatePoint } from '../grid';
import { brickOrigin } from '../model/geometry';
import { allBricks } from '../model/model';
import type { Model } from '../model/types';
import type { PartLookup } from '../parts/types';

export interface LDrawExport {
  readonly text: string;
  /** Bricks left out because their part has no LDraw equivalent. */
  readonly skipped: number;
}

const NEWLINE = '\r\n';

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
    const [rx, rz] = rotatePoint(ox, oz, brick.r);
    const world = { x: centre.x + rx, y: centre.y + oy, z: centre.z + rz };
    const angle = (brick.r * Math.PI) / 2;
    const c = Math.round(Math.cos(angle));
    const s = Math.round(Math.sin(angle));
    // our turn about +Y by θ is a turn by -θ in LDraw's flipped frame
    const matrix = [c, 0, -s, 0, 1, 0, s, 0, c];
    const position = [world.x, -world.y, -world.z].map((v) => v * LDU_PER_UNIT);
    lines.push(
      ['1', brick.colorId, ...position, ...matrix].map((v) => (typeof v === 'number' ? formatNumber(v) : v)).join(' ') +
        ` ${part.ldraw.file}`,
    );
  }

  return { text: lines.join(NEWLINE) + NEWLINE, skipped };
}
