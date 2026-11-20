/** The API on an in-memory database, with a clock and sign-in providers the tests control. */
import { handleApi, type Env } from '../app';
import { sqliteD1 } from '../sqliteD1';

export const ORIGIN = 'http://127.0.0.1:8788';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface SendOptions {
  readonly body?: unknown;
  /** The Cookie header. */
  readonly cookie?: string;
  /** The page the request says it comes from; the site's own unless given, and none for null. */
  readonly origin?: string | null;
  readonly headers?: Readonly<Record<string, string>>;
  /** The address it goes to, when not the test server's. */
  readonly base?: string;
}

export interface Harness {
  readonly env: Env;
  /** Milliseconds; move it to let time pass. */
  now: number;
  /** What answers the server's calls to sign-in providers. */
  provider: Fetch;
  send(method: string, path: string, options?: SendOptions): Promise<Response>;
  /** Signs in on the test provider; returns the session's Cookie header. */
  signIn(id: string, name?: string): Promise<string>;
}

/** The name=value a Set-Cookie header sets, for sending back. */
export function cookieFrom(response: Response, name: string): string | null {
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(';')[0] ?? '';
    if (pair.startsWith(`${name}=`)) return pair;
  }
  return null;
}

export function createHarness(settings: Partial<Omit<Env, 'DB'>> = {}): Harness {
  const env: Env = { DB: sqliteD1(), TEST_SIGN_IN: '1', ...settings };
  const harness: Harness = {
    env,
    now: Date.UTC(2026, 10, 20, 12),
    provider: () => Promise.reject(new Error('no provider in this test')),
    send: (method, path, { body, cookie, origin, headers = {}, base = ORIGIN } = {}) => {
      const sent = new Headers(headers);
      if (cookie) sent.set('Cookie', cookie);
      const from = origin === undefined ? new URL(base).origin : origin;
      if (from !== null) sent.set('Origin', from);
      if (body !== undefined && !sent.has('Content-Type')) sent.set('Content-Type', 'application/json');
      const request = new Request(`${base}${path}`, {
        method,
        headers: sent,
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      });
      return handleApi(request, env, { fetch: (input, init) => harness.provider(input, init), now: () => harness.now });
    },
    signIn: async (id, name = id) => {
      const response = await harness.send('GET', `/api/auth/test?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`);
      const cookie = cookieFrom(response, 'bb_session');
      if (!cookie) throw new Error(`signing in as ${id} gave no session: ${response.status}`);
      return cookie;
    },
  };
  return harness;
}

/** A small JPEG's worth of bytes, in base64url: what the server checks a thumbnail by. */
export const THUMBNAIL = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A save's body. */
export function save(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'Castle', bricks: 12, data: 'q1YqLkksSS1WslJQ0lFQKs8vSgEA', thumbnail: THUMBNAIL, ...overrides };
}
