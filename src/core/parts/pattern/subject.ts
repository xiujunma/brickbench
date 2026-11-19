/**
 * Parts as patterns see them: kind, slope angle, nominal size and height,
 * features, and the top face in each of its four turns.
 */
import { nominalFootprint, nominalPlates } from '../finder/indexing';
import { featuresOf, NICKNAME_TAGS, nicknamesOf, PRINTED_TAG } from '../finder/tags';
import { normalizeForSearch } from '../finder/text';
import type { PartDef } from '../types';
import type { Kind } from './ast';

export interface Subject {
  readonly partId: string;
  /** The name, normalised for search. */
  readonly name: string;
  /** LDraw part number; empty if there is none. */
  readonly number: string;
  readonly source: 'basic' | 'library';
  /** null for a part of no kind patterns name, such as a Technic beam. */
  readonly kind: Kind | null;
  readonly angle: number | null;
  readonly inverted: boolean;
  /** The size it is sold as, short side first. */
  readonly sizes: readonly [number, number];
  /** The height it is sold as, in plates. */
  readonly plates: number;
  /** The top face as the part sits unturned: rows from back to front, joined by "/". */
  readonly grid: string;
  /** The top face in each distinct quarter turn, the unturned one first. */
  readonly grids: readonly string[];
  /** Feature ids and nicknames. */
  readonly features: ReadonlySet<string>;
  /** The colours it comes in; absent for catalogue parts, which come in every colour. */
  readonly colours?: ReadonlySet<number> | undefined;
}

const NICKNAMES: ReadonlySet<string> = new Set(NICKNAME_TAGS);

/** Kinds from LDraw names, first match winning: "Brick 2 x 2 Round" is round, "Brick 2 x 2" a brick. */
const LIBRARY_KINDS: readonly (readonly [Kind, RegExp])[] = [
  ['S', /^slope\b/],
  ['A', /^arch\b/],
  ['C', /^cone\b/],
  ['R', /^(?:(?:brick|plate|tile) \d+x\d+(?:x\S+)? round\b|cylinder\b)/],
  ['T', /^tile\b/],
  ['P', /^plate\b/],
  ['B', /^brick\b/],
];

function libraryKind(name: string, category: string): Kind | null {
  if (category === 'slope') return 'S';
  return LIBRARY_KINDS.find(([, pattern]) => pattern.test(name))?.[0] ?? null;
}

function builtInKind(part: PartDef): Kind | null {
  switch (part.category) {
    case 'bricks':
      return 'B';
    case 'plates':
      return 'P';
    case 'tiles':
      return 'T';
    case 'slopes':
      return 'S';
    case 'arches':
      return 'A';
    case 'round':
      return part.shape.kind === 'round' && part.shape.profile === 'cone' ? 'C' : 'R';
    default:
      return null;
  }
}

/** "slope 45 2x2" and "slope brick 31 1x1x2/3" give their angle; curved slopes have none. */
function slopeAngle(name: string): number | null {
  const angle = /^slope (?:brick )?(\d+) (?=\d+x)/.exec(name)?.[1];
  return angle === undefined ? null : Number(angle);
}

/**
 * The top face as rows from back (z = 0) to front, each from x = 0: o for a
 * stud, . for none, # where the library does not say, _ where the part
 * leaves the cell out.
 */
function topGrid(part: PartDef, library: boolean): string[][] {
  const filled = Array.from({ length: part.d }, () => new Array<boolean>(part.w).fill(false));
  for (const box of part.solids) {
    for (let z = Math.max(box.z0, 0); z < Math.min(box.z1, part.d); z++) {
      for (let x = Math.max(box.x0, 0); x < Math.min(box.x1, part.w); x++) (filled[z] as boolean[])[x] = true;
    }
  }
  const studs = new Set(part.studs.map(([x, z]) => `${x},${z}`));
  const top = (x: number, z: number): string => (library ? '#' : studs.has(`${x},${z}`) ? 'o' : '.');
  return filled.map((row, z) => row.map((isFilled, x) => (isFilled ? top(x, z) : '_')));
}

/** The cells a quarter turn later. */
function turn(cells: readonly (readonly string[])[]): string[][] {
  const depth = cells.length;
  const width = cells[0]?.length ?? 0;
  return Array.from({ length: width }, (_, x) => Array.from({ length: depth }, (_, z) => cells[depth - 1 - z]?.[x] ?? '_'));
}

const asGrid = (cells: readonly (readonly string[])[]): string => cells.map((row) => row.join('')).join('/');

function turnsOf(cells: string[][]): string[] {
  const grids = [cells];
  for (let n = 1; n < 4; n++) grids.push(turn(grids[n - 1] as string[][]));
  return [...new Set(grids.map(asGrid))];
}

/** A built-in part, or a library part as toPartDef gives it, ready to match patterns against. */
export function subjectOf(part: PartDef): Subject {
  const library = part.category === 'library';
  const name = normalizeForSearch(part.name);
  // library parts carry their LDraw category as their first keyword
  const kind = library ? libraryKind(name, part.keywords[0] ?? '') : builtInKind(part);
  const shape = part.shape;
  const inverted = kind === 'S' && (shape.kind === 'slope' ? shape.inverted : /\binverted\b/.test(name));
  const [a = part.w, b = part.d] = nominalFootprint(name, part.w, part.d).split('x').map(Number);
  // our own keywords are chosen, so a built-in's "cheese" counts; LDraw's are too loose to
  const keywordNicknames = library ? [] : part.keywords.filter((word) => NICKNAMES.has(word));
  const grids = turnsOf(topGrid(part, library));
  return {
    partId: part.id,
    name,
    number: part.ldraw?.file.replace(/\.dat$/, '') ?? '',
    source: library ? 'library' : 'basic',
    kind,
    angle: kind === 'S' ? slopeAngle(name) : null,
    inverted,
    sizes: [a, b],
    plates: nominalPlates(name, part.h),
    grid: grids[0] as string,
    grids,
    features: new Set([...featuresOf(name), ...nicknamesOf(name), ...keywordNicknames, ...(part.printed ? [PRINTED_TAG] : [])]),
  };
}
