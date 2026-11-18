/**
 * Part terms: kind, slope angle, footprint, top face and height, written
 * together as in P2x4, S45i, B1x(1|2), T[..]{2} or R[o]^1.
 */
import { DEFAULT_PLATES, isKind, type Dim, type Height, type Kind, type PartTerm } from './ast';
import type { Cursor } from './cursor';
import { PatternSyntaxError } from './errors';
import { MAX_REPEAT, parseTopFace, readRange, type Range, type TopFace } from './topFace';

/** The longest side a size may give: the widest library part. */
const MAX_SIZE = MAX_REPEAT;
/** The tallest height a pattern may give, in plates. */
const MAX_PLATES = 1023;
const MAX_ANGLE = 90;
const SIZE_SEPARATOR = /^[x×]/;
/** A choice of sizes starting a size, as in (1|2)x4: anything else in ( ) is a group. */
const SIZE_CHOICE = /^\(\d+(?:\|\d+)*\)[x×]/;

/** A kind letter alone, or before what follows it in a part term: not the start of a word. */
export const KIND_ALONE = /^(?:Si|[BPTSRCA])(?![A-Za-z-])/;

/** Whether a part term starts here: a kind, *, a size, a top face or a height. */
export function startsPartTerm(cursor: Cursor): boolean {
  const c = cursor.peek();
  if (c === undefined) return false;
  // a kind letter followed by a letter or a hyphen is a word ("Brick", "BAR", "C-clip"), but Si is an inverted slope
  if (isKind(c)) return KIND_ALONE.test(cursor.rest());
  if (c === '(') return SIZE_CHOICE.test(cursor.rest());
  return /[*\d{[^]/.test(c);
}

function single(value: number, at: number, limit: number): Dim {
  if (value < 1) throw new PatternSyntaxError('Sizes and heights start at 1', at);
  if (value > limit) throw new PatternSyntaxError(`Sizes go up to ${MAX_SIZE} studs and heights to ${MAX_PLATES} plates`, at);
  return { type: 'set', values: [value] };
}

/** A number, *, {m,n} or a choice (a|b|c), each value at most `limit`. */
function readDim(cursor: Cursor, limit: number): Dim {
  const at = cursor.i;
  const digits = cursor.read(/^\d+/);
  if (digits !== null) return single(Number(digits), at, limit);
  if (cursor.read(/^\*/) !== null) return { type: 'any' };
  if (cursor.peek() === '{') {
    const counted = cursor.read(/^\{[^}]*\}/) ?? cursor.fail('A “{” needs its “}”');
    const range: Range = readRange(counted.slice(1, -1), at, limit);
    return { type: 'range', ...range };
  }
  if (cursor.peek() === '(') {
    const choice = cursor.read(/^\(\d+(?:\|\d+)*\)/) ?? cursor.fail('A choice of sizes is written with numbers, as in (1|2|4)');
    const values = choice.slice(1, -1).split('|').map(Number);
    values.forEach((value) => single(value, at, limit));
    return { type: 'set', values: [...new Set(values)] };
  }
  return cursor.fail('A size is a number, *, {min,max} or a choice such as (1|2)');
}

function readKind(cursor: Cursor): Kind | null {
  const c = cursor.peek();
  if (c !== undefined && isKind(c)) {
    cursor.i += 1;
    return c;
  }
  // "*" is any kind, unless a size starts with it (*x4)
  if (c === '*' && !SIZE_SEPARATOR.test(cursor.text.slice(cursor.i + 1))) cursor.i += 1;
  return null;
}

/** A slope's angle, unless the digits start a size (S2x2), and i for inverted. */
function readSlope(cursor: Cursor): { readonly angle: number | null; readonly inverted: boolean } {
  const at = cursor.i;
  const digits = /^\d+/.exec(cursor.rest())?.[0];
  let angle: number | null = null;
  if (digits !== undefined && !SIZE_SEPARATOR.test(cursor.text.slice(at + digits.length))) {
    angle = Number(digits);
    if (angle < 1 || angle > MAX_ANGLE) cursor.fail(`A slope’s angle is from 1 to ${MAX_ANGLE} degrees`, at);
    cursor.i += digits.length;
  }
  const inverted = cursor.read(/^i/) !== null;
  return { angle, inverted };
}

interface Size {
  readonly a: Dim;
  readonly b: Dim;
  /** A third size, in bricks. */
  readonly third: Dim | null;
}

function readSize(cursor: Cursor): Size {
  const a = readDim(cursor, MAX_SIZE);
  if (cursor.read(SIZE_SEPARATOR) === null) cursor.fail('A size has two sides, as in 2x4 (a part number goes after =, as in =3001)');
  const b = readDim(cursor, MAX_SIZE);
  const third = cursor.read(SIZE_SEPARATOR) === null ? null : readDim(cursor, Math.floor(MAX_PLATES / 3));
  return { a, b, third };
}

/** Where the "[" at `open` closes, past any cell classes [o.] inside it. */
function closingBracket(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '[') {
      depth += 1;
      if (depth > 2) throw new PatternSyntaxError('Cell classes such as [o.] do not nest', i);
    } else if (text[i] === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new PatternSyntaxError('A “[” needs its “]”', open);
}

function readFace(cursor: Cursor): TopFace {
  const open = cursor.i;
  const close = closingBracket(cursor.text, open);
  const body = cursor.text.slice(open + 1, close);
  cursor.i = close + 1;
  let repeat: Range = { min: 1, max: 1 };
  if (cursor.peek() === '{') {
    const at = cursor.i;
    const counted = cursor.read(/^\{[^}]*\}/) ?? cursor.fail('A “{” needs its “}”');
    repeat = readRange(counted.slice(1, -1), at);
  }
  return parseTopFace(body, repeat, open + 1);
}

function readHeight(cursor: Cursor): Dim {
  cursor.i += 1;
  if (!/[\d*{(]/.test(cursor.peek() ?? '')) cursor.fail('A height is ^ and plates: ^3, ^{1,3}, ^(1|2), or ^* for any');
  return readDim(cursor, MAX_PLATES);
}

function heightOf(kind: Kind | null, third: Dim | null, plates: Dim | null): Height | null {
  if (third !== null) return third.type === 'any' ? null : { dim: third, unit: 3 };
  if (plates !== null) return plates.type === 'any' ? null : { dim: plates, unit: 1 };
  const fallback = kind === null ? undefined : DEFAULT_PLATES[kind];
  return fallback === undefined ? null : { dim: { type: 'set', values: [fallback] }, unit: 1 };
}

/** Reads a part term; the cursor is where startsPartTerm said one starts. */
export function readPartTerm(cursor: Cursor): PartTerm {
  const kind = readKind(cursor);
  const { angle, inverted } = kind === 'S' ? readSlope(cursor) : { angle: null, inverted: false };
  const size = /[\d*{]/.test(cursor.peek() ?? '') || SIZE_CHOICE.test(cursor.rest()) ? readSize(cursor) : null;
  const face = cursor.peek() === '[' ? readFace(cursor) : null;
  const heightAt = cursor.i;
  const plates = cursor.peek() === '^' ? readHeight(cursor) : null;
  if (size !== null && size.third !== null && plates !== null) {
    cursor.fail('Give the height once: a third size in bricks (B1x2x5) or ^ and plates (B1x2^15)', heightAt);
  }
  return {
    kind,
    angle,
    inverted,
    footprint: size && { a: size.a, b: size.b },
    face,
    height: heightOf(kind, size?.third ?? null, plates),
  };
}
