import { describe, expect, it } from 'bun:test';
import { DEFAULT_DEPS, handleApi, type Env } from './app';
import type { D1Database } from './db';
import { SCHEMA_VERSION } from './db';
import { sqliteD1 } from './sqliteD1';
import { createHarness, ORIGIN } from './testing/harness';

describe('the API', () => {
  it('answers paths it does not know with 404, and methods it does not take with 405', async () => {
    const api = createHarness();
    const missing = await api.send('GET', '/api/nothing');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'There is nothing here.' });
    const wrong = await api.send('DELETE', '/api/gallery');
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('Allow')).toBe('GET');
  });

  it('turns down changes that do not come from the site’s own pages', async () => {
    const api = createHarness();
    const cookie = await api.signIn('ada');
    for (const origin of [null, 'https://elsewhere.example']) {
      const response = await api.send('POST', '/api/auth/sign-out', { cookie, origin });
      expect(response.status).toBe(403);
    }
    // still signed in
    expect((await (await api.send('GET', '/api/session', { cookie })).json()).user?.name).toBe('ada');
  });

  it('sends headers that keep its answers from being run, framed or kept', async () => {
    const response = await createHarness().send('GET', '/api/session');
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
  });

  it('makes its tables on the first request, once', async () => {
    const db = sqliteD1();
    const env = { DB: db };
    await handleApi(new Request(`${ORIGIN}/api/session`), env);
    await handleApi(new Request(`${ORIGIN}/api/session`), env);
    expect(await db.prepare(`SELECT value FROM meta WHERE key = 'schema'`).first()).toEqual({ value: String(SCHEMA_VERSION) });
  });

  it('says something went wrong without the details, and tries the database again next time', async () => {
    const real = sqliteD1();
    let broken = true;
    const db: D1Database = {
      prepare: (sql) => {
        if (broken && sql.startsWith('CREATE')) throw new Error('database unavailable');
        return real.prepare(sql);
      },
      batch: (statements) => real.batch(statements),
    };
    const errors: unknown[] = [];
    const log = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const failed = await handleApi(new Request(`${ORIGIN}/api/session`), { DB: db });
      expect(failed.status).toBe(500);
      expect(await failed.json()).toEqual({ error: 'Something went wrong on the site. Try again in a moment.' });
      expect(errors).toHaveLength(1);
    } finally {
      console.error = log;
    }
    broken = false;
    expect((await handleApi(new Request(`${ORIGIN}/api/session`), { DB: db })).status).toBe(200);
  });

  it('reaches providers through fetch, and tells the time by the clock, unless a test stands in', async () => {
    expect(await (await DEFAULT_DEPS.fetch('data:text/plain,hello')).text()).toBe('hello');
    expect(Math.abs(DEFAULT_DEPS.now() - Date.now())).toBeLessThan(1000);
  });

  it('says accounts are not set up when the site has no database', async () => {
    const response = await handleApi(new Request(`${ORIGIN}/api/session`), {} as Env);
    expect(response.status).toBe(503);
  });
});
