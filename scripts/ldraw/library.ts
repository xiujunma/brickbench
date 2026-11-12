import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LibraryFile {
  readonly text: string;
  /** Found among the shared primitives (p/), which are worth caching. */
  readonly primitive: boolean;
}

/** Where LDraw files come from: a library folder on disk, or memory in tests. */
export interface LibrarySource {
  read(name: string): LibraryFile | null;
}

/** Normalises a reference ("S\\3001s01.dat") to a lower-case relative path ("s/3001s01.dat"). */
export function normalizeName(name: string): string {
  return name.trim().replace(/\\/g, '/').toLowerCase();
}

/** References must stay inside the library: no absolute paths, drive letters or "..". */
export function isSafeName(file: string): boolean {
  return file.length > 0 && !file.startsWith('/') && !file.includes(':') && !file.split('/').includes('..');
}

/** Reads from an unpacked LDraw library: parts/ (and parts/s/) first, then p/ (and p/48/). */
export function directorySource(root: string): LibrarySource {
  return {
    read(name) {
      const file = normalizeName(name);
      if (!isSafeName(file)) return null;
      for (const base of ['parts', 'p']) {
        const path = join(root, base, file);
        if (existsSync(path)) return { text: readFileSync(path, 'utf8'), primitive: base === 'p' };
      }
      return null;
    },
  };
}

export function memorySource(files: Readonly<Record<string, string>>): LibrarySource {
  const byName = new Map(Object.entries(files).map(([name, text]) => [normalizeName(name), text]));
  return {
    read(name) {
      const text = byName.get(normalizeName(name));
      return text === undefined ? null : { text, primitive: false };
    },
  };
}
