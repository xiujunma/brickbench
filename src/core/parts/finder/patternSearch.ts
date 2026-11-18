import { toPartDef } from '../../ldraw/catalogIndex';
import type { LDrawIndexEntry } from '../../ldraw/format';
import { describeSubject, matchesPattern, PatternTooCostlyError, subjectOf, WorkBudget, type PartPattern, type Subject } from '../pattern';
import type { PartDef } from '../types';
import type { Indexed } from './indexing';

/**
 * Grid positions one search may look at. The heaviest likely patterns, such
 * as [(#|_)*]{1,256} over the whole library, take about 2 million; a search
 * that needs more stops, saying the pattern asks too much.
 */
export const MAX_SEARCH_WORK = 6_000_000;

/** What a pattern search found, or that it asked for more work than a search may do. */
export type PatternFound = { readonly found: readonly Indexed[] } | { readonly tooCostly: true };

export interface PatternIndex {
  /**
   * The entries `keep` allows that the pattern describes. A library copy of
   * a built-in part comes only when the built-in part is not found too, so
   * "@library =3001" finds the copy and "=3001" the built-in part alone.
   */
  find(pattern: PartPattern, keep: (entry: Indexed) => boolean, owned: ReadonlySet<string> | undefined): PatternFound;
  /** The canonical pattern of a part the finder knows, such as P[oooo]{2}=3020. */
  describe(partId: string): string | undefined;
}

/** `entries` holds the built-in parts and then the library's, in the order given here. */
export function createPatternIndex(
  entries: readonly Indexed[],
  builtIns: readonly PartDef[],
  library: readonly LDrawIndexEntry[],
  work = MAX_SEARCH_WORK,
): PatternIndex {
  let subjects: readonly Subject[] | null = null;
  let byId: ReadonlyMap<string, Subject> | null = null;
  // made on first use: most sessions never type a pattern
  const all = (): readonly Subject[] => {
    subjects ??= [...builtIns.map(subjectOf), ...library.map((entry) => subjectOf(toPartDef(entry)))];
    return subjects;
  };

  return {
    find: (pattern, keep, owned) => {
      const list = all();
      const context = { owned, budget: new WorkBudget(work) };
      let found: Indexed[];
      try {
        found = entries.filter((entry, i) => keep(entry) && matchesPattern(pattern, list[i] as Subject, context));
      } catch (error: unknown) {
        if (error instanceof PatternTooCostlyError) return { tooCostly: true };
        throw error;
      }
      const builtInNumbers = new Set(found.filter((entry) => entry.item.source === 'basic').map((entry) => entry.item.number));
      return { found: found.filter((entry) => !(entry.duplicate && builtInNumbers.has(entry.item.number))) };
    },
    describe: (partId) => {
      byId ??= new Map(all().map((subject) => [subject.partId, subject]));
      const subject = byId.get(partId);
      return subject && describeSubject(subject);
    },
  };
}
