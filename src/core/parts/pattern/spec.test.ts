/**
 * Keeps docs/part-patterns.md honest: every example there reads, finds the
 * built-in parts the page says, is refused with the words the page gives,
 * or is the canonical pattern of the part beside it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import { codeSpans, markdownTables, type MarkdownTable } from '../../../testing/markdownTables';
import { getPart, PARTS } from '../catalog';
import { describeSubject, matchesPattern, parsePattern, subjectOf, TOO_COSTLY_MESSAGE } from '.';

const DOC = new URL('../../../../docs/part-patterns.md', import.meta.url).pathname;
const TABLES = markdownTables(DOC);
const SUBJECTS = PARTS.map(subjectOf);

function rowsUnder(heading: string): MarkdownTable['rows'] {
  const rows = TABLES.filter((table) => table.header[0] === heading).flatMap((table) => table.rows);
  if (rows.length === 0) throw new Error(`docs/part-patterns.md has no table headed “${heading}”`);
  return rows;
}

/** The first code span of a row's first cell: the pattern it shows. */
const patternOf = (row: readonly string[]): string => codeSpans(row[0])[0] ?? '';

function found(text: string): string[] {
  const parsed = parsePattern(text);
  if (!parsed.ok) throw new Error(`${text} does not read: ${parsed.error.message}`);
  return SUBJECTS.filter((subject) => matchesPattern(parsed.pattern, subject)).map((subject) => subject.partId);
}

/** Patterns the page gives in its prose, outside the tables. */
const PROSE = [
  'B1x(1|2) -side-studs',
  'S45[oo/..]',
  'P2x4^1',
  'S45i[oo]{2}^3',
  'S !Si',
  'S2x2',
  'S45 2x2',
  'B1x2^15',
  'P[oooo]{2}',
  'P[oo]{4}',
  '^{1,3}',
  '^(1|2)',
  'B^*',
  'P^2',
  ':dark-bluish-grey',
  'P2x4 :red',
  '=3040?',
  'P | T :red',
  'P | (T :red)',
  'S45[oo/..]^3=3039',
  'P1x2+clip',
  'B ^15',
  'B^15',
  'B1x1x5',
  '@library =3001',
  'Si',
  'C -clip',
  '[(#|_)*]{1,256}',
];

describe('docs/part-patterns.md', () => {
  it.each(rowsUnder('Pattern').map((row) => [patternOf(row), row[2] ?? ''] as const))('%s finds what the page says', (pattern, says) => {
    const parts = found(pattern);
    const count = /^(\d+) parts$/.exec(says)?.[1];
    if (count === undefined) expect(parts.toSorted()).toEqual(codeSpans(says).toSorted());
    else expect(parts).toHaveLength(Number(count));
  });

  it.each(rowsUnder('Write').map(patternOf))('%s reads', (pattern) => {
    expect(parsePattern(pattern).ok).toBe(true);
  });

  it.each(PROSE)('%s, from the prose, is on the page and reads', (pattern) => {
    expect(readFileSync(DOC, 'utf8')).toContain(`\`${pattern}\``);
    expect(parsePattern(pattern).ok).toBe(true);
  });

  it('quotes the message a search too costly to finish gives', () => {
    expect(readFileSync(DOC, 'utf8')).toContain(`> ${TOO_COSTLY_MESSAGE}.`);
  });

  it('means what it says of a kind’s height in a term of its own', () => {
    expect(found('B ^15')).toEqual([]);
    expect(found('B^15')).toEqual(found('B1x1x5').concat(found('B1x2x5')));
  });

  it.each(rowsUnder('Refused').map((row) => [patternOf(row), row[1] ?? ''] as const))('%s is refused as the page says', (pattern, says) => {
    const parsed = parsePattern(pattern);
    expect(parsed.ok ? 'it reads' : parsed.error.message).toBe(says);
  });

  it.each(rowsUnder('Part').map((row) => [codeSpans(row[0])[0] ?? '', codeSpans(row[1])[0] ?? ''] as const))(
    '%s has the canonical pattern %s',
    (partId, canonical) => {
      const part = getPart(partId);
      if (!part) throw new Error(`no built-in part ${partId}`);
      expect(describeSubject(subjectOf(part))).toBe(canonical);
      expect(found(canonical)).toEqual([partId]);
    },
  );
});
