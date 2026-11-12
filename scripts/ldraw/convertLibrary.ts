import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { encodePartMesh, LDRAW_INDEX_VERSION, type LDrawIndex, type LDrawIndexEntry } from '../../src/core/ldraw/format.ts';
import { convertPart, type Conversion } from './convert.ts';
import { creditsText, type Credit } from './credits.ts';
import { Flattener } from './flatten.ts';
import { directorySource, normalizeName, type LibrarySource } from './library.ts';
import { displayName, exclusionReason, readHeader, type PartHeader } from './select.ts';

/** Same rule as the app's index schema. */
const PART_ID = /^[0-9a-z_-]{1,40}$/;
const MAX_FOOTPRINT = 256;
const MAX_PLATES = 1023;
const MAX_KEYWORDS = 40;
const LICENCE_FILES = ['CAreadme.txt', 'CAlicense.txt', 'CAlicense4.txt'];

export interface ConvertOptions {
  /** Only these part numbers, if given. */
  readonly only: ReadonlySet<string> | null;
  /** Stop after this many converted parts. */
  readonly limit: number;
  readonly onProgress?: (converted: number) => void;
}

/** Why parts were left out, with a few examples each. */
export class Tally {
  readonly counts = new Map<string, number>();
  readonly examples = new Map<string, string[]>();

  add(reason: string, example?: string): void {
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1);
    const list = this.examples.get(reason) ?? [];
    if (example && list.length < 5) this.examples.set(reason, [...list, example]);
  }
}

export interface ConvertedLibrary {
  readonly entries: readonly LDrawIndexEntry[];
  readonly credits: ReadonlyMap<string, Credit>;
  readonly tally: Tally;
  /** Size of the mesh files written. */
  readonly bytes: number;
}

/** Wraps a source so every file it hands out is credited. */
function crediting(source: LibrarySource, credits: Map<string, Credit>): LibrarySource {
  return {
    read(name) {
      const file = source.read(name);
      if (file) {
        const path = `${file.primitive ? 'p' : 'parts'}/${normalizeName(name)}`;
        if (!credits.has(path)) {
          const header = readHeader(file.text);
          credits.set(path, { file: path, description: header.description, author: header.author });
        }
      }
      return file;
    },
  };
}

function round(n: number): number {
  const r = Math.round(n * 1e4) / 1e4;
  return r === 0 ? 0 : r;
}

function toEntry(id: string, header: PartHeader, conversion: Extract<Conversion, { ok: true }>): LDrawIndexEntry {
  const { fit } = conversion;
  const keywords = header.keywords.slice(0, MAX_KEYWORDS).map((k) => k.slice(0, 80));
  return {
    id,
    name: displayName(header.description).slice(0, 200),
    category: header.category.slice(0, 60),
    ...(keywords.length > 0 ? { keywords } : {}),
    ...(header.author ? { author: header.author.slice(0, 120) } : {}),
    w: fit.w,
    d: fit.d,
    h: fit.h,
    origin: [round(fit.offset[0]), round(fit.offset[1]), round(fit.offset[2])],
    snug: fit.snug,
  };
}

type Outcome = { readonly ok: true; readonly entry: LDrawIndexEntry; readonly data: Uint8Array } | { readonly ok: false; readonly reason: string; readonly example?: string };

/** Decides about one part file: left out (and why), or converted. */
function convertOne(root: string, file: string, flattener: Flattener): Outcome {
  const id = file.slice(0, -4).toLowerCase();
  const header = readHeader(readFileSync(join(root, 'parts', file), 'utf8'));
  const excluded = exclusionReason(header) ?? (PART_ID.test(id) ? null : 'unusual file name');
  if (excluded) return { ok: false, reason: excluded };
  let result: Conversion;
  try {
    result = convertPart(file, flattener);
  } catch (error) {
    return { ok: false, reason: 'missing file', example: `${file}: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!result.ok) return { ok: false, reason: result.reason, example: file };
  if (result.fit.w > MAX_FOOTPRINT || result.fit.d > MAX_FOOTPRINT || result.fit.h > MAX_PLATES) {
    return { ok: false, reason: 'too big', example: file };
  }
  return { ok: true, entry: toEntry(id, header, result), data: gzipSync(encodePartMesh(result.mesh), { level: 9 }) };
}

/** Converts the parts of an unpacked LDraw library, writing one mesh file per part into `partsDir`. */
export function convertLibrary(root: string, partsDir: string, options: ConvertOptions): ConvertedLibrary {
  const credits = new Map<string, Credit>();
  const flattener = new Flattener(crediting(directorySource(root), credits));
  const tally = new Tally();
  const entries: LDrawIndexEntry[] = [];
  let bytes = 0;
  const files = readdirSync(join(root, 'parts')).filter((f) => f.toLowerCase().endsWith('.dat')).sort();
  for (const file of files) {
    if (entries.length >= options.limit) break;
    if (options.only && !options.only.has(file.slice(0, -4).toLowerCase())) continue;
    const outcome = convertOne(root, file, flattener);
    if (!outcome.ok) {
      tally.add(outcome.reason, outcome.example);
      continue;
    }
    writeFileSync(join(partsDir, `${outcome.entry.id}.bin`), outcome.data);
    bytes += outcome.data.length;
    entries.push(outcome.entry);
    options.onProgress?.(entries.length);
  }
  return { entries, credits, tally, bytes };
}

/** Writes index.json, the credits and LDraw's licence files next to the meshes. */
export function writeLibraryFiles(dir: string, root: string, library: ConvertedLibrary, generated: string): void {
  const index: LDrawIndex = {
    version: LDRAW_INDEX_VERSION,
    generated,
    parts: [...library.entries].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })),
  };
  writeFileSync(join(dir, 'index.json'), JSON.stringify(index));
  const shipped = new Set(library.entries.map((e) => `parts/${e.id}.dat`));
  const all = [...library.credits.values()];
  writeFileSync(join(dir, 'CREDITS.txt'), creditsText(all.filter((c) => shipped.has(c.file)), all.filter((c) => !shipped.has(c.file)), generated));
  for (const name of LICENCE_FILES) {
    if (existsSync(join(root, name))) copyFileSync(join(root, name), join(dir, name));
  }
}
