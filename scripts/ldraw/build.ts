/**
 * Converts the LDraw parts library into the meshes BrickBench ships with:
 *
 *   <out>/index.json        every part: name, category, grid size, origin
 *   <out>/parts/<id>.bin    one gzip-compressed BBM1 mesh per part
 *   <out>/CREDITS.txt       authors and licence, as CC BY asks
 *   <out>/build.json        what was built from what, and whether it is complete
 *
 *   bun run ldraw [--library <dir>] [--out public/ldraw] [--only 3001,3003] [--limit 200] [--if-missing] [--fetch-only]
 *
 * Without --library (or LDRAW_DIR) the official complete.zip is downloaded
 * into .ldraw-cache/ on first use. --if-missing leaves a complete build
 * alone, which is how `bun run build` makes sure the library ships.
 * --fetch-only just downloads and unpacks the library, e.g. for the
 * LDraw verification tests.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { convertLibrary, writeLibraryFiles, type ConvertedLibrary } from './convertLibrary.ts';
import { COMPLETE_ZIP_URL, ensureLibrary, type Library } from './download.ts';
import { isCompleteBuild, StagedOutput, writeInfo } from './output.ts';

interface Options {
  readonly library: string | undefined;
  readonly out: string;
  readonly cache: string;
  readonly only: ReadonlySet<string> | null;
  readonly limit: number;
  readonly ifMissing: boolean;
  readonly fetchOnly: boolean;
}

const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

function readOptions(argv: readonly string[]): Options {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      library: { type: 'string' },
      out: { type: 'string', default: 'public/ldraw' },
      cache: { type: 'string', default: '.ldraw-cache' },
      only: { type: 'string' },
      limit: { type: 'string' },
      'if-missing': { type: 'boolean', default: false },
      'fetch-only': { type: 'boolean', default: false },
    },
  });
  const limit = values.limit === undefined ? Infinity : Number(values.limit);
  if (!(limit > 0)) throw new Error('--limit needs a positive number.');
  const only = values.only ? new Set(values.only.split(',').map((id) => id.trim().toLowerCase()).filter(Boolean)) : null;
  return {
    library: values.library ?? process.env['LDRAW_DIR'],
    out: values.out,
    cache: values.cache,
    only,
    limit,
    ifMissing: values['if-missing'],
    fetchOnly: values['fetch-only'],
  };
}

async function findLibrary(options: Options): Promise<Library> {
  const library: Library = options.library ? { root: resolve(options.library) } : await ensureLibrary(options.cache, log);
  if (!existsSync(join(library.root, 'parts'))) throw new Error(`${library.root} is not an LDraw library: it has no parts folder.`);
  return library;
}

function report(out: string, library: ConvertedLibrary, seconds: number): void {
  const { entries, tally, bytes } = library;
  log(`\nConverted ${entries.length} parts into ${out} (${(bytes / 1e6).toFixed(1)} MB of meshes) in ${seconds.toFixed(0)} s.`);
  log(`Snug on the grid: ${entries.filter((e) => e.snug).length}.`);
  for (const [reason, count] of [...tally.counts].sort((a, b) => b[1] - a[1])) {
    log(`Left out, ${reason}: ${count}`);
    for (const example of tally.examples.get(reason) ?? []) log(`    e.g. ${example}`);
  }
}

async function main(): Promise<void> {
  const started = performance.now();
  const options = readOptions(process.argv.slice(2));
  if (options.fetchOnly) {
    log(`The LDraw library is ready in ${(await findLibrary(options)).root}.`);
    return;
  }
  const output = new StagedOutput(resolve(options.out));
  if (options.ifMissing && isCompleteBuild(output.out)) {
    output.discard();
    log(`The LDraw library is already built in ${options.out}; run \`bun run ldraw\` to rebuild it.`);
    return;
  }
  const library = await findLibrary(options);
  const partial = options.only !== null || Number.isFinite(options.limit);
  const source = library.sha256 ? { url: COMPLETE_ZIP_URL, sha256: library.sha256 } : {};
  output.begin(source, partial);

  const converted = convertLibrary(library.root, join(output.staging, 'parts'), {
    only: options.only,
    limit: options.limit,
    onProgress: (count) => {
      if (count % 500 === 0) log(`  ${count} parts converted …`);
    },
  });
  const generated = new Date().toISOString();
  writeLibraryFiles(output.staging, library.root, converted, generated);
  writeInfo(output.staging, { complete: true, partial, parts: converted.entries.length, generated, source });
  output.commit();
  report(output.out, converted, (performance.now() - started) / 1000);
  if (partial) log('This is a partial build: `bun run build` will replace it with the full library.');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
