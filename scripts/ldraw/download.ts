import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The official library, all parts in one archive (about 150 MB). It always
 * holds the latest release, so the archive's SHA-256 is recorded with every
 * build to tell which one went in; pass --library to pin a copy you keep.
 */
export const COMPLETE_ZIP_URL = 'https://library.ldraw.org/library/updates/complete.zip';

export interface Library {
  readonly root: string;
  /** SHA-256 of the archive it was unpacked from, when this tool downloaded it. */
  readonly sha256?: string | undefined;
}

/** Written once an archive is fully unpacked; a cache without it is redone. */
const MARKER = 'ldraw.json';

function unpack(zip: string, into: string): void {
  try {
    execFileSync('unzip', ['-q', '-o', zip, '-d', into], { stdio: 'inherit' });
  } catch {
    // Windows and minimal Linux images often lack unzip; bsdtar reads zip files too.
    execFileSync('tar', ['-xf', zip, '-C', into], { stdio: 'inherit' });
  }
}

function sha256Of(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function readMarker(cacheDir: string): Library | null {
  try {
    const marker = JSON.parse(readFileSync(join(cacheDir, MARKER), 'utf8')) as { sha256?: unknown };
    const root = join(cacheDir, 'ldraw');
    return existsSync(join(root, 'parts')) ? { root, sha256: typeof marker.sha256 === 'string' ? marker.sha256 : undefined } : null;
  } catch {
    return null;
  }
}

async function download(zip: string, log: (message: string) => void): Promise<void> {
  log(`Downloading the LDraw parts library from ${COMPLETE_ZIP_URL} …`);
  const response = await fetch(COMPLETE_ZIP_URL);
  if (!response.ok) throw new Error(`Could not download the LDraw library (HTTP ${response.status}).`);
  const partial = `${zip}.part`;
  writeFileSync(partial, new Uint8Array(await response.arrayBuffer()));
  renameSync(partial, zip);
}

/**
 * Makes sure a fully unpacked copy of the official library sits in
 * `cacheDir`, downloading it on first use. Unpacking happens in a staging
 * folder, so an interrupted run never passes for a complete library.
 */
export async function ensureLibrary(cacheDir: string, log: (message: string) => void): Promise<Library> {
  const cached = readMarker(cacheDir);
  if (cached) return cached;
  mkdirSync(cacheDir, { recursive: true });
  const zip = join(cacheDir, 'complete.zip');
  if (!existsSync(zip)) await download(zip, log);

  log('Unpacking the library …');
  const staging = join(cacheDir, 'unpacking');
  const root = join(cacheDir, 'ldraw');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging);
  unpack(zip, staging);
  if (!existsSync(join(staging, 'ldraw', 'parts'))) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error(`${zip} did not contain an ldraw/parts folder. Delete it and try again.`);
  }
  rmSync(root, { recursive: true, force: true });
  renameSync(join(staging, 'ldraw'), root);
  rmSync(staging, { recursive: true, force: true });
  const sha256 = sha256Of(zip);
  writeFileSync(join(cacheDir, MARKER), `${JSON.stringify({ url: COMPLETE_ZIP_URL, sha256, unpacked: new Date().toISOString() }, null, 2)}\n`);
  return { root, sha256 };
}
