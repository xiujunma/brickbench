import { describe, expect, it } from 'bun:test';
import { digest } from './ids';
import { cookieFrom, createHarness, type Harness } from './testing/harness';

const GITHUB = { GITHUB_CLIENT_ID: 'gh-client', GITHUB_CLIENT_SECRET: 'gh-secret' };
const GOOGLE = { GOOGLE_CLIENT_ID: 'g-client', GOOGLE_CLIENT_SECRET: 'g-secret' };

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** A provider that hands out a token for code "good" and says who it belongs to. */
function provider(api: Harness, profile: unknown, token: unknown = { access_token: 'provider-token' }): Call[] {
  const calls: Call[] = [];
  api.provider = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('token')) return Response.json(token);
    return Response.json(profile);
  };
  return calls;
}

/** Starts signing in, as the site's button does; returns where the provider is asked, and the cookie that remembers it. */
async function start(api: Harness, which: string): Promise<{ readonly at: URL; readonly cookie: string }> {
  const response = await api.send('GET', `/api/auth/${which}`);
  expect(response.status).toBe(302);
  const cookie = cookieFrom(response, 'bb_sign_in');
  if (!cookie) throw new Error('no sign-in cookie');
  return { at: new URL(response.headers.get('Location') ?? ''), cookie };
}

async function finish(api: Harness, which: string, params: string, cookie: string): Promise<Response> {
  return api.send('GET', `/api/auth/${which}/callback?${params}`, { cookie });
}

async function sessionOf(api: Harness, response: Response): Promise<{ user: { id: string; name: string } | null }> {
  const cookie = cookieFrom(response, 'bb_session') ?? '';
  return (await api.send('GET', '/api/session', { cookie })).json();
}

describe('the ways in', () => {
  it('are the providers the site has credentials for, and test sign-in on this computer', async () => {
    expect(await (await createHarness().send('GET', '/api/session')).json()).toEqual({ user: null, providers: ['test'] });
    const all = createHarness({ ...GITHUB, ...GOOGLE });
    expect((await (await all.send('GET', '/api/session')).json()).providers).toEqual(['github', 'google', 'test']);
    const hosted = createHarness({ ...GITHUB });
    expect((await (await hosted.send('GET', '/api/session', { base: 'https://brickbench.app' })).json()).providers).toEqual(['github']);
  });

  it('never let anyone in under a made-up name on a hosted site, nor where test sign-in is off', async () => {
    const hosted = createHarness();
    expect((await hosted.send('GET', '/api/auth/test?id=ada', { base: 'https://brickbench.app' })).status).toBe(404);
    const off = createHarness({ TEST_SIGN_IN: undefined });
    expect((await off.send('GET', '/api/auth/test?id=ada')).status).toBe(404);
    expect((await createHarness().send('GET', '/api/auth/test?id=no%20spaces')).status).toBe(400);
  });

  it('say so when a provider is not set up', async () => {
    const response = await createHarness().send('GET', '/api/auth/google');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Signing in with Google is not set up on this site.' });
  });
});

describe('signing in with GitHub', () => {
  it('asks GitHub for the public profile, with a state and a PKCE challenge, then signs in', async () => {
    const api = createHarness(GITHUB);
    const calls = provider(api, { id: 583231, login: 'octocat', name: 'The Octocat' });
    const { at, cookie } = await start(api, 'github');
    expect(at.origin + at.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(at.searchParams.get('client_id')).toBe('gh-client');
    expect(at.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8788/api/auth/github/callback');
    expect(at.searchParams.has('scope')).toBe(false);
    expect(at.searchParams.get('code_challenge_method')).toBe('S256');
    const [, state, verifier] = cookie.split('=')[1]?.split('.') ?? [];
    expect(at.searchParams.get('state')).toBe(state ?? '');
    expect(at.searchParams.get('code_challenge')).toBe(await digest(verifier ?? ''));

    const response = await finish(api, 'github', `code=good&state=${state}`, cookie);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/#signed-in');
    // the sign-in cookie is cleared, the session's set
    expect(response.headers.getSetCookie().find((c) => c.startsWith('bb_sign_in='))).toContain('Max-Age=0');
    expect((await sessionOf(api, response)).user?.name).toBe('The Octocat');

    const exchange = new URLSearchParams(String(calls[0]?.init?.body));
    expect(calls[0]?.url).toBe('https://github.com/login/oauth/access_token');
    expect(Object.fromEntries(exchange)).toEqual({
      client_id: 'gh-client',
      client_secret: 'gh-secret',
      code: 'good',
      code_verifier: verifier ?? '',
      grant_type: 'authorization_code',
      redirect_uri: 'http://127.0.0.1:8788/api/auth/github/callback',
    });
    expect(calls[1]?.url).toBe('https://api.github.com/user');
    expect(new Headers(calls[1]?.init?.headers).get('Authorization')).toBe('Bearer provider-token');
  });

  it('names the account after the login when the profile has no name, and finds the same account next time', async () => {
    const api = createHarness(GITHUB);
    provider(api, { id: 7, login: 'brickfan', name: null });
    const first = await start(api, 'github');
    const one = await sessionOf(api, await finish(api, 'github', `code=good&state=${first.at.searchParams.get('state')}`, first.cookie));
    const second = await start(api, 'github');
    const two = await sessionOf(api, await finish(api, 'github', `code=good&state=${second.at.searchParams.get('state')}`, second.cookie));
    expect(one.user?.name).toBe('brickfan');
    expect(two.user?.id).toBe(one.user?.id ?? '');
  });

  it('signs no one in when the state does not match, the sign-in cookie is missing or another provider started it', async () => {
    const api = createHarness({ ...GITHUB, ...GOOGLE });
    provider(api, { id: 1, login: 'mallory' });
    const { at, cookie } = await start(api, 'github');
    const state = at.searchParams.get('state');
    for (const [which, params, sent] of [
      ['github', 'code=good&state=forged', cookie],
      ['github', `code=good&state=${state}`, ''],
      ['github', `state=${state}`, cookie],
      ['google', `code=good&state=${state}`, cookie],
    ] as const) {
      const response = await finish(api, which, params, sent);
      expect(response.headers.get('Location')).toBe('/#sign-in=failed');
      expect(cookieFrom(response, 'bb_session')).toBeNull();
    }
  });

  it('goes back to the site saying so when the person says no, or GitHub turns the code down', async () => {
    const api = createHarness(GITHUB);
    const { at, cookie } = await start(api, 'github');
    expect((await finish(api, 'github', 'error=access_denied', cookie)).headers.get('Location')).toBe('/#sign-in=cancelled');
    // GitHub answers a bad code with 200 and an error
    provider(api, {}, { error: 'bad_verification_code' });
    const log = console.error;
    console.error = () => {};
    try {
      const response = await finish(api, 'github', `code=stale&state=${at.searchParams.get('state')}`, cookie);
      expect(response.headers.get('Location')).toBe('/#sign-in=failed');
    } finally {
      console.error = log;
    }
  });

  it('limits how many sign-ins one visitor may start', async () => {
    const api = createHarness(GITHUB);
    for (let i = 0; i < 20; i++) expect((await api.send('GET', '/api/auth/github')).status).toBe(302);
    const refused = await api.send('GET', '/api/auth/github');
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0);
    api.now += 10 * 60_000;
    expect((await api.send('GET', '/api/auth/github')).status).toBe(302);
  });
});

describe('signing in with Google', () => {
  it('asks for an id and a name only, letting the person choose an account', async () => {
    const api = createHarness(GOOGLE);
    const calls = provider(api, { sub: '1098', given_name: 'Grace' });
    const { at, cookie } = await start(api, 'google');
    expect(at.origin + at.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(at.searchParams.get('scope')).toBe('openid profile');
    expect(at.searchParams.get('prompt')).toBe('select_account');
    const response = await finish(api, 'google', `code=good&state=${at.searchParams.get('state')}`, cookie);
    expect((await sessionOf(api, response)).user?.name).toBe('Grace');
    expect(calls.map((call) => call.url)).toEqual(['https://oauth2.googleapis.com/token', 'https://openidconnect.googleapis.com/v1/userinfo']);
  });

  it('turns down a profile without an id', async () => {
    const api = createHarness(GOOGLE);
    provider(api, { name: 'No One' });
    const { at, cookie } = await start(api, 'google');
    const log = console.error;
    console.error = () => {};
    try {
      expect((await finish(api, 'google', `code=good&state=${at.searchParams.get('state')}`, cookie)).headers.get('Location')).toBe('/#sign-in=failed');
    } finally {
      console.error = log;
    }
  });
});

describe('cookies', () => {
  it('are Secure on a hosted site even over plain HTTP, which also hears to come back over HTTPS', async () => {
    const api = createHarness();
    const ended = await api.send('POST', '/api/auth/sign-out', { base: 'http://brickbench.app' });
    expect(ended.headers.get('Set-Cookie')).toBe('__Host-bb_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure');
    expect(ended.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
  });

  it('are Secure and prefixed when the site is served over HTTPS', async () => {
    const api = createHarness({ ...GITHUB, TEST_SIGN_IN: undefined });
    const response = await api.send('GET', '/api/auth/github', { base: 'https://brickbench.app' });
    const [state] = response.headers.getSetCookie();
    expect(state).toStartWith('__Secure-bb_sign_in=');
    expect(state).toContain('Path=/api/auth');
    expect(state).toContain('HttpOnly; SameSite=Lax; Secure');
    const ended = await api.send('POST', '/api/auth/sign-out', { base: 'https://brickbench.app' });
    expect(ended.headers.get('Set-Cookie')).toBe('__Host-bb_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure');
  });
});
