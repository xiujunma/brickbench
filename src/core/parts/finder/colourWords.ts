import { COLORS } from '../../colors';
import { normalizeForSearch } from './text';

/** What builders call some palette colours. */
const ALIASES: readonly (readonly [alias: string, colour: string])[] = [
  ['grey', 'Light Bluish Grey'],
  ['light grey', 'Light Bluish Grey'],
  ['dark grey', 'Dark Bluish Grey'],
  ['clear', 'Trans Clear'],
  ['transparent', 'Trans Clear'],
  ['brown', 'Reddish Brown'],
  ['gold', 'Pearl Gold'],
  ['silver', 'Flat Silver'],
];

interface ColourWords {
  readonly words: string;
  readonly colorId: number;
}

/** Longest names first, so "dark red" wins over "red" and "trans clear" over "clear". */
const COLOUR_WORDS: readonly ColourWords[] = [
  ...COLORS.map((colour) => ({ words: normalizeForSearch(colour.name), colorId: colour.id })),
  ...ALIASES.flatMap(([alias, name]) => {
    const colour = COLORS.find((c) => c.name === name);
    return colour ? [{ words: alias, colorId: colour.id }] : [];
  }),
].sort((a, b) => b.words.split(' ').length - a.words.split(' ').length || b.words.length - a.words.length);

export interface ColourQuery {
  /** The palette colour the query names, if any. */
  readonly colorId: number | null;
  /** The rest of the query, normalised: what to search for. */
  readonly rest: string;
}

/**
 * Finds a colour named in a query, so "red 2x4 brick" searches for a 2 × 4
 * brick to build in red. Colours match as whole words, US "gray" included.
 */
export function colourInQuery(query: string): ColourQuery {
  const text = ` ${normalizeForSearch(query).replace(/\bgray\b/g, 'grey')} `;
  for (const colour of COLOUR_WORDS) {
    const at = text.indexOf(` ${colour.words} `);
    if (at === -1) continue;
    const rest = `${text.slice(0, at)} ${text.slice(at + colour.words.length + 2)}`;
    return { colorId: colour.colorId, rest: rest.replace(/\s+/g, ' ').trim() };
  }
  return { colorId: null, rest: text.trim() };
}
