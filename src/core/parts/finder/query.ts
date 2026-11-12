import { isSizeWord, normalizeForSearch } from './text';

/**
 * Other ways builders say a word, mostly US spellings of LDraw's British
 * names and hobby terms for the official ones. A phrase must appear whole,
 * each word at the start of a word ("peg" finds "pin", not "Spindled").
 * A Map, so typed words like "constructor" can't reach object internals.
 */
const SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ['tire', ['tyre']],
  ['center', ['centre']],
  ['windshield', ['windscreen']],
  ['fender', ['mudguard']],
  ['minifigure', ['minifig']],
  ['liftarm', ['technic beam']],
  ['bushing', ['bush']],
  ['peg', ['pin']],
  ['vent', ['grille']],
  ['grill', ['grille']],
  ['circle', ['round']],
  ['circular', ['round']],
  ['flat', ['tile']],
  ['smooth', ['tile']],
  ['roof', ['slope']],
]);

/** One way a term may appear: these words, all present. */
export interface TermOption {
  readonly words: readonly string[];
  /** Must start a word, as synonyms and corrections do; typed words may sit anywhere. */
  readonly wordStart: boolean;
}

export interface QueryTerm {
  /** What the user typed for this word. */
  readonly text: string;
  readonly options: readonly TermOption[];
  /** Sizes and short words must match as typed; longer words may forgive a typo. */
  readonly forgiving: boolean;
}

export interface ParsedQuery {
  readonly terms: readonly QueryTerm[];
  /** The whole query, normalised: a name starting with it is the best match. */
  readonly phrase: string;
}

/** Words people add that no part name has. */
const FILLER: ReadonlySet<string> = new Set(['lego', 'legos']);

/** "bricks" → brick, "boxes" → box, "glasses" → glass, "batteries" → battery; short words stay as they are. */
function singulars(word: string): string[] {
  if (word.length <= 3 || !word.endsWith('s') || word.endsWith('ss')) return [word];
  const forms = [word, word.slice(0, -1)];
  if (/(?:ss|x|z|ch|sh)es$/.test(word)) forms.push(word.slice(0, -2));
  if (word.endsWith('ies')) forms.push(`${word.slice(0, -3)}y`);
  return forms;
}

/** Sizes either way round, as the size filter takes them: "4x2" is also "2x4". */
function sizeForms(word: string): string[] {
  const [a = '', b = '', ...rest] = word.split('x');
  return a === b ? [word] : [word, [b, a, ...rest].join('x')];
}

function termFor(word: string): QueryTerm {
  const forms = isSizeWord(word) ? sizeForms(word) : singulars(word);
  const typed = forms.map((form): TermOption => ({ words: [form], wordStart: false }));
  const synonyms = forms.flatMap((form) => (SYNONYMS.get(form) ?? []).map((s): TermOption => ({ words: s.split(' '), wordStart: true })));
  return { text: word, options: [...typed, ...synonyms], forgiving: word.length >= 4 && !isSizeWord(word) && !/\d/.test(word) };
}

/** Splits a query into words, each with its plural, synonym and size spellings. */
export function parseQuery(query: string): ParsedQuery {
  const words = normalizeForSearch(query)
    .split(' ')
    .filter((word) => word !== '' && !FILLER.has(word));
  return { terms: words.map(termFor), phrase: words.join(' ') };
}
