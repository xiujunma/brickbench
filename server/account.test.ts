import { describe, expect, it } from 'bun:test';
import { cookieFrom, createHarness, save } from './testing/harness';

const DAY = 86_400_000;

describe('an account', () => {
  it('says who is signed in, and whether they moderate', async () => {
    const api = createHarness({ ADMINS: 'github:1, test:mod' });
    const user = await (await api.send('GET', '/api/session', { cookie: await api.signIn('ada', 'Ada') })).json();
    expect(user).toEqual({ user: { id: expect.stringMatching(/^[0-9a-z]{16}$/), name: 'Ada', admin: false, banned: false }, providers: ['test'] });
    const mod = await (await api.send('GET', '/api/session', { cookie: await api.signIn('mod') })).json();
    expect(mod.user.admin).toBe(true);
  });

  it('signs out, and the session no longer works', async () => {
    const api = createHarness();
    const cookie = await api.signIn('ada');
    const response = await api.send('POST', '/api/auth/sign-out', { cookie });
    expect(response.status).toBe(204);
    expect(response.headers.get('Set-Cookie')).toContain('bb_session=; Path=/; Max-Age=0');
    expect((await (await api.send('GET', '/api/session', { cookie })).json()).user).toBeNull();
  });

  it('ends the session it had when the browser signs in again', async () => {
    const api = createHarness();
    const first = await api.signIn('ada');
    const response = await api.send('GET', '/api/auth/test?id=grace', { cookie: first });
    expect(cookieFrom(response, 'bb_session')).not.toBe(first);
    expect((await (await api.send('GET', '/api/session', { cookie: first })).json()).user).toBeNull();
  });

  it('takes a new name, cleaned up', async () => {
    const api = createHarness();
    const cookie = await api.signIn('ada');
    const renamed = await api.send('PATCH', '/api/account', { cookie, body: { name: '  Ada\u202e  Lovelace\u0007 of the very long names indeed ' } });
    expect((await renamed.json()).user.name).toBe('Ada Lovelace of the very long names inde');
    expect((await (await api.send('GET', '/api/session', { cookie })).json()).user.name).toBe('Ada Lovelace of the very long names inde');
    expect((await api.send('PATCH', '/api/account', { cookie, body: { name: ' \u0000 ' } })).status).toBe(400);
    expect((await api.send('PATCH', '/api/account', { body: { name: 'Nobody' } })).status).toBe(401);
  });

  it('is deleted with its models and sessions', async () => {
    const api = createHarness();
    const cookie = await api.signIn('ada');
    const { model } = await (await api.send('POST', '/api/models', { cookie, body: save() })).json();
    await api.send('PATCH', `/api/models/${model.id}`, { cookie, body: { published: true } });
    expect((await api.send('DELETE', '/api/account', { cookie })).status).toBe(204);
    expect((await (await api.send('GET', '/api/session', { cookie })).json()).user).toBeNull();
    expect((await api.send('GET', `/api/models/${model.id}`)).status).toBe(404);
    expect((await (await api.send('GET', '/api/gallery')).json()).models).toEqual([]);
    // signing in again starts afresh
    const again = await api.signIn('ada');
    expect((await (await api.send('GET', '/api/models', { cookie: again })).json()).models).toEqual([]);
  });
});

describe('a stopped account', () => {
  it('stays stopped when it deletes itself and signs in again, its models gone', async () => {
    const api = createHarness({ ADMINS: 'test:mod' });
    const ada = await api.signIn('ada', 'Ada');
    const { model } = await (await api.send('POST', '/api/models', { cookie: ada, body: save() })).json();
    const { user } = await (await api.send('GET', '/api/session', { cookie: ada })).json();
    const mod = await api.signIn('mod');
    await api.send('POST', `/api/admin/users/${user.id}`, { cookie: mod, body: { banned: true } });
    expect((await api.send('DELETE', '/api/account', { cookie: ada })).status).toBe(204);
    expect((await (await api.send('GET', '/api/session', { cookie: ada })).json()).user).toBeNull();
    expect((await api.send('GET', `/api/models/${model.id}`, { cookie: mod })).status).toBe(404);

    const again = await api.signIn('ada', 'Ada');
    const back = (await (await api.send('GET', '/api/session', { cookie: again })).json()).user;
    expect(back).toMatchObject({ id: user.id, name: 'Deleted account', banned: true });
    expect((await api.send('POST', '/api/models', { cookie: again, body: save() })).status).toBe(403);
    // a moderator can still let it back in
    expect((await (await api.send('GET', '/api/admin/users', { cookie: mod })).json()).users).toEqual([{ id: user.id, name: 'Deleted account' }]);
  });
});

describe('a session', () => {
  it('runs out after 30 days unused', async () => {
    const api = createHarness();
    const cookie = await api.signIn('ada');
    api.now += 30 * DAY;
    expect((await (await api.send('GET', '/api/session', { cookie })).json()).user).toBeNull();
  });

  it('is renewed when used in its last 15 days, keeping the same secret', async () => {
    const api = createHarness();
    const cookie = await api.signIn('ada');
    api.now += 10 * DAY;
    expect((await api.send('GET', '/api/session', { cookie })).headers.getSetCookie()).toEqual([]);
    api.now += 10 * DAY;
    const renewed = await api.send('GET', '/api/session', { cookie });
    expect(cookieFrom(renewed, 'bb_session')).toBe(cookie);
    expect(renewed.headers.get('Set-Cookie')).toContain('Max-Age=2592000');
    api.now += 25 * DAY;
    expect((await (await api.send('GET', '/api/session', { cookie })).json()).user?.name).toBe('ada');
  });

  it('means nothing without its secret', async () => {
    const api = createHarness();
    await api.signIn('ada');
    expect((await (await api.send('GET', '/api/session', { cookie: 'bb_session=guessed' })).json()).user).toBeNull();
  });
});
