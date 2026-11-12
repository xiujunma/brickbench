/** Number words people type for sizes ("two by four"). */
const NUMBER_WORDS: Readonly<Record<string, string>> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
};

const NUMBER_WORD = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'g');

/**
 * Lower-cases text and writes sizes one way, so "2 × 4", "2 x 4", "2 by 4"
 * and "two by four" all become "2x4". Part names and queries both go
 * through this, so whatever spelling one uses, the other matches.
 */
export function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/°/g, '')
    .replace(/[,;:()[\]{}"“”‘’«»!?]/g, ' ')
    .replace(NUMBER_WORD, (word) => NUMBER_WORDS[word] ?? word)
    .replace(/(\d)\s*(?:x|by)\s*(?=\d)/g, '$1x')
    .replace(/\s+/g, ' ')
    .trim();
}

const SIZE_WORD = /^\d+(?:x\d+)+$/;
/** What carries a size on into a fraction: "1x2x2/3", "2x4x1 & 2/3", "1x2x1 2/3". */
const FRACTION_AFTER = /^(?:[\d./]| (?:& )?\d+\/\d)/;

/** A size such as "2x4" or "1x2x3". */
export function isSizeWord(word: string): boolean {
  return SIZE_WORD.test(word);
}

/** Whether a match at this position begins a word. */
export function startsWord(text: string, at: number): boolean {
  return at === 0 || !/[a-z0-9]/.test(text[at - 1] ?? '');
}

/**
 * Where a word first appears in normalised text, or -1. Sizes match whole
 * numbers only, so "1x2" finds "1x2" and "1x2x3" but not "11x23", "1x20",
 * the "2x2" inside "1x2x2" or the "1x2x1" of "1x2x1 2/3". Other words match
 * anywhere ("plat" finds "plate"), or only at the start of a word when
 * `wordStart` is set.
 */
export function findWord(text: string, word: string, wordStart = false): number {
  const size = isSizeWord(word);
  let at = text.indexOf(word);
  while (at !== -1) {
    const before = text[at - 1] ?? '';
    const fits = size
      ? !/[\dx./]/.test(before) && !FRACTION_AFTER.test(text.slice(at + word.length))
      : !wordStart || startsWord(text, at);
    if (fits) return at;
    at = text.indexOf(word, at + 1);
  }
  return -1;
}

export function containsWord(text: string, word: string, wordStart = false): boolean {
  return findWord(text, word, wordStart) !== -1;
}
