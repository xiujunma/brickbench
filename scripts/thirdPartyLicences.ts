/**
 * A Vite plugin that writes third-party-licences.txt into the build: the
 * licence of every package whose code, styles or fonts end up in the app,
 * as those licences ask when the code is passed on. It lists what the
 * bundle actually holds, not everything package.json names.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

export const LICENCES_FILE = 'third-party-licences.txt';

const NODE_MODULES = '/node_modules/';
/** LICENSE, LICENCE.md, COPYING, NOTICE and the like. */
const LICENCE_FILE = /^(?:licen[cs]e|copying|notice)(?:[.-][\w.-]*)?$/i;
const RULE = '='.repeat(72);

export interface BundledPackage {
  readonly name: string;
  readonly version: string;
  /** The licence package.json names, such as "MIT". */
  readonly licence: string;
  /** The licence files the package ships, joined; null when it ships none. */
  readonly text: string | null;
}

export interface PackageFiles {
  readonly read: (path: string) => string;
  readonly list: (dir: string) => readonly string[];
}

const DISK: PackageFiles = { read: (path) => readFileSync(path, 'utf8'), list: (dir) => readdirSync(dir) };

/** The package a bundled module comes from, with its folder; null for the app's own code. */
export function packageOf(moduleId: string): { readonly name: string; readonly dir: string } | null {
  const id = (moduleId.replace(/^\0/, '').split('?')[0] ?? '').replaceAll('\\', '/');
  const at = id.lastIndexOf(NODE_MODULES);
  if (at < 0) return null;
  const [first = '', second = ''] = id.slice(at + NODE_MODULES.length).split('/');
  const name = first.startsWith('@') ? `${first}/${second}` : first;
  if (name === '' || name.endsWith('/')) return null;
  return { name, dir: `${id.slice(0, at + NODE_MODULES.length)}${name}` };
}

/** A package's name, version, licence and licence text, from its folder. */
export function readPackage(dir: string, files: PackageFiles = DISK): BundledPackage {
  const manifest = JSON.parse(files.read(join(dir, 'package.json'))) as {
    readonly name?: string;
    readonly version?: string;
    readonly license?: string | { readonly type?: string };
  };
  const licence = typeof manifest.license === 'string' ? manifest.license : (manifest.license?.type ?? 'unknown');
  const texts = files
    .list(dir)
    .filter((file) => LICENCE_FILE.test(file))
    .toSorted()
    .map((file) => files.read(join(dir, file)).trim());
  return { name: manifest.name ?? dir, version: manifest.version ?? '', licence, text: texts.length > 0 ? texts.join('\n\n') : null };
}

/** The licences file: a line on what it is, then each package, by name. */
export function formatLicences(packages: readonly BundledPackage[]): string {
  const sections = packages
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((p) => `${RULE}\n${p.name} ${p.version} (${p.licence})\n${RULE}\n\n${p.text ?? `Licensed under ${p.licence}. The package includes no licence text.`}\n`);
  return [`BrickBench includes code from these ${packages.length} packages. Their licences follow.\n`, ...sections].join('\n');
}

/** The packages behind a bundle's modules, each once. */
export function bundledPackages(moduleIds: Iterable<string>, files: PackageFiles = DISK): BundledPackage[] {
  const dirs = new Map<string, string>();
  for (const id of moduleIds) {
    const found = packageOf(id);
    if (found) dirs.set(found.name, found.dir);
  }
  return [...dirs.values()].map((dir) => readPackage(dir, files));
}

export function thirdPartyLicences(): Plugin {
  return {
    name: 'brickbench:third-party-licences',
    apply: 'build',
    generateBundle(_options, bundle) {
      const ids = Object.values(bundle).flatMap((output) => (output.type === 'chunk' ? output.moduleIds : []));
      this.emitFile({ type: 'asset', fileName: LICENCES_FILE, source: formatLicences(bundledPackages(ids)) });
    },
  };
}
