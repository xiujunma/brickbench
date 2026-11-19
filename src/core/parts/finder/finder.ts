import type { LDrawIndexEntry } from '../../ldraw/format';
import { readQuery, type PartPattern } from '../pattern';
import type { PartDef } from '../types';
import { builtInItem, indexItem, libraryItem, type FinderItem, type Indexed, type PartSource } from './indexing';
import { createPatternIndex, MAX_SEARCH_WORK } from './patternSearch';
import { parseQuery, type ParsedQuery, type QueryTerm } from './query';
import { browseRank, matches, rank, sortRanked, withCorrections } from './ranking';
import type { Feature, HeightClass } from './tags';

export type { FinderItem, PartSource } from './indexing';

export interface FinderFilters {
  /** Only parts from here; without it, library copies of built-in parts are left out. */
  readonly source?: PartSource | undefined;
  readonly category?: string | undefined;
  /** "1x2" and the like, either way round. */
  readonly footprint?: string | undefined;
  readonly height?: HeightClass | undefined;
  readonly feature?: Feature | undefined;
  /** Only these parts, such as the ones the user owns. */
  readonly only?: ReadonlySet<string> | undefined;
  /** The parts the user owns: what @owned in a part pattern keeps to. */
  readonly ownedParts?: ReadonlySet<string> | undefined;
  /** Only printed and stickered parts. */
  readonly printed?: boolean | undefined;
}

export interface FinderResult {
  readonly items: readonly FinderItem[];
  /** Nothing matched as typed, so these are close spellings. */
  readonly fuzzy: boolean;
  /** The query was a part pattern (docs/part-patterns.md), not words. */
  readonly pattern?: boolean;
  /** The pattern asked more work of the search than it may do, so nothing was found. */
  readonly tooCostly?: boolean;
}

export interface FootprintCount {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

export interface Finder {
  readonly count: number;
  /** How many of them have a print or stickers. */
  readonly printed: number;
  /** The finder's view of one part, built-in or library, if it knows it. */
  get(partId: string): FinderItem | undefined;
  /** Searches by words, or by a part pattern such as P2x4 or S45[oo/..] when the query is one. */
  find(query: string, filters?: FinderFilters): FinderResult;
  /** A part's canonical pattern, such as P[oooo]{2}=3020, if the finder knows the part. */
  patternOf(partId: string): string | undefined;
  /** Footprints that at least `minimum` parts have, smallest first. */
  footprints(minimum?: number): readonly FootprintCount[];
}

/**
 * Source and category: where the user is looking, before any facet narrows
 * it. Without a source, library copies of built-in parts are left out
 * unless `withCopies`.
 */
function inScope(entry: Indexed, filters: FinderFilters, withCopies = false): boolean {
  if (filters.source ? entry.item.source !== filters.source : entry.duplicate && !withCopies) return false;
  return filters.category === undefined || entry.item.category === filters.category;
}

function passes(entry: Indexed, filters: FinderFilters, withCopies = false): boolean {
  if (!inScope(entry, filters, withCopies)) return false;
  if (filters.only && !filters.only.has(entry.item.partId)) return false;
  if (filters.printed && !entry.item.printed) return false;
  if (filters.footprint !== undefined && entry.footprint !== filters.footprint) return false;
  if (filters.height !== undefined && entry.height !== filters.height) return false;
  return filters.feature === undefined || entry.features.has(filters.feature);
}

/** A term that is one of the part's tags, whole, such as "printed". */
const isTag = (entry: Indexed, term: QueryTerm): boolean => term.options.some((option) => option.words.length === 1 && entry.tags.has(option.words[0] ?? ''));

function matchesAll(entry: Indexed, parsed: ParsedQuery): boolean {
  return parsed.terms.every((term) => matches(entry.haystack, term) || isTag(entry, term));
}

function search(candidates: readonly Indexed[], parsed: ParsedQuery): FinderItem[] {
  const found = candidates.filter((entry) => matchesAll(entry, parsed));
  return sortRanked(found.map((entry) => ({ entry, rank: rank(entry, parsed) })));
}

function countFootprints(entries: readonly Indexed[], minimum: number): FootprintCount[] {
  const counts = new Map<string, number>();
  for (const entry of entries) if (!entry.duplicate) counts.set(entry.footprint, (counts.get(entry.footprint) ?? 0) + 1);
  return [...counts]
    .filter(([, count]) => count >= minimum)
    .map(([key, count]) => {
      const [a = 0, b = 0] = key.split('x').map(Number);
      return { key, label: `${a} × ${b}`, count, a, b };
    })
    .sort((x, y) => x.a * x.b - y.a * y.b || x.a - y.a)
    .map(({ key, label, count }) => ({ key, label, count }));
}

/**
 * One search over the built-in parts and the LDraw library: everyday words,
 * sizes written any way, nicknames, filters for size, height and features,
 * close spellings when the words match nothing at all, and part patterns.
 * `searchWork` bounds what one pattern search may do (see MAX_SEARCH_WORK).
 */
export function createFinder(builtIns: readonly PartDef[], library: readonly LDrawIndexEntry[], searchWork = MAX_SEARCH_WORK): Finder {
  const builtInNumbers = new Set(builtIns.map((p) => p.ldraw?.file.replace(/\.dat$/, '')).filter(Boolean));
  const entries: Indexed[] = [
    ...builtIns.map((part, i) => indexItem(builtInItem(part), part.keywords, i, false)),
    ...library.map((e, i) => indexItem(libraryItem(e), e.keywords ?? [], builtIns.length + i, builtInNumbers.has(e.id))),
  ];
  // every word any part's text has, to correct typos against
  const vocabulary = [...new Set(entries.flatMap((entry) => entry.haystack.split(' ')))].filter((word) => /^[a-z]{4,}$/.test(word));
  const byId = new Map(entries.map((entry) => [entry.item.partId, entry.item]));
  const patterns = createPatternIndex(entries, builtIns, library, searchWork);

  const findPattern = (pattern: PartPattern, filters: FinderFilters): FinderResult => {
    // copies come back only when the pattern finds the copy and not the built-in part
    const result = patterns.find(pattern, (entry) => passes(entry, filters, true), filters.ownedParts);
    if ('tooCostly' in result) return { items: [], fuzzy: false, pattern: true, tooCostly: true };
    return { items: sortRanked(result.found.map((entry) => ({ entry, rank: browseRank(entry, filters.category) }))), fuzzy: false, pattern: true };
  };

  const find = (query: string, filters: FinderFilters = {}): FinderResult => {
    const reading = readQuery(query);
    if (reading.kind === 'pattern') return findPattern(reading.pattern, filters);
    const parsed = parseQuery(query);
    const candidates = entries.filter((entry) => passes(entry, filters));
    if (parsed.terms.length === 0) {
      const browsing = candidates.map((entry) => ({ entry, rank: browseRank(entry, filters.category) }));
      return { items: sortRanked(browsing), fuzzy: false };
    }
    const exact = search(candidates, parsed);
    if (exact.length > 0) return { items: exact, fuzzy: false };
    // the words are spelt right and the filters ruled the parts out: say so rather than guess
    if (entries.some((entry) => inScope(entry, filters) && matchesAll(entry, parsed))) return { items: [], fuzzy: false };
    const close = search(candidates, withCorrections(parsed, vocabulary));
    return { items: close, fuzzy: close.length > 0 };
  };

  return {
    count: entries.filter((e) => !e.duplicate).length,
    printed: entries.filter((e) => e.item.printed).length,
    get: (partId) => byId.get(partId),
    find,
    patternOf: (partId) => patterns.describe(partId),
    footprints: (minimum = 1) => countFootprints(entries, minimum),
  };
}
