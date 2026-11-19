/**
 * Builds BrickBench's desktop app (Electron), then runs or packages it.
 *
 *   bun scripts/desktop.ts start [--skip-web]   build, then open the app
 *   bun scripts/desktop.ts build                build only (the desktop tests run the result)
 *   bun scripts/desktop.ts dist [--mac|--win|--linux] [--x64|--arm64|--universal] [--dir]   build everything, then make installers in release/
 *
 * The web app builds into dist/ as usual. The main process and preload
 * script (electron/) are bundled by Bun into .desktop/, the app folder
 * electron-builder packages (see electron-builder.yml) with dist/ inside.
 */
import { $ } from 'bun';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const APP_DIR = join(ROOT, '.desktop');
/** electron-builder flags `dist` passes on: platforms, architectures, and --dir for an unpacked app only (quick to check). */
const BUILDER_FLAGS = new Set(['--mac', '--win', '--linux', '--x64', '--arm64', '--universal', '--dir']);

async function bundle(entry: string, out: string): Promise<void> {
  const result = await Bun.build({ entrypoints: [join(ROOT, entry)], target: 'node', format: 'cjs', external: ['electron'] });
  const [output] = result.outputs;
  if (!result.success || !output) throw new AggregateError(result.logs, `Could not bundle ${entry}.`);
  writeFileSync(join(APP_DIR, out), await output.text());
}

/** The Electron app folder: the bundled main process and preload, and a package.json naming the app. */
async function buildDesktop(): Promise<void> {
  mkdirSync(APP_DIR, { recursive: true });
  await bundle('electron/main.ts', 'main.cjs');
  await bundle('electron/preload.ts', 'preload.cjs');
  const own = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { readonly version: string; readonly description: string; readonly license: string };
  // a name of its own: electron-builder looks the app's dependencies up by name, and must not take
  // the web project's (bundled already) for them
  const app = { name: 'brickbench-desktop', productName: 'BrickBench', version: own.version, description: own.description, license: own.license, author: 'BrickBench', main: 'main.cjs' };
  writeFileSync(join(APP_DIR, 'package.json'), `${JSON.stringify(app, null, 2)}\n`);
}

async function start(skipWeb: boolean): Promise<number> {
  if (!skipWeb) await $`bunx --bun vite build`.cwd(ROOT);
  await buildDesktop();
  // the electron package's default export is the path to its binary, downloaded on first use
  const { default: electron } = (await import('electron')) as unknown as { readonly default: string };
  const child = Bun.spawn([electron, APP_DIR], { cwd: ROOT, stdio: ['inherit', 'inherit', 'inherit'], env: { ...process.env, BRICKBENCH_WEB_ROOT: join(ROOT, 'dist') } });
  return child.exited;
}

async function dist(platforms: readonly string[]): Promise<number> {
  // type checks, builds the parts library if it is missing, and builds the web app
  await $`bun run build`.cwd(ROOT);
  await buildDesktop();
  await $`bunx --bun electron-builder --config electron-builder.yml --publish never ${platforms}`.cwd(ROOT);
  return 0;
}

async function main([command, ...flags]: readonly string[]): Promise<number> {
  if (command === 'start') return start(flags.includes('--skip-web'));
  if (command === 'build') {
    await $`bunx --bun vite build`.cwd(ROOT);
    await buildDesktop();
    return 0;
  }
  if (command === 'dist') return dist(flags.filter((flag) => BUILDER_FLAGS.has(flag)));
  console.error('Usage: bun scripts/desktop.ts start [--skip-web] | build | dist [--mac|--win|--linux] [--x64|--arm64|--universal] [--dir]');
  return 1;
}

process.exit(await main(process.argv.slice(2)));
