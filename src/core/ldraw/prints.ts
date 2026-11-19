/**
 * Printed and stickered parts. LDraw names them "… with … Pattern" or
 * "… with … Sticker(s)", and numbers them after their plain part, with a "p"
 * for a print (3626bp01) and a "d" for stickers (10202d01). Shared by the
 * library build, which marks them, and the importers, which fall back to the
 * plain part when a model's print is not in the library.
 */

/** Whether an LDraw description names a printed or stickered part: "with … Pattern" (or "Patt."), "… Sticker", but not "without Pattern". */
export function isPrintedName(description: string): boolean {
  if (/\b(?:without|no)\s+(?:pattern|patt|stickers?)\b/i.test(description)) return false;
  return /\b(?:pattern|patt|stickers?)\b/i.test(description);
}

/** The letters LDraw puts between a plain part's number and its print's. */
const DECORATION_MARKS: ReadonlySet<string> = new Set(['p', 'd']);

/**
 * The plain part a printed one decorates, from its number: the longest stem
 * before a "p" or "d" that `known` recognises, as whatever `known` returns
 * for it (the stem itself, or the part it now stands for). Null if none.
 */
export function plainNumberOf<T extends string>(number: string, known: (stem: string) => T | null): T | null {
  for (let at = number.length - 1; at > 0; at -= 1) {
    if (!DECORATION_MARKS.has(number[at] ?? '')) continue;
    const plain = known(number.slice(0, at));
    if (plain !== null) return plain;
  }
  return null;
}
