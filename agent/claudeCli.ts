/**
 * Finding Claude Code on this computer, in any runtime: on the PATH, and
 * where its installers and Node's version managers put it, since an app
 * opened from the Finder or the Start menu does not get the PATH a terminal
 * has. Claude Code then runs with a PATH that has its own folder first, as
 * npm's and Bun's launchers look for Node beside them.
 */
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { readSetting, type Environment } from './settings';

const VERSION_TIMEOUT_MS = 10_000;
const MAX_FAILURE = 300;

export interface ClaudeLookup {
  readonly env: Environment;
  readonly platform: NodeJS.Platform;
  readonly home: string;
  /** What a relative BRICKBENCH_CLAUDE is relative to. */
  readonly cwd: string;
}

/** Where Claude Code's installers put it: the native installer's folder first, then Homebrew, npm, Bun, Volta, asdf and fnm. */
function installFolders(lookup: ClaudeLookup): string[] {
  const { home, platform } = lookup;
  if (platform === 'win32') return [join(home, '.local', 'bin')];
  return [
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.asdf', 'shims'),
    join(home, 'Library', 'Application Support', 'fnm', 'aliases', 'default', 'bin'),
    join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin'),
  ];
}

/** nvm's Node versions' folders, newest first: npm installs Claude Code beside each version's Node. */
async function nvmFolders(home: string): Promise<string[]> {
  const versions = join(home, '.nvm', 'versions', 'node');
  try {
    const names = await readdir(versions);
    return names.sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map((name) => join(versions, name, 'bin'));
  } catch {
    // no nvm here
    return [];
  }
}

const separator = (platform: NodeJS.Platform): string => (platform === 'win32' ? ';' : ':');

function pathFolders(lookup: ClaudeLookup): string[] {
  return (lookup.env['PATH'] ?? lookup.env['Path'] ?? '').split(separator(lookup.platform)).filter(Boolean);
}

/**
 * The files Claude Code may be, in the order to try them: BRICKBENCH_CLAUDE
 * if it is a path; else its name (BRICKBENCH_CLAUDE, or claude) in each
 * folder of the PATH, then in the installers' folders, then in `more`. On
 * Windows only programs (.exe) count: npm's .cmd shims would need a shell to
 * start, and the arguments cannot be trusted to one.
 */
export function claudeCandidates(lookup: ClaudeLookup, more: readonly string[] = [], extension = '.exe'): string[] {
  const chosen = readSetting(lookup.env, 'BRICKBENCH_CLAUDE');
  if (chosen && /[\\/]/.test(chosen)) return [resolve(lookup.cwd, chosen)];
  const name = chosen ?? 'claude';
  const file = lookup.platform === 'win32' && !name.toLowerCase().endsWith(extension) ? `${name}${extension}` : name;
  const folders = [...pathFolders(lookup), ...installFolders(lookup), ...more];
  return [...new Set(folders.map((folder) => join(folder, file)))];
}

async function isProgram(file: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    if (!(await stat(file)).isFile()) return false;
    if (platform !== 'win32') await access(file, constants.X_OK);
    return true;
  } catch {
    // not there, or not something we may run
    return false;
  }
}

async function firstProgram(candidates: readonly string[], platform: NodeJS.Platform): Promise<string | null> {
  for (const candidate of candidates) {
    if (await isProgram(candidate, platform)) return candidate;
  }
  return null;
}

/** Claude Code's command, as an absolute path, or null when it is nowhere to be found. */
export async function findClaude(lookup: ClaudeLookup): Promise<string | null> {
  return firstProgram(claudeCandidates(lookup, await nvmFolders(lookup.home)), lookup.platform);
}

/** On Windows, npm's claude.cmd, which BrickBench cannot start, when there is no claude.exe; null anywhere else. */
export async function findClaudeShim(lookup: ClaudeLookup): Promise<string | null> {
  if (lookup.platform !== 'win32') return null;
  const npm = lookup.env['APPDATA'] ? [join(lookup.env['APPDATA'], 'npm')] : [];
  return firstProgram(claudeCandidates(lookup, npm, '.cmd'), lookup.platform);
}

/** The PATH Claude Code runs with: its own folder first (where npm's and Bun's launchers find Node), then the usual. */
export function claudePath(command: string, lookup: ClaudeLookup): string {
  return [...new Set([dirname(command), ...pathFolders(lookup), ...installFolders(lookup)])].join(separator(lookup.platform));
}

/** The environment Claude Code runs in: this one, with that PATH (under one name, as Windows has it either way). */
export function claudeEnv(command: string, lookup: ClaudeLookup): Record<string, string> {
  const kept = Object.entries(lookup.env).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[0].toUpperCase() !== 'PATH');
  return { ...Object.fromEntries(kept), PATH: claudePath(command, lookup) };
}

export type ClaudeVersion = { readonly version: string } | { readonly failure: string };

/** "2.1.323" from `claude --version`, or why it did not say. */
export function claudeVersion(command: string, lookup: ClaudeLookup, timeoutMs = VERSION_TIMEOUT_MS): Promise<ClaudeVersion> {
  return new Promise((done) => {
    execFile(command, ['--version'], { timeout: timeoutMs, windowsHide: true, env: claudeEnv(command, lookup) }, (error, stdout, stderr) => {
      const version = String(stdout).trim().split(/\s+/)[0] ?? '';
      if (!error && version) {
        done({ version });
        return;
      }
      const said = String(stderr).trim().split('\n').filter(Boolean).at(-1) ?? '';
      const why = said || (error ? error.message : 'it printed no version');
      done({ failure: why.slice(0, MAX_FAILURE) });
    });
  });
}
