/** How many typos a word of this length may have and still match. */
export function allowedTypos(length: number): number {
  if (length < 4) return 0;
  return length < 8 ? 1 : 2;
}

/**
 * Whether two words are at most `max` single-letter edits apart (insert,
 * delete, replace, or swap two neighbours), stopping early once they can't be.
 */
export function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  if (a === b) return true;
  let previous2: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min((previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, (previous2[j - 2] ?? 0) + 1);
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > max) return false;
    previous2 = previous;
    previous = row;
  }
  return (previous[b.length] ?? Infinity) <= max;
}
