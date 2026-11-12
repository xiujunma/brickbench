import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LDRAW_INDEX_VERSION } from '../../src/core/ldraw/format.ts';

/** Written into every library folder this tool builds; nothing else is ever deleted. */
export const MARKER = 'build.json';
const FORMAT = 'brickbench-ldraw';

export interface BuildInfo {
  readonly format: typeof FORMAT;
  readonly version: number;
  /** False while a build is still writing. */
  readonly complete: boolean;
  /** Built with --only or --limit: fine for development, never for shipping. */
  readonly partial: boolean;
  readonly parts: number;
  readonly generated: string;
  /** The archive the LDraw files came from, when this tool downloaded them (never a local path: this file ships). */
  readonly source: { readonly url?: string | undefined; readonly sha256?: string | undefined };
}

function readInfo(dir: string): BuildInfo | null {
  try {
    const info = JSON.parse(readFileSync(join(dir, MARKER), 'utf8')) as Partial<BuildInfo>;
    return info.format === FORMAT ? (info as BuildInfo) : null;
  } catch {
    return null;
  }
}

export function writeInfo(dir: string, info: Omit<BuildInfo, 'format' | 'version'>): void {
  const full: BuildInfo = { format: FORMAT, version: LDRAW_INDEX_VERSION, ...info };
  writeFileSync(join(dir, MARKER), `${JSON.stringify(full, null, 2)}\n`);
}

function isEmptyOrMissing(dir: string): boolean {
  return !existsSync(dir) || readdirSync(dir).length === 0;
}

/** Removes a folder only if this tool built it. */
function removeOurs(dir: string): void {
  if (isEmptyOrMissing(dir) || readInfo(dir)) rmSync(dir, { recursive: true, force: true });
  else throw new Error(`Refusing to delete ${dir}: it was not built by \`bun run ldraw\`.`);
}

/**
 * A complete, full build of the current format, with a mesh for every part
 * it lists. Interrupted, partial or older builds do not count.
 */
export function isCompleteBuild(dir: string): boolean {
  const info = readInfo(dir);
  if (!info || !info.complete || info.partial || info.version !== LDRAW_INDEX_VERSION) return false;
  try {
    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { parts?: { id?: unknown }[] };
    const parts = index.parts ?? [];
    return parts.length === info.parts && parts.every((p) => typeof p.id === 'string' && existsSync(join(dir, 'parts', `${p.id}.bin`)));
  } catch {
    return false;
  }
}

/**
 * Builds happen in a staging folder next to the output and replace it only
 * once complete, so an interrupted build never leaves a broken library.
 */
export class StagedOutput {
  readonly out: string;
  readonly staging: string;

  constructor(out: string) {
    this.out = out;
    this.staging = `${out}.partial`;
  }

  /** Checks the output may be replaced, clears leftovers and opens a fresh staging folder. */
  begin(source: BuildInfo['source'], partial: boolean): void {
    if (!isEmptyOrMissing(this.out) && !readInfo(this.out)) {
      throw new Error(`Refusing to overwrite ${this.out}: it was not built by \`bun run ldraw\`.`);
    }
    this.discard();
    mkdirSync(join(this.staging, 'parts'), { recursive: true });
    writeInfo(this.staging, { complete: false, partial, parts: 0, generated: new Date().toISOString(), source });
  }

  /** Swaps the finished staging folder in for the output. */
  commit(): void {
    const old = `${this.out}.old`;
    removeOurs(old);
    if (existsSync(this.out)) renameSync(this.out, old);
    renameSync(this.staging, this.out);
    removeOurs(old);
  }

  /** Drops a leftover staging folder from an interrupted build. */
  discard(): void {
    removeOurs(this.staging);
  }
}
