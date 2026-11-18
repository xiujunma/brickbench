/**
 * A part's top face, as part patterns describe it: rows of cells from back
 * to front, each row a regular expression over its cells. A part's own top
 * face is a grid, written row by row and joined by "/", in these symbols:
 *
 *   o  a cell with a stud on top          _  no cell: the part leaves it out
 *   .  a cell with no stud: smooth or     #  a cell, top unknown (library
 *      sloped                                 parts, whose studs the library
 *                                             does not record)
 *
 * Patterns are matched without backtracking, by following the set of
 * positions they can reach. Counts never nest (a counted group holds no
 * counts), so matching takes at most about the pattern's size times the
 * grid's, whoever wrote the pattern.
 */
import { PatternSyntaxError } from './errors';

/** Grid symbols each pattern cell accepts: a cell of unknown top is either. */
const ACCEPTS: Readonly<Record<string, string>> = { o: 'o#', '.': '.#', '#': 'o.#', _: '_' };
/** Most times anything may be counted: as many studs as the widest library part has. */
export const MAX_REPEAT = 256;
const ROW_BREAK = '/';

export interface Range {
  readonly min: number;
  /** Infinity for no upper bound. */
  readonly max: number;
}

/** A pattern over a grid's cells, ready to match. */
export type CellPattern =
  | { readonly type: 'cell'; readonly accepts: string }
  | { readonly type: 'rowBreak' }
  | { readonly type: 'seq'; readonly items: readonly CellPattern[] }
  | { readonly type: 'alt'; readonly options: readonly CellPattern[] }
  | { readonly type: 'repeat'; readonly item: CellPattern; readonly min: number; readonly max: number };

/** A top-face pattern and how many rows the grids it matches can have. */
export interface TopFace {
  readonly cells: CellPattern;
  readonly rows: Range;
}

/** "3", "2,5" or "2," as a range of counts, up to `limit`. */
export function readRange(text: string, at: number, limit = MAX_REPEAT): Range {
  const match = /^(\d+)(?:(,)(\d*))?$/.exec(text);
  if (!match?.[1]) throw new PatternSyntaxError('A count is written {n}, {min,max} or {min,}', at);
  const min = Number(match[1]);
  const max = match[2] ? (match[3] ? Number(match[3]) : Infinity) : min;
  if (min > limit || (max !== Infinity && max > limit)) throw new PatternSyntaxError(`Counts go up to ${limit}`, at);
  if (max < min) throw new PatternSyntaxError('A count’s maximum cannot be below its minimum', at);
  return { min, max };
}

const isCount = (c: string | undefined): boolean => c === '*' || c === '+' || c === '?' || c === '{';

function holdsCount(pattern: CellPattern): boolean {
  switch (pattern.type) {
    case 'repeat':
      return true;
    case 'seq':
      return pattern.items.some(holdsCount);
    case 'alt':
      return pattern.options.some(holdsCount);
    default:
      return false;
  }
}

class RowReader {
  private i = 0;

  constructor(
    private readonly text: string,
    private readonly offset: number,
  ) {}

  private fail(message: string, at = this.i): never {
    throw new PatternSyntaxError(message, this.offset + at);
  }

  /** Rows split by "/" at the top level. */
  rows(): CellPattern[] {
    const rows = [this.alternatives(false)];
    while (this.text[this.i] === ROW_BREAK) {
      this.i += 1;
      rows.push(this.alternatives(false));
    }
    if (this.i < this.text.length) this.fail('This “)” has no “(” to close');
    return rows;
  }

  private alternatives(inGroup: boolean): CellPattern {
    const options = [this.sequence(inGroup)];
    while (this.text[this.i] === '|') {
      this.i += 1;
      options.push(this.sequence(inGroup));
    }
    return options.length === 1 ? (options[0] as CellPattern) : { type: 'alt', options };
  }

  private sequence(inGroup: boolean): CellPattern {
    const items: CellPattern[] = [];
    const start = this.i;
    for (let c = this.text[this.i]; c !== undefined && c !== '|' && c !== ')' && c !== ROW_BREAK; c = this.text[this.i]) {
      items.push(this.quantified(this.atom()));
    }
    if (inGroup && this.text[this.i] === ROW_BREAK) this.fail('A row ends only outside ( ): close the group before the “/”');
    if (items.length === 0) this.fail('Each row, and each choice in it, needs at least one cell', start);
    return items.length === 1 ? (items[0] as CellPattern) : { type: 'seq', items };
  }

  private atom(): CellPattern {
    const c = this.text[this.i] as string;
    const accepts = ACCEPTS[c];
    if (accepts !== undefined) {
      this.i += 1;
      return { type: 'cell', accepts };
    }
    if (c === '[') return this.cellClass();
    if (c === '(') {
      this.i += 1;
      const group = this.alternatives(true);
      if (this.text[this.i] !== ')') this.fail('A “(” in a top face needs its “)”');
      this.i += 1;
      return group;
    }
    if ('*+?{'.includes(c)) this.fail('Nothing before this to count');
    return this.fail(`A top face is made of o . _ and #, with ( ) | * + ? {m,n} and [ ]: “${c}” is not one of them`);
  }

  private cellClass(): CellPattern {
    const end = this.text.indexOf(']', this.i);
    if (end < 0) this.fail('A “[” in a top face needs its “]”');
    const members = this.text.slice(this.i + 1, end);
    if (members === '') this.fail('An empty [ ] matches no cell');
    let accepts = '';
    for (const [n, member] of [...members].entries()) {
      const symbols = ACCEPTS[member];
      if (symbols === undefined) this.fail(`Only o . _ and # go between [ ]: “${member}” does not`, this.i + 1 + n);
      accepts += symbols;
    }
    this.i = end + 1;
    return { type: 'cell', accepts: [...new Set(accepts)].join('') };
  }

  private quantified(item: CellPattern): CellPattern {
    if (!isCount(this.text[this.i])) return item;
    if (holdsCount(item)) this.fail('A group with a count inside cannot be counted again: write (oo)* or o*, not (o*)*');
    const counted = this.count(item);
    if (isCount(this.text[this.i])) this.fail('A count cannot follow another count: write o*, not o**');
    return counted;
  }

  private count(item: CellPattern): CellPattern {
    const c = this.text[this.i];
    if (c !== '{') {
      this.i += 1;
      return { type: 'repeat', item, min: c === '+' ? 1 : 0, max: c === '?' ? 1 : Infinity };
    }
    const end = this.text.indexOf('}', this.i);
    if (end < 0) this.fail('A “{” needs its “}”');
    const range = readRange(this.text.slice(this.i + 1, end), this.offset + this.i);
    this.i = end + 1;
    return range.min === 1 && range.max === 1 ? item : { type: 'repeat', item, ...range };
  }
}

/**
 * Reads the inside of a top face ("oo/o_"), its rows repeated as `repeat`
 * says (rows in brackets followed by {2} come twice). `at` is where the
 * face starts in the whole pattern, for error positions.
 */
export function parseTopFace(body: string, repeat: Range, at: number): TopFace {
  if (repeat.min < 1) throw new PatternSyntaxError('A top face has its rows at least once', at);
  const rows = new RowReader(body, at).rows();
  const rowBreak: CellPattern = { type: 'rowBreak' };
  const block: CellPattern = rows.length === 1 ? (rows[0] as CellPattern) : { type: 'seq', items: rows.flatMap((row, i) => (i === 0 ? [row] : [rowBreak, row])) };
  const counted = { min: rows.length * repeat.min, max: rows.length * repeat.max };
  if (repeat.max === 1) return { cells: block, rows: counted };
  const more: CellPattern = { type: 'repeat', item: { type: 'seq', items: [rowBreak, block] }, min: repeat.min - 1, max: repeat.max - 1 };
  return { cells: { type: 'seq', items: [block, more] }, rows: counted };
}

type Positions = readonly number[];

function union(lists: readonly Positions[]): Positions {
  return [...new Set(lists.flat())];
}

/** The positions `pattern` can reach in `grid` from those in `from`. */
function advance(pattern: CellPattern, grid: string, from: Positions): Positions {
  switch (pattern.type) {
    case 'cell':
      return from.filter((p) => p < grid.length && pattern.accepts.includes(grid[p] as string)).map((p) => p + 1);
    case 'rowBreak':
      return from.filter((p) => grid[p] === ROW_BREAK).map((p) => p + 1);
    case 'seq':
      return pattern.items.reduce((reached, item) => (reached.length === 0 ? reached : advance(item, grid, reached)), from);
    case 'alt':
      return union(pattern.options.map((option) => advance(option, grid, from)));
    case 'repeat':
      return advanceRepeat(pattern, grid, from);
  }
}

function advanceRepeat(pattern: Extract<CellPattern, { type: 'repeat' }>, grid: string, from: Positions): Positions {
  let current = from;
  for (let n = 0; n < pattern.min && current.length > 0; n++) current = advance(pattern.item, grid, current);
  const reached = new Set(current);
  // each round goes on only from positions not reached before, so this stops within the grid's length
  for (let n = pattern.min; n < pattern.max && current.length > 0; n++) {
    current = advance(pattern.item, grid, current).filter((p) => !reached.has(p));
    for (const p of current) reached.add(p);
  }
  return [...reached];
}

function rowCount(grid: string): number {
  let rows = 1;
  for (const c of grid) if (c === ROW_BREAK) rows += 1;
  return rows;
}

/** Whether a whole grid ("oo/o_") matches the face. */
export function matchesTopFace(face: TopFace, grid: string): boolean {
  const rows = rowCount(grid);
  if (rows < face.rows.min || rows > face.rows.max) return false;
  return advance(face.cells, grid, [0]).includes(grid.length);
}
