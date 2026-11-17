import type { LDrawIndexEntry } from '../../ldraw/format';
import type { PartDef } from '../types';
import { builtInItem, indexItem, libraryItem, type FinderItem, type Indexed, type PartSource } from './indexing';
import { parseQuery, type ParsedQuery } from './query';
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
}

export interface FinderResult {
  readonly items: readonly FinderItem[];
  /** Nothing matched as typed, so these are close spellings. */
  readonly fuzzy: boolean;
}

export interface FootprintCount {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

export interface Finder {
  readonly count: number;
  /** The finder's view of one part, built-in or library, if it knows it. */
  get(partId: string): FinderItem | undefined;
  find(query: string, filters?: FinderFilters): FinderResult;
  /** Footprints that at least `minimum` parts have, smallest first. */
  footprints(minimum?: number): readonly FootprintCount[];
}

/** Source and category: where the user is looking, before any facet narrows it. */
function inScope(entry: Indexed, filters: FinderFilters): boolean {
  if (filters.source ? entry.item.source !== filters.source : entry.duplicate) return false;
  return filters.category === undefined || entry.item.category === filters.category;
}

function passes(entry: Indexed, filters: FinderFilters): boolean {
  if (!inScope(entry, filters)) return false;
  if (filters.only && !filters.only.has(entry.item.partId)) return false;
  if (filters.footprint !== undefined && entry.footprint !== filters.footprint) return false;
  if (filters.height !== undefined && entry.height !== filters.height) return false;
  return filters.feature === undefined || entry.features.has(filters.feature);
}

function matchesAll(entry: Indexed, parsed: ParsedQuery): boolean {
  return parsed.terms.every((term) => matches(entry.haystack, term));
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
 * and close spellings when the words match nothing at all.
 */
export function createFinder(builtIns: readonly PartDef[], library: readonly LDrawIndexEntry[]): Finder {
  const builtInNumbers = new Set(builtIns.map((p) => p.ldraw?.file.replace(/\.dat$/, '')).filter(Boolean));
  const entries: Indexed[] = [
    ...builtIns.map((part, i) => indexItem(builtInItem(part), part.keywords, i, false)),
    ...library.map((e, i) => indexItem(libraryItem(e), e.keywords ?? [], builtIns.length + i, builtInNumbers.has(e.id))),
  ];
  // every word any part's text has, to correct typos against
  const vocabulary = [...new Set(entries.flatMap((entry) => entry.haystack.split(' ')))].filter((word) => /^[a-z]{4,}$/.test(word));
  const byId = new Map(entries.map((entry) => [entry.item.partId, entry.item]));

  const find = (query: string, filters: FinderFilters = {}): FinderResult => {
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
    get: (partId) => byId.get(partId),
    find,
    footprints: (minimum = 1) => countFootprints(entries, minimum),
  };
}
