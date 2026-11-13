import type { LDrawIndexEntry } from '../core/ldraw/format';
import { PARTS } from '../core/parts/catalog';
import { createFinder, type Finder } from '../core/parts/finder/finder';

const finders = new WeakMap<readonly LDrawIndexEntry[], Finder>();

/** One finder over the basic parts and a library index, built once per index. */
export function finderFor(entries: readonly LDrawIndexEntry[]): Finder {
  let finder = finders.get(entries);
  if (!finder) {
    finder = createFinder(PARTS, entries);
    finders.set(entries, finder);
  }
  return finder;
}
