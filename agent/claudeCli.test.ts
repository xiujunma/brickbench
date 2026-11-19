import { afterAll, describe, expect, it } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeCandidates, claudeEnv, claudePath, claudeVersion, findClaude, findClaudeShim, type ClaudeLookup } from './claudeCli';

const root = mkdtempSync(join(tmpdir(), 'brickbench-claude-cli-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A program in `folder` that prints its version, as `claude --version` does. */
function program(folder: string, name = 'claude', version = '2.1.0 (Claude Code)'): string {
  mkdirSync(folder, { recursive: true });
  const file = join(folder, name);
  writeFileSync(file, `#!/bin/sh\necho "${version}"\n`);
  chmodSync(file, 0o755);
  return file;
}

const lookup = (env: Record<string, string>, extra: Partial<ClaudeLookup> = {}): ClaudeLookup => ({ env, platform: 'darwin', home: join(root, 'home'), cwd: root, ...extra });

describe('finding Claude Code', () => {
  it('looks on the PATH first, then where its installers put it', () => {
    const home = join(root, 'home');
    expect(claudeCandidates(lookup({ PATH: '/a:/b' }))).toEqual([
      '/a/claude',
      '/b/claude',
      join(home, '.local', 'bin', 'claude'),
      join(home, '.claude', 'local', 'claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
      join(home, '.npm-global', 'bin', 'claude'),
      join(home, '.bun', 'bin', 'claude'),
      join(home, '.volta', 'bin', 'claude'),
      join(home, '.asdf', 'shims', 'claude'),
      join(home, 'Library', 'Application Support', 'fnm', 'aliases', 'default', 'bin', 'claude'),
      join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin', 'claude'),
    ]);
  });

  it('takes BRICKBENCH_CLAUDE as the path to it, or as another name to look for', () => {
    expect(claudeCandidates(lookup({ BRICKBENCH_CLAUDE: 'tools/claude', PATH: '/a' }))).toEqual([join(root, 'tools', 'claude')]);
    expect(claudeCandidates(lookup({ BRICKBENCH_CLAUDE: 'claude-beta', PATH: '/a' }))[0]).toBe('/a/claude-beta');
  });

  it('looks for the program, not npm’s shim, on Windows', () => {
    const candidates = claudeCandidates(lookup({ Path: 'C:\\Tools;D:\\Bin' }, { platform: 'win32', home: 'C:\\Users\\me' }));
    expect(candidates).toEqual([join('C:\\Tools', 'claude.exe'), join('D:\\Bin', 'claude.exe'), join('C:\\Users\\me', '.local', 'bin', 'claude.exe')]);
  });

  it('finds it where an app with no PATH of its own would miss it', async () => {
    const installed = program(join(root, 'home', '.local', 'bin'));
    expect(await findClaude(lookup({ PATH: '/usr/bin:/bin' }))).toBe(installed);
  });

  it('passes over files it may not run, folders, and nothing at all', async () => {
    // a name no real install has, so a Claude Code on this computer is no match
    const name = 'claude-for-brickbench-tests';
    const folder = join(root, 'not-runnable');
    mkdirSync(join(folder, name), { recursive: true });
    const plain = join(root, 'plain');
    mkdirSync(plain);
    writeFileSync(join(plain, name), 'not a program');
    expect(await findClaude(lookup({ BRICKBENCH_CLAUDE: name, PATH: `${folder}:${plain}` }, { home: join(root, 'nobody') }))).toBeNull();
    expect(await findClaude(lookup({ BRICKBENCH_CLAUDE: join(root, 'missing', 'claude') }))).toBeNull();
  });

  it('finds it beside the newest Node that nvm has', async () => {
    // a name no real install has, so a Claude Code on this computer is no match
    const name = 'claude-for-brickbench-tests';
    const versions = join(root, 'nvm-home', '.nvm', 'versions', 'node');
    program(join(versions, 'v20.9.0', 'bin'), name, '1.0.0');
    const newest = program(join(versions, 'v22.11.0', 'bin'), name, '2.0.0');
    expect(await findClaude(lookup({ BRICKBENCH_CLAUDE: name, PATH: '/usr/bin:/bin' }, { home: join(root, 'nvm-home') }))).toBe(newest);
  });

  it('reads the version it says it is, or why it said none', async () => {
    const plain = lookup({ PATH: '/usr/bin:/bin' });
    expect(await claudeVersion(program(join(root, 'versioned')), plain)).toEqual({ version: '2.1.0' });
    expect(await claudeVersion(join(root, 'missing', 'claude'), plain)).toMatchObject({ failure: expect.stringContaining('ENOENT') });
    expect(await claudeVersion(program(join(root, 'silent'), 'claude', ''), plain)).toEqual({ failure: 'it printed no version' });
    const broken = join(root, 'broken');
    mkdirSync(broken);
    writeFileSync(join(broken, 'claude'), '#!/bin/sh\necho "env: node: No such file or directory" >&2\nexit 127\n');
    chmodSync(join(broken, 'claude'), 0o755);
    expect(await claudeVersion(join(broken, 'claude'), plain)).toEqual({ failure: 'env: node: No such file or directory' });
  });

  it('runs a launcher that wants Node beside it, as npm’s does, even with no PATH to find it', async () => {
    // claude is a script for "fake-node", which lives in the same folder, as Node does beside an npm install
    const folder = join(root, 'npm-global', 'bin');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'fake-node'), '#!/bin/sh\necho "3.0.0 (Claude Code)"\n');
    chmodSync(join(folder, 'fake-node'), 0o755);
    writeFileSync(join(folder, 'claude'), '#!/usr/bin/env fake-node\n');
    chmodSync(join(folder, 'claude'), 0o755);
    const finder = lookup({ PATH: '/usr/bin:/bin', HOME: '/home/someone' });
    expect(await claudeVersion(join(folder, 'claude'), finder)).toEqual({ version: '3.0.0' });
    expect(claudePath(join(folder, 'claude'), finder).split(':').slice(0, 3)).toEqual([folder, '/usr/bin', '/bin']);
    expect(claudeEnv(join(folder, 'claude'), lookup({ Path: 'C:\\Windows', HOME: '/h' }, { platform: 'win32', home: 'C:\\Users\\me' }))).toEqual({
      HOME: '/h',
      PATH: [folder, 'C:\\Windows', join('C:\\Users\\me', '.local', 'bin')].join(';'),
    });
  });

  it('notices npm’s claude.cmd on Windows, which it cannot start, and only there', async () => {
    const npm = join(root, 'AppData', 'Roaming', 'npm');
    mkdirSync(npm, { recursive: true });
    writeFileSync(join(npm, 'claude.cmd'), '@node cli.js %*');
    const windows = lookup({ Path: 'C:\\Windows', APPDATA: join(root, 'AppData', 'Roaming') }, { platform: 'win32', home: join(root, 'nobody') });
    expect(await findClaude(windows)).toBeNull();
    expect(await findClaudeShim(windows)).toBe(join(npm, 'claude.cmd'));
    expect(await findClaudeShim(lookup({ PATH: npm }))).toBeNull();
  });
});
