/**
 * The terms that are not part terms: +feature and -feature, :colour,
 * =number, @source and "name words".
 */
import { getColor } from '../../colors';
import { colourInQuery } from '../finder/colourWords';
import { FEATURES, NICKNAME_TAGS } from '../finder/tags';
import { normalizeForSearch } from '../finder/text';
import { isKind, type PatternNode } from './ast';
import type { Cursor } from './cursor';

/** What + and - take: the finder's features and the nicknames builders use. */
export const FEATURE_WORDS: ReadonlySet<string> = new Set([...FEATURES.map((f) => f.id), ...NICKNAME_TAGS]);

/** A palette colour from a name ("red", "dark-bluish-grey", "gray") or an LDraw code ("4"). */
export function colourNamed(word: string): number | null {
  if (/^\d+$/.test(word)) return getColor(Number(word)) ? Number(word) : null;
  const { colorId, rest } = colourInQuery(word.replace(/[-_]/g, ' '));
  return rest === '' ? colorId : null;
}

export function readFeature(cursor: Cursor): PatternNode {
  const at = cursor.i;
  const wanted = cursor.peek() === '+';
  cursor.i += 1;
  const word = cursor.read(/^[a-z][a-z-]*/) ?? cursor.fail('Name a feature after + or -, as in +clip', at);
  if (!FEATURE_WORDS.has(word)) cursor.fail(`“${word}” is not a feature: ${[...FEATURE_WORDS].join(', ')}`, at + 1);
  return { type: 'feature', name: word, wanted };
}

export function readColour(cursor: Cursor): PatternNode {
  const at = cursor.i;
  cursor.i += 1;
  const word = cursor.read(/^[A-Za-z0-9][A-Za-z0-9_-]*/) ?? cursor.fail('Name a colour after :, as in :red, :dark-bluish-grey or :4', at);
  const colour = colourNamed(word) ?? cursor.fail(`No colour is called “${word}”`, at + 1);
  return { type: 'colour', colour };
}

export function readNumber(cursor: Cursor): PatternNode {
  const at = cursor.i;
  cursor.i += 1;
  const glob = cursor.read(/^[0-9A-Za-z_*?-]+/) ?? cursor.fail('Write a part number after =, as in =3001 or =30*', at);
  cursor.read(/^\.dat(?![\w.])/i);
  return { type: 'number', glob: glob.toLowerCase() };
}

export function readSource(cursor: Cursor): PatternNode {
  const at = cursor.i;
  cursor.i += 1;
  const word = cursor.read(/^[a-z]+/);
  if (word !== 'basic' && word !== 'library' && word !== 'owned') return cursor.fail('A source is @basic, @library or @owned', at);
  return { type: 'source', source: word };
}

export function readName(cursor: Cursor): PatternNode {
  const at = cursor.i;
  const close = cursor.text.slice(at + 1).search(/["”]/);
  if (close < 0) cursor.fail('A quote needs its closing quote', at);
  const words = normalizeForSearch(cursor.text.slice(at + 1, at + 1 + close))
    .split(' ')
    .filter((word) => word !== '');
  if (words.length === 0) cursor.fail('Put words between the quotes, as in "clip"', at);
  cursor.i = at + close + 2;
  return { type: 'name', words };
}

/** Why the text here is not a term, with what was probably meant. */
export function strayMessage(cursor: Cursor): string {
  // the whole character, not half of an emoji's surrogate pair
  const c = String.fromCodePoint(cursor.text.codePointAt(cursor.i) ?? 0);
  const word = /^[A-Za-z][A-Za-z-]*/.exec(cursor.rest())?.[0];
  if (word === undefined) {
    if (c === ']' || c === '}') return `This “${c}” closes nothing`;
    return `“${c}” has no meaning here`;
  }
  const lower = word.toLowerCase();
  if (word.length === 1 && isKind(word.toUpperCase()) && word !== word.toUpperCase()) return `Kinds are capital letters: ${word.toUpperCase()}`;
  if (/^[BPTRCA]?i$/.test(word)) return 'Only slopes are inverted: write i straight after S or its angle, as in S45i';
  if (word.length === 1 && /[A-Z]/.test(word)) return `The kinds are B, P, T, S, R, C and A: “${word}” is not one`;
  if (FEATURE_WORDS.has(lower)) return `Features take + or -: +${lower}`;
  if (colourNamed(lower) !== null) return `Colours take a colon: :${lower}`;
  return `Words of a name go in quotes: "${lower}"`;
}
