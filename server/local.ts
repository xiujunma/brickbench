#!/usr/bin/env bun
/**
 * `bun run api`: the accounts and gallery API on this computer, on SQLite,
 * for working on the site and for the browser tests. Vite passes the
 * site's /api requests here (vite.config.ts).
 *
 * Settings: BRICKBENCH_API_PORT (default 8788), BRICKBENCH_API_DB (the
 * database file, default .data/brickbench.sqlite; ":memory:" keeps nothing),
 * BRICKBENCH_ADMINS (moderators, default test:admin), and to try real
 * sign-in, GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, GOOGLE_CLIENT_ID and
 * GOOGLE_CLIENT_SECRET. Test sign-in is on: anyone may sign in under any
 * name, which is fine on 127.0.0.1 and why the hosted site never allows it.
 */
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { handleApi, type Env } from './app';
import { sqliteD1 } from './sqliteD1';

const DEFAULT_PORT = 8788;
const DEFAULT_DB = '.data/brickbench.sqlite';

function main(): void {
  const settings = process.env;
  const port = Number(settings['BRICKBENCH_API_PORT'] ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error(`BRICKBENCH_API_PORT is not a port: ${settings['BRICKBENCH_API_PORT']}`);
  const file = settings['BRICKBENCH_API_DB'] ?? DEFAULT_DB;
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const database = new Database(file, { create: true });
  if (file !== ':memory:') database.exec('PRAGMA journal_mode = WAL');
  const env: Env = {
    DB: sqliteD1(database),
    TEST_SIGN_IN: '1',
    ADMINS: settings['BRICKBENCH_ADMINS'] ?? 'test:admin',
    GITHUB_CLIENT_ID: settings['GITHUB_CLIENT_ID'],
    GITHUB_CLIENT_SECRET: settings['GITHUB_CLIENT_SECRET'],
    GOOGLE_CLIENT_ID: settings['GOOGLE_CLIENT_ID'],
    GOOGLE_CLIENT_SECRET: settings['GOOGLE_CLIENT_SECRET'],
  };
  Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch: (request) => {
      const path = new URL(request.url).pathname;
      if (path === '/health') return new Response('ok');
      if (path !== '/api' && !path.startsWith('/api/')) return new Response('Not found', { status: 404 });
      return handleApi(request, env);
    },
  });
  process.stdout.write(`BrickBench API on http://127.0.0.1:${port}/api, keeping ${file === ':memory:' ? 'nothing' : file}\n`);
}

main();
