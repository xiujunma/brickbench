/**
 * The canonical pattern of a part: its kind, its top face as it sits
 * unturned, its height unless the kind implies it, and its number, as in
 * P[oooo]{2}=3020 or S45[oo/..]^3=3039. Read back, it matches the part.
 * A top face too long to read, as on big irregular baseplates, gives way
 * to the part's size: *44x44^3=3229bc04.
 */
import { DEFAULT_PLATES } from './ast';
import type { Subject } from './subject';

/** Runs of a cell this long or longer are counted: o{6} rather than oooooo. */
const COUNTED_RUN = 5;
/** Longest top face written out; past it, the size says enough. */
const MAX_FACE_LENGTH = 120;

function describeRow(row: string): string {
  return row.replace(/(.)\1*/g, (run, cell: string) => (run.length >= COUNTED_RUN ? `${cell}{${run.length}}` : run));
}

/** A grid as a top face: rows that are all alike are written once and counted. */
export function describeGrid(grid: string): string {
  const rows = grid.split('/');
  const first = rows[0] ?? '';
  if (rows.length > 1 && rows.every((row) => row === first)) return `[${describeRow(first)}]{${rows.length}}`;
  return `[${rows.map(describeRow).join('/')}]`;
}

function describeKind(subject: Subject): string {
  if (subject.kind === null) return '*';
  if (subject.kind !== 'S') return subject.kind;
  return `S${subject.angle ?? ''}${subject.inverted ? 'i' : ''}`;
}

export interface DescribeOptions {
  /** End with the part number, which makes the pattern name just this part. Default true. */
  readonly number?: boolean;
}

export function describeSubject(subject: Subject, options: DescribeOptions = {}): string {
  const implied = subject.kind === null ? undefined : DEFAULT_PLATES[subject.kind];
  const height = implied === subject.plates ? '' : `^${subject.plates}`;
  const number = (options.number ?? true) && subject.number !== '' ? `=${subject.number}` : '';
  const kind = describeKind(subject);
  const face = describeGrid(subject.grid);
  if (face.length <= MAX_FACE_LENGTH) return `${kind}${face}${height}${number}`;
  // digits straight after a slope's angle would read as part of it
  const gap = subject.angle !== null && !subject.inverted ? ' ' : '';
  return `${kind}${gap}${subject.sizes[0]}x${subject.sizes[1]}${height}${number}`;
}
