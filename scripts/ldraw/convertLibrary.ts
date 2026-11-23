import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  encodePartMesh,
  LDRAW_INDEX_VERSION,
  MAX_ALIASES,
  MAX_CONNECTORS,
  MAX_SIDE_STUDS,
  type ConnectorEntry,
  type LDrawIndex,
  type LDrawIndexEntry,
  type SideStudEntry,
} from '../../src/core/ldraw/format.ts';
import { plainNumberOf } from '../../src/core/ldraw/prints.ts';
import { readColourTable, type ColourTable } from './colours.ts';
import { convertPart, type Conversion } from './convert.ts';
import { creditsText, type Credit } from './credits.ts';
import { Flattener } from './flatten.ts';
import { directorySource, normalizeName, type LibrarySource } from './library.ts';
import { aliasTarget, displayName, exclusionReason, isPrintedPart, readHeader, type PartHeader } from './select.ts';

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
  /** Old part numbers and what LDraw says they now are, as found (not yet followed to kept parts). */
  readonly aliases: ReadonlyMap<string, string>;
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

/** A plate's height in studs. */
const PLATE_STUDS = 0.4;
/** A part's extent goes in the index when it is more than two LDraw units inside its cells on some side. */
const EXTENT_SLACK = 0.1;

/** An extent rounded outwards to a hundredth of a stud, so it still holds the whole shape. */
function outwards(extent: readonly [number, number, number, number, number, number]): readonly [number, number, number, number, number, number] {
  // a whisker of slack either way, so a value already on a hundredth stays on it
  const out = (v: number, k: number): number => (k < 3 ? Math.floor(v * 100 + 1e-6) : Math.ceil(v * 100 - 1e-6)) / 100 + 0;
  return [out(extent[0], 0), out(extent[1], 1), out(extent[2], 2), out(extent[3], 3), out(extent[4], 4), out(extent[5], 5)];
}

function round(n: number): number {
  const r = Math.round(n * 1e4) / 1e4;
  return r === 0 ? 0 : r;
}

function toEntry(id: string, header: PartHeader, conversion: Extract<Conversion, { ok: true }>): LDrawIndexEntry {
  const { fit, solids, sideStuds, connectors, extent, alike } = conversion;
  // the cells it sits in, around its origin: its extent is worth listing only when well inside them
  const cells = [-fit.w / 2, 0, -fit.d / 2, fit.w / 2, fit.h * PLATE_STUDS, fit.d / 2];
  const inside = extent.some((v, k) => (k < 3 ? v - (cells[k] ?? 0) : (cells[k] ?? 0) - v) > EXTENT_SLACK);
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
    ...(fit.studOffset.some((offset) => offset !== 0) ? { studOffset: fit.studOffset } : {}),
    ...(solids ? { solids } : {}),
    ...(sideStuds.length > 0
      ? { sideStuds: sideStuds.slice(0, MAX_SIDE_STUDS).map(([x, y, z, facing]): SideStudEntry => [round(x), round(y), round(z), facing]) }
      : {}),
    ...(connectors.length > 0
      ? {
          connectors: connectors
            .slice(0, MAX_CONNECTORS)
            .map(([kind, x, y, z, ax, ay, az, length]): ConnectorEntry => [kind, round(x), round(y), round(z), round(ax), round(ay), round(az), round(length)]),
        }
      : {}),
    // each names the first alike with it, never a later one, so those listed still name only those listed
    ...(alike ? { alike: alike.slice(0, MAX_CONNECTORS) } : {}),
    ...(inside ? { extent: outwards(extent) } : {}),
    ...(isPrintedPart(header) ? { printed: true as const } : {}),
  };
}

type Outcome =
  | { readonly ok: true; readonly entry: LDrawIndexEntry; readonly data: Uint8Array }
  | { readonly ok: false; readonly reason: string; readonly example?: string; readonly aliasOf?: string };

/** Decides about one part file: left out (and why, and what it now stands for), or converted. */
function convertOne(root: string, file: string, flattener: Flattener, colours: ColourTable): Outcome {
  const id = file.slice(0, -4).toLowerCase();
  const text = readFileSync(join(root, 'parts', file), 'utf8');
  const header = readHeader(text);
  const excluded = exclusionReason(header) ?? (PART_ID.test(id) ? null : 'unusual file name');
  if (excluded) {
    const target = aliasTarget(header, text);
    return target && PART_ID.test(id) && PART_ID.test(target) && target !== id ? { ok: false, reason: excluded, aliasOf: target } : { ok: false, reason: excluded };
  }
  let result: Conversion;
  try {
    result = convertPart(file, flattener, colours);
  } catch (error) {
    return { ok: false, reason: 'missing file', example: `${file}: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!result.ok) return { ok: false, reason: result.reason, example: file };
  if (result.fit.w > MAX_FOOTPRINT || result.fit.d > MAX_FOOTPRINT || result.fit.h > MAX_PLATES) {
    return { ok: false, reason: 'too big', example: file };
  }
  return { ok: true, entry: toEntry(id, header, result), data: gzipSync(encodePartMesh(result.mesh), { level: 9 }) };
}

/** LDraw's colour table, for the colours parts fix; without one they are drawn grey. */
function readColours(root: string): ColourTable {
  const path = join(root, 'LDConfig.ldr');
  return existsSync(path) ? readColourTable(readFileSync(path, 'utf8')) : new Map();
}

/** Converts the parts of an unpacked LDraw library, writing one mesh file per part into `partsDir`. */
export function convertLibrary(root: string, partsDir: string, options: ConvertOptions): ConvertedLibrary {
  const credits = new Map<string, Credit>();
  const flattener = new Flattener(crediting(directorySource(root), credits));
  const colours = readColours(root);
  const tally = new Tally();
  const entries: LDrawIndexEntry[] = [];
  const aliases = new Map<string, string>();
  let bytes = 0;
  const files = readdirSync(join(root, 'parts')).filter((f) => f.toLowerCase().endsWith('.dat')).sort();
  for (const file of files) {
    if (entries.length >= options.limit) break;
    if (options.only && !options.only.has(file.slice(0, -4).toLowerCase())) continue;
    const outcome = convertOne(root, file, flattener, colours);
    if (!outcome.ok) {
      tally.add(outcome.reason, outcome.example);
      if (outcome.aliasOf) aliases.set(file.slice(0, -4).toLowerCase(), outcome.aliasOf);
      continue;
    }
    writeFileSync(join(partsDir, `${outcome.entry.id}.bin`), outcome.data);
    bytes += outcome.data.length;
    entries.push(outcome.entry);
    options.onProgress?.(entries.length);
  }
  return { entries, aliases, credits, tally, bytes };
}

/** Renames that end at a kept part, followed through LDraw's chains of moves (4073 → 6141), sorted by old number. */
export function keptAliases(aliases: ReadonlyMap<string, string>, kept: ReadonlySet<string>): [string, string][] {
  const resolved: [string, string][] = [];
  for (const [from] of aliases) {
    let to = aliases.get(from);
    const seen = new Set([from]);
    while (to !== undefined && !kept.has(to) && !seen.has(to)) {
      seen.add(to);
      to = aliases.get(to);
    }
    if (to !== undefined && kept.has(to) && !kept.has(from)) resolved.push([from, to]);
  }
  return resolved.sort(([a], [b]) => a.localeCompare(b)).slice(0, MAX_ALIASES);
}

/**
 * Each printed part with the plain part it decorates, when that is kept too:
 * under its own number, or the one it was renamed to (3068p01 → 3068b).
 */
export function withPlainParts(entries: readonly LDrawIndexEntry[], aliases: readonly (readonly [string, string])[]): LDrawIndexEntry[] {
  const plain = new Set(entries.filter((e) => !e.printed).map((e) => e.id));
  const renamed = new Map(aliases);
  const known = (stem: string): string | null => {
    if (plain.has(stem)) return stem;
    const now = renamed.get(stem);
    return now !== undefined && plain.has(now) ? now : null;
  };
  return entries.map((entry) => {
    const base = entry.printed ? plainNumberOf(entry.id, known) : null;
    return base === null ? entry : { ...entry, base };
  });
}

/** Writes index.json, the credits and LDraw's licence files next to the meshes. */
export function writeLibraryFiles(dir: string, root: string, library: ConvertedLibrary, generated: string): void {
  const aliases = keptAliases(library.aliases, new Set(library.entries.map((e) => e.id)));
  const index: LDrawIndex = {
    version: LDRAW_INDEX_VERSION,
    generated,
    parts: withPlainParts(library.entries, aliases).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })),
    ...(aliases.length > 0 ? { aliases } : {}),
  };
  writeFileSync(join(dir, 'index.json'), JSON.stringify(index));
  const shipped = new Set(library.entries.map((e) => `parts/${e.id}.dat`));
  const all = [...library.credits.values()];
  writeFileSync(join(dir, 'CREDITS.txt'), creditsText(all.filter((c) => shipped.has(c.file)), all.filter((c) => !shipped.has(c.file)), generated));
  for (const name of LICENCE_FILES) {
    if (existsSync(join(root, name))) copyFileSync(join(root, name), join(dir, name));
  }
}
