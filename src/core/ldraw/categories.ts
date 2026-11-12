import type { LDrawIndexEntry } from './format';

export interface CategoryCount {
  readonly name: string;
  readonly count: number;
}

/** Categories with how many parts each holds, alphabetically. */
export function categoriesOf(entries: readonly LDrawIndexEntry[]): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}
