import { containsToken, normalizeSearchText, searchTokens } from '../parts/catalog';
import type { LDrawIndexEntry } from './format';

export interface CategoryCount {
  readonly name: string;
  readonly count: number;
}

export type LibrarySearch = (query: string, category: string | null) => readonly LDrawIndexEntry[];

/** Categories with how many parts each holds, alphabetically. */
export function categoriesOf(entries: readonly LDrawIndexEntry[]): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** Longest name the ranking tells apart by where a match falls. */
const MAX_NAME = 200;

interface Ranked {
  readonly entry: LDrawIndexEntry;
  readonly rank: number;
  readonly order: number;
}

/**
 * Prepares a search over the library: every query word must appear in a
 * part's name, number, category or keywords (sizes as whole numbers).
 * Best matches come first: the part with that number, names starting with
 * the query, names holding every word (earliest first), then the rest. Browsing a category
 * lists parts named after it first ("Technic …" in Technic). Ties keep the
 * index order, which is by name.
 */
export function createLibrarySearch(entries: readonly LDrawIndexEntry[]): LibrarySearch {
  const names = entries.map((e) => normalizeSearchText(e.name));
  const haystacks = entries.map((e, i) => [names[i], normalizeSearchText([e.id, e.category, ...(e.keywords ?? [])].join(' '))].join(' '));

  const rankFor = (i: number, tokens: readonly string[], phrase: string, lead: string): number => {
    const name = names[i] ?? '';
    if (tokens.length === 0) return lead && name.startsWith(lead) ? 0 : 1;
    if (entries[i]?.id === phrase) return 0;
    if (name.startsWith(phrase)) return 1;
    if (!tokens.every((token) => containsToken(name, token))) return 3;
    // "Brick 2 × 4" before "Bracket 1 × 2 - 2 × 4": the earlier the words appear, the better
    const at = name.indexOf(tokens[0] ?? '');
    return 2 + Math.min(Math.max(at, 0), MAX_NAME) / (MAX_NAME + 1);
  };

  return (query, category) => {
    const tokens = searchTokens(query);
    const phrase = tokens.join(' ');
    const lead = category === null ? '' : (normalizeSearchText(category).split(' ')[0] ?? '');
    const ranked: Ranked[] = [];
    entries.forEach((entry, i) => {
      if (category !== null && entry.category !== category) return;
      const haystack = haystacks[i] ?? '';
      if (!tokens.every((token) => containsToken(haystack, token))) return;
      ranked.push({ entry, rank: rankFor(i, tokens, phrase, lead), order: i });
    });
    return ranked.sort((a, b) => a.rank - b.rank || a.order - b.order).map((r) => r.entry);
  };
}
