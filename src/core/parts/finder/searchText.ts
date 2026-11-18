import { patternColour, readQuery, type PartPattern, type PatternError } from '../pattern';
import { colourInQuery } from './colourWords';

export interface SearchText {
  /** The palette colour the query names, to build in. */
  readonly colorId: number | null;
  /** What to search for: a part pattern as typed, or the words without their colour. */
  readonly rest: string;
  /** Why a query that looks like a part pattern does not read as one; it is searched as words. */
  readonly patternError: PatternError | null;
}

function onlyColours({ root }: PartPattern): boolean {
  return root.type === 'colour' || (root.type === 'and' && root.nodes.every((node) => node.type === 'colour'));
}

/**
 * What a search box query asks for. Words lose the colour they name ("red
 * 2x4 brick" builds in red); a part pattern keeps its text, and its colour
 * term (P2x4 :red) picks the colour.
 */
export function readSearchText(query: string): SearchText {
  const reading = readQuery(query);
  if (reading.kind !== 'pattern') return { ...colourInQuery(query), patternError: reading.kind === 'broken' ? reading.error : null };
  const colorId = patternColour(reading.pattern);
  // a colour alone (":red") only picks the colour, as "red" does
  return { colorId, rest: onlyColours(reading.pattern) ? '' : query.trim(), patternError: null };
}
