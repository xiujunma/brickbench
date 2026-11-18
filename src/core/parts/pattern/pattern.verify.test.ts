/**
 * Part patterns against the whole shipped LDraw library: every part's
 * canonical pattern reads back and finds it, the library examples in
 * docs/part-patterns.md are what the library gives, and no pattern stalls
 * on the library's biggest parts.
 *
 * Runs where the converted library is on disk (`bun run ldraw`), as in CI.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import { codeSpans, markdownTables } from '../../../testing/markdownTables';
import { parseLDrawIndex, toPartDef } from '../../ldraw/catalogIndex';
import { describeSubject, matchesPattern, parsePattern, subjectOf, type Subject } from '.';

const INDEX = new URL('../../../../public/ldraw/index.json', import.meta.url).pathname;
const DOC = new URL('../../../../docs/part-patterns.md', import.meta.url).pathname;
const HAS_LIBRARY = existsSync(INDEX);

function pattern(text: string) {
  const parsed = parsePattern(text);
  if (!parsed.ok) throw new Error(`${text} does not read: ${parsed.error.message} at ${parsed.error.at}`);
  return parsed.pattern;
}

describe.skipIf(!HAS_LIBRARY)('part patterns over the LDraw library', () => {
  const subjects: readonly Subject[] = HAS_LIBRARY ? parseLDrawIndex(JSON.parse(readFileSync(INDEX, 'utf8'))).parts.map((entry) => subjectOf(toPartDef(entry))) : [];
  const byNumber = new Map(subjects.map((subject) => [subject.number, subject]));

  it('gives every part a canonical pattern that reads back and finds it', () => {
    const misfits = subjects.filter((subject) => !matchesPattern(pattern(describeSubject(subject)), subject));
    expect(misfits.map((subject) => subject.partId)).toEqual([]);
  });

  const rows = markdownTables(DOC).find((table) => table.header[0] === 'Library part')?.rows ?? [];
  it.each(rows.map((row) => [codeSpans(row[0])[0] ?? '', codeSpans(row[1])[0] ?? ''] as const))('gives %s the canonical pattern %s', (number, canonical) => {
    const subject = byNumber.get(number);
    if (!subject) throw new Error(`the library has no part ${number}`);
    expect(describeSubject(subject)).toBe(canonical);
  });

  it('matches even a pattern that can reach every cell, over every part', () => {
    const anything = pattern('[(#|o|.|_)*]{1,256}');
    expect(subjects.filter((subject) => matchesPattern(anything, subject))).toHaveLength(subjects.length);
  });
});
