import type { Finder } from '../../../core/parts/finder/finder';
import { useLibrary } from '../../../state/library';
import { finderFor } from '../../../state/partFinder';

/** One finder over the built-in parts and the library, built once per library index. */
export function useFinder(): Finder {
  return finderFor(useLibrary((s) => s.entries));
}
