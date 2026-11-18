/**
 * Telling patterns from words in a search box, where both are typed: a
 * query is a pattern when it has something only patterns have and reads
 * as one. A size alone ("2x4") stays words, which the word search ranks.
 */
import type { PartPattern, PatternNode } from './ast';
import type { PatternError } from './errors';
import { parsePattern } from './parse';
import { KIND_ALONE } from './partTerm';

const PLAIN_SIZE = /^\s*\d+\s*[x×]\s*\d+(?:\s*[x×]\s*\d+)?\s*$/;
/** Characters only patterns use, or a -feature. */
const MARKER = /[[\]^=@!"“”|(){}*+:]|(?:^|\s)-[a-z]/;
/** Where a word can start: a kind letter there is a pattern's if no letter or hyphen follows it (P2x4, S45, Si). */
const WORD_START = /(?:^|[\s(!|])(?=[A-Z])/g;

function hasKindLetter(text: string): boolean {
  return [...text.matchAll(WORD_START)].some((start) => KIND_ALONE.test(text.slice(start.index + start[0].length)));
}

export type QueryReading =
  | { readonly kind: 'words' }
  | { readonly kind: 'pattern'; readonly pattern: PartPattern }
  /** Looks like a pattern but does not read as one: search the words, and say why if they find nothing. */
  | { readonly kind: 'broken'; readonly error: PatternError };

export function readQuery(text: string): QueryReading {
  if (PLAIN_SIZE.test(text) || !(MARKER.test(text) || hasKindLetter(text))) return { kind: 'words' };
  const parsed = parsePattern(text);
  return parsed.ok ? { kind: 'pattern', pattern: parsed.pattern } : { kind: 'broken', error: parsed.error };
}

/** The colour a pattern asks for outright (P2x4 :red), to build in; null when it names none or several. */
export function patternColour(pattern: PartPattern): number | null {
  const root: PatternNode = pattern.root;
  const terms = root.type === 'and' ? root.nodes : [root];
  const colours = new Set(terms.flatMap((node) => (node.type === 'colour' ? [node.colour] : [])));
  return colours.size === 1 ? ([...colours][0] as number) : null;
}
