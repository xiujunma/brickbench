/**
 * Converts the LDraw file behind every built-in part with the library
 * converter and checks it lands exactly as the built-in part does: same
 * footprint, height and origin. Library parts and built-in parts then line
 * up and export identically. Also catches built-in parts that point at
 * LDraw files which have since moved.
 *
 * Opt-in because it needs the library on disk:
 *   LDRAW_DIR=/path/to/ldraw bun test src/core/parts/libraryFit.verify.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { convertPart } from '../../../scripts/ldraw/convert.ts';
import { Flattener } from '../../../scripts/ldraw/flatten.ts';
import { directorySource } from '../../../scripts/ldraw/library.ts';
import { PARTS } from './catalog';

const LDRAW_DIR = process.env['LDRAW_DIR'];
const WITH_LDRAW = PARTS.filter((p) => p.ldraw).map((p) => [p.id, p] as const);

describe.skipIf(!LDRAW_DIR)('library conversion of the built-in parts', () => {
  const flattener = new Flattener(directorySource(LDRAW_DIR ?? ''));

  it.each(WITH_LDRAW)('%s converts to the same footprint and origin', (_id, part) => {
    const file = part.ldraw?.file ?? '';
    const result = convertPart(file, flattener);
    if (!result.ok) throw new Error(`${file} was skipped: ${result.reason}`);
    expect([result.fit.w, result.fit.d, result.fit.h], file).toEqual([part.w, part.d, part.h]);
    result.fit.offset.forEach((value, k) => expect(value, `${file} origin[${k}]`).toBeCloseTo(part.ldraw?.origin[k] ?? 0, 3));
  });

  it.each(WITH_LDRAW)('%s points at a current LDraw file', (_id, part) => {
    const first = readFileSync(join(LDRAW_DIR ?? '', 'parts', part.ldraw?.file ?? ''), 'utf8').split(/\r?\n/, 1)[0] ?? '';
    expect(first).not.toMatch(/^0 ~Moved/);
  });
});
