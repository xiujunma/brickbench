import type { LDrawIndexEntry } from '../../../core/ldraw/format';
import { PARTS } from '../../../core/parts/catalog';
import { createFinder, type Finder } from '../../../core/parts/finder/finder';
import { useLibrary } from '../../../state/library';

const finders = new WeakMap<readonly LDrawIndexEntry[], Finder>();

/** One finder over the built-in parts and the library, built once per library index. */
export function useFinder(): Finder {
  const entries = useLibrary((s) => s.entries);
  let finder = finders.get(entries);
  if (!finder) {
    finder = createFinder(PARTS, entries);
    finders.set(entries, finder);
  }
  return finder;
}
