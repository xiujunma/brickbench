import { toPartDef } from '../../ldraw/catalogIndex';
import type { LDrawIndexEntry } from '../../ldraw/format';
import { describeSubject, matchesPattern, subjectOf, type PartPattern, type Subject } from '../pattern';
import type { PartDef } from '../types';
import type { Indexed } from './indexing';

export interface PatternIndex {
  /**
   * The entries `keep` allows that the pattern describes. A library copy of
   * a built-in part comes only when the built-in part is not found too, so
   * "@library =3001" finds the copy and "=3001" the built-in part alone.
   */
  find(pattern: PartPattern, keep: (entry: Indexed) => boolean, owned: ReadonlySet<string> | undefined): Indexed[];
  /** The canonical pattern of a part the finder knows, such as P[oooo]{2}=3020. */
  describe(partId: string): string | undefined;
}

/** `entries` holds the built-in parts and then the library's, in the order given here. */
export function createPatternIndex(entries: readonly Indexed[], builtIns: readonly PartDef[], library: readonly LDrawIndexEntry[]): PatternIndex {
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
      const found = entries.filter((entry, i) => keep(entry) && matchesPattern(pattern, list[i] as Subject, { owned }));
      const builtInNumbers = new Set(found.filter((entry) => entry.item.source === 'basic').map((entry) => entry.item.number));
      return found.filter((entry) => !(entry.duplicate && builtInNumbers.has(entry.item.number)));
    },
    describe: (partId) => {
      byId ??= new Map(all().map((subject) => [subject.partId, subject]));
      const subject = byId.get(partId);
      return subject && describeSubject(subject);
    },
  };
}
