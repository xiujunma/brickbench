import { allowedTypos, withinEdits } from './fuzzy';
import type { FinderItem, Indexed } from './indexing';
import type { ParsedQuery, QueryTerm } from './query';
import { findWord, normalizeForSearch } from './text';

/** How good a match is: a tier first, then where in the name the words fall. */
export interface Rank {
  readonly tier: number;
  readonly position: number;
}

/** Words that only match inside another word count as this many words further on. */
const MID_WORD_PENALTY = 50;

export function matches(text: string, term: QueryTerm): boolean {
  return term.options.some((option) => option.words.every((word) => findWord(text, word, option.wordStart) !== -1));
}

const wordIndex = (name: string, at: number): number => name.slice(0, at).split(' ').length - 1;

/** Which word of the name a term lands in, whole words before matches inside a word. */
function wordPosition(name: string, term: QueryTerm | undefined): number {
  let best = MID_WORD_PENALTY;
  for (const option of term?.options ?? []) {
    const word = option.words[0] ?? '';
    const start = findWord(name, word, true);
    const inside = start === -1 && !option.wordStart ? findWord(name, word) : -1;
    if (start !== -1) best = Math.min(best, wordIndex(name, start));
    else if (inside !== -1) best = Math.min(best, wordIndex(name, inside) + MID_WORD_PENALTY);
  }
  return best;
}

/** The name begins with the query, sizes whole: "brick 1x1" begins "brick 1x1 round" but not "brick 1x10". */
function beginsWith(name: string, phrase: string): boolean {
  if (!name.startsWith(phrase)) return false;
  return !/\d$/.test(phrase) || !/^[\dx.]/.test(name.slice(phrase.length));
}

/**
 * Tiers: the part with that number, names that start with the query, parts
 * the query is a nickname of, names holding every word, and last parts found
 * through their keywords or category.
 */
export function rank(entry: Indexed, query: ParsedQuery): Rank {
  const { phrase, terms } = query;
  if (entry.item.number === phrase || entry.item.partId === phrase) return { tier: 0, position: 0 };
  if (beginsWith(entry.name, phrase)) return { tier: 1, position: 0 };
  if (entry.tags.has(phrase)) return { tier: 2, position: 0 };
  if (!terms.every((term) => matches(entry.name, term))) return { tier: 4, position: 0 };
  return { tier: 3, position: wordPosition(entry.name, terms[0]) };
}

/** With nothing typed: in a library category, parts named after it come first ("Technic …" in Technic). */
export function browseRank(entry: Indexed, category: string | undefined): Rank {
  if (!category || entry.item.source !== 'library') return { tier: 0, position: 0 };
  const lead = normalizeForSearch(category).split(' ')[0] ?? '';
  return { tier: lead && entry.name.startsWith(lead) ? 0 : 1, position: 0 };
}

/**
 * Best first: plain parts before printed ones, however well a print matches
 * (a tile's prints run into hundreds, and a part's own number finds only
 * it); then by tier, then built-in parts (the common, polished ones), then
 * position, then catalogue order.
 */
export function sortRanked(ranked: readonly { readonly entry: Indexed; readonly rank: Rank }[]): FinderItem[] {
  const source = (e: Indexed): number => (e.item.source === 'basic' ? 0 : 1);
  const printed = (e: Indexed): number => (e.item.printed ? 1 : 0);
  return [...ranked]
    .sort(
      (a, b) =>
        printed(a.entry) - printed(b.entry) ||
        a.rank.tier - b.rank.tier ||
        source(a.entry) - source(b.entry) ||
        a.rank.position - b.rank.position ||
        a.entry.order - b.entry.order,
    )
    .map((r) => r.entry.item);
}

/** Adds the real words a mistyped term is close to, so "hnige" also looks for "hinge". */
export function withCorrections(query: ParsedQuery, vocabulary: readonly string[]): ParsedQuery {
  const terms = query.terms.map((term) => {
    if (!term.forgiving) return term;
    const typos = allowedTypos(term.text.length);
    const close = vocabulary.filter((word) => word !== term.text && withinEdits(term.text, word, typos));
    return { ...term, options: [...term.options, ...close.map((word) => ({ words: [word], wordStart: true }))] };
  });
  return { ...query, terms };
}
