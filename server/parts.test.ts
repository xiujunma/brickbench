import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { cookiesOf, HttpError, readJson } from './http';
import { fromBase64Url, newId, sameSecret, toBase64Url } from './ids';
import { ensureSchema } from './db';
import { LIMITS, spend } from './limits';
import { sqliteD1 } from './sqliteD1';

describe('ids', () => {
  it('are 16 unmistakable letters and digits, different every time', () => {
    const ids = new Set(Array.from({ length: 1000 }, newId));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[0-9a-hjkmnp-tv-z]{16}$/);
  });

  it('travel in base64url and back', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    expect(fromBase64Url('a+b')).toBeNull();
    expect(fromBase64Url('abcde')).toBeNull();
  });

  it('compare secrets whole', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abc', 'abd')).toBe(false);
    expect(sameSecret('abc', 'abcd')).toBe(false);
  });
});

describe('requests', () => {
  it('give their cookies by name', () => {
    const request = new Request('http://127.0.0.1/', { headers: { Cookie: 'a=1; bb_session=x=y; broken; =z' } });
    expect([...cookiesOf(request)]).toEqual([
      ['a', '1'],
      ['bb_session', 'x=y'],
    ]);
  });

  it('give a JSON body only when it is JSON, small enough and the right shape', async () => {
    const schema = z.object({ n: z.number() });
    const post = (body: string, type = 'application/json') => new Request('http://127.0.0.1/', { method: 'POST', body, headers: { 'Content-Type': type } });
    expect(await readJson(post('{"n":1}'), schema, 100)).toEqual({ n: 1 });
    const status = (promise: Promise<unknown>) =>
      promise.then(
        () => 200,
        (error: unknown) => (error instanceof HttpError ? error.status : 0),
      );
    expect(await status(readJson(post('{"n":1}', 'text/plain'), schema, 100))).toBe(415);
    expect(await status(readJson(post('{"n":'), schema, 100))).toBe(400);
    expect(await status(readJson(post('{"n":"1"}'), schema, 100))).toBe(400);
    expect(await status(readJson(post(`{"n":1,"pad":"${'x'.repeat(200)}"}`), schema, 100))).toBe(413);
  });
});

describe('the SQLite stand-in for D1', () => {
  it('turns down values D1 cannot take', () => {
    const db = sqliteD1();
    const statement = db.prepare('SELECT ?');
    expect(() => statement.bind(undefined as unknown as null)).toThrow(TypeError);
    expect(() => statement.bind(true as unknown as number)).toThrow(TypeError);
  });

  it('runs a batch as one transaction', async () => {
    const db = sqliteD1();
    await db.prepare('CREATE TABLE t (n INTEGER PRIMARY KEY)').run();
    const insert = (n: number) => db.prepare('INSERT INTO t (n) VALUES (?)').bind(n);
    await expect(db.batch([insert(1), insert(1)])).rejects.toThrow();
    expect((await db.prepare('SELECT COUNT(*) AS n FROM t').first())?.['n']).toBe(0);
    const [first, second] = await db.batch([insert(1), db.prepare('SELECT n FROM t')]);
    expect(first?.meta.changes).toBe(1);
    expect(second?.results).toEqual([{ n: 1 }]);
    expect(await db.prepare('SELECT n FROM t WHERE n = ?').bind(5).first()).toBeNull();
    expect((await db.prepare('SELECT n FROM t').all()).results).toEqual([{ n: 1 }]);
  });
});

describe('limits', () => {
  it('keep who they count only as a hash, and clear out old counts now and then', async () => {
    const db = sqliteD1();
    await ensureSchema(db);
    const now = Date.UTC(2026, 10, 20);
    await spend(db, LIMITS.signIn, '203.0.113.7', now - 2 * 86_400_000, 1);
    await spend(db, LIMITS.signIn, '198.51.100.1', now, 1);
    const keys = (await db.prepare('SELECT key FROM limits').all<{ key: string }>()).results.map((row) => row.key);
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).toMatch(/^sign-in:[A-Za-z0-9_-]{43}$/);
      expect(key).not.toContain('203.0.113.7');
    }
    // a count that also sweeps: the two-day-old one goes
    await spend(db, LIMITS.signIn, '198.51.100.1', now, 0);
    expect((await db.prepare('SELECT key FROM limits').all()).results).toHaveLength(1);
  });
});
