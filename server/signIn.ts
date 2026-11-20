/**
 * Signing in with GitHub or Google (OAuth 2.0's authorization code flow,
 * with PKCE), and under a made-up name on a test server. The site asks only
 * for a person's id and name: no email address, no access to anything else.
 * The provider's token is used once, to read those, and never kept.
 */
import { z } from 'zod';
import { cleanName, MAX_DISPLAY_NAME, type Provider } from '../src/core/cloud/protocol';
import type { Context, Env } from './context';
import type { D1Database } from './db';
import { cookie, cookiesOf, HttpError, isLoopback, isSecure, redirect } from './http';
import { digest, newId, newSecret, sameSecret } from './ids';
import { LIMITS, spend, sweepLimits } from './limits';
import { endSession, startSession, sweepSessions } from './sessions';

/** How long a sign-in at the provider may take. */
const SIGN_IN_SECONDS = 600;
const SIGNED_IN = '/#signed-in';
const FAILED = '/#sign-in=failed';
const CANCELLED = '/#sign-in=cancelled';
const FALLBACK_NAME = 'Builder';

interface Profile {
  readonly subject: string;
  readonly name: string;
}

interface OAuthProvider {
  readonly id: Exclude<Provider, 'test'>;
  readonly label: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly scope: string;
  readonly extraParams: Readonly<Record<string, string>>;
  readonly credentials: (env: Env) => { readonly id: string; readonly secret: string } | null;
  readonly profile: (fetch: Context['deps']['fetch'], token: string) => Promise<Profile>;
}

function credentials(id: string | undefined, secret: string | undefined): { readonly id: string; readonly secret: string } | null {
  return id && secret ? { id, secret } : null;
}

const githubUser = z.object({ id: z.number().int(), login: z.string(), name: z.string().nullish() });
const googleUser = z.object({ sub: z.string().min(1), name: z.string().nullish(), given_name: z.string().nullish() });
const tokenResponse = z.object({ access_token: z.string().min(1) });

async function readProfile<S extends z.ZodType>(response: Response, schema: S, provider: string): Promise<z.output<S>> {
  if (!response.ok) throw new Error(`${provider} said ${response.status} to the profile request`);
  return schema.parse(await response.json());
}

const PROVIDERS: Readonly<Record<OAuthProvider['id'], OAuthProvider>> = {
  github: {
    id: 'github',
    label: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    // no scope: a public profile, read-only
    scope: '',
    extraParams: {},
    credentials: (env) => credentials(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
    profile: async (fetch, token) => {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'BrickBench',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      const user = await readProfile(response, githubUser, 'GitHub');
      return { subject: String(user.id), name: user.name || user.login };
    },
  },
  google: {
    id: 'google',
    label: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    // a name and an id, and not the email address
    scope: 'openid profile',
    extraParams: { prompt: 'select_account' },
    credentials: (env) => credentials(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
    profile: async (fetch, token) => {
      const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token}` } });
      const user = await readProfile(response, googleUser, 'Google');
      return { subject: user.sub, name: user.name || user.given_name || '' };
    },
  },
};

/** Test sign-in only where no one else can reach it: a server on this computer, with it switched on. */
export function testSignInAllowed(env: Env, request: Request): boolean {
  return env.TEST_SIGN_IN === '1' && isLoopback(request);
}

/** The ways in this site offers: the providers it has credentials for, and test sign-in where allowed. */
export function availableProviders(env: Env, request: Request): Provider[] {
  const providers: Provider[] = Object.values(PROVIDERS)
    .filter((provider) => provider.credentials(env) !== null)
    .map((provider) => provider.id);
  if (testSignInAllowed(env, request)) providers.push('test');
  return providers;
}

/** Remembers a sign-in in progress, for the provider's callback only. */
function stateCookieName(request: Request): string {
  return isSecure(request) ? '__Secure-bb_sign_in' : 'bb_sign_in';
}

function stateCookie(request: Request, value: string, maxAge: number): string {
  return cookie(request, stateCookieName(request), value, { maxAge, path: '/api/auth' });
}

function callbackUrl(context: Context, provider: OAuthProvider): string {
  return `${context.url.origin}/api/auth/${provider.id}/callback`;
}

function providerOf(id: string): OAuthProvider {
  const provider = PROVIDERS[id as OAuthProvider['id']];
  if (!provider) throw new HttpError(404, 'There is nothing here.');
  return provider;
}

/** GET /api/auth/:provider — off to the provider, to sign in there. */
export async function startSignIn(context: Context, providerId: string): Promise<Response> {
  const provider = providerOf(providerId);
  const client = provider.credentials(context.env);
  if (!client) throw new HttpError(404, `Signing in with ${provider.label} is not set up on this site.`);
  await spend(context.db, LIMITS.signIn, context.visitor, context.now);
  const state = newSecret();
  const verifier = newSecret();
  const params = new URLSearchParams({
    client_id: client.id,
    redirect_uri: callbackUrl(context, provider),
    response_type: 'code',
    state,
    code_challenge: await digest(verifier),
    code_challenge_method: 'S256',
    ...provider.extraParams,
  });
  if (provider.scope) params.set('scope', provider.scope);
  return redirect(`${provider.authorizeUrl}?${params}`, [stateCookie(context.request, `${provider.id}.${state}.${verifier}`, SIGN_IN_SECONDS)]);
}

/** The account for a person a provider vouches for, made the first time they sign in. */
export async function accountFor(db: D1Database, provider: Provider, subject: string, name: string, now: number): Promise<string> {
  await db
    .prepare('INSERT INTO users (id, provider, subject, name, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (provider, subject) DO NOTHING')
    .bind(newId(), provider, subject, cleanName(name, MAX_DISPLAY_NAME) || FALLBACK_NAME, now)
    .run();
  const row = await db.prepare('SELECT id FROM users WHERE provider = ? AND subject = ?').bind(provider, subject).first<{ id: string }>();
  if (!row) throw new Error('the account just made is missing');
  return row.id;
}

/** Signs the browser in to an account, ending any session it had; back to the site. */
async function signInAs(context: Context, accountId: string, cookies: readonly string[]): Promise<Response> {
  await endSession(context.db, context.request);
  const session = await startSession(context.db, context.request, accountId, context.now);
  // a good moment to clear out what has run out
  await sweepSessions(context.db, context.now);
  await sweepLimits(context.db, context.now);
  return redirect(SIGNED_IN, [...cookies, session]);
}

async function exchangeCode(context: Context, provider: OAuthProvider, code: string, verifier: string): Promise<string> {
  const client = provider.credentials(context.env);
  if (!client) throw new Error(`${provider.label} sign-in is not set up`);
  const response = await context.deps.fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.id,
      client_secret: client.secret,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl(context, provider),
    }).toString(),
  });
  // GitHub answers 200 with an error in the body when the code is no good
  const body: unknown = await response.json().catch(() => null);
  const token = tokenResponse.safeParse(body);
  if (!response.ok || !token.success) throw new Error(`${provider.label} did not give a token (${response.status})`);
  return token.data.access_token;
}

/** GET /api/auth/:provider/callback — back from the provider: check it is the sign-in this browser started, and sign in. */
export async function finishSignIn(context: Context, providerId: string): Promise<Response> {
  const provider = providerOf(providerId);
  const params = context.url.searchParams;
  const clear = stateCookie(context.request, '', 0);
  if (params.get('error') === 'access_denied') return redirect(CANCELLED, [clear]);
  const [startedWith, state, verifier] = (cookiesOf(context.request).get(stateCookieName(context.request)) ?? '').split('.');
  const code = params.get('code');
  if (startedWith !== provider.id || !state || !verifier || !code || !sameSecret(state, params.get('state') ?? '')) {
    return redirect(FAILED, [clear]);
  }
  let profile: Profile;
  try {
    profile = await provider.profile(context.deps.fetch, await exchangeCode(context, provider, code, verifier));
  } catch (error: unknown) {
    console.error(`Signing in with ${provider.label} failed:`, error instanceof Error ? error.message : error);
    return redirect(FAILED, [clear]);
  }
  return signInAs(context, await accountFor(context.db, provider.id, profile.subject, profile.name, context.now), [clear]);
}

/** GET /api/auth/test?id=…&name=… — on a test server, signs in as anyone, made up on the spot. */
export async function testSignIn(context: Context): Promise<Response> {
  if (!testSignInAllowed(context.env, context.request)) throw new HttpError(404, 'There is nothing here.');
  const params = context.url.searchParams;
  const name = cleanName(params.get('name') ?? '', MAX_DISPLAY_NAME) || 'Tester';
  const subject = params.get('id') ?? name;
  if (!/^[\w.-]{1,64}$/.test(subject)) throw new HttpError(400, 'A test id is letters, digits, dots, dashes and underscores.');
  return signInAs(context, await accountFor(context.db, 'test', subject, name, context.now), []);
}
