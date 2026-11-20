/** What a request handler works with: the request, the site's settings, the database and who is signed in. */
import type { D1Database } from './db';
import { HttpError } from './http';
import { sessionAccount, type Account } from './sessions';

/** The site's settings: Cloudflare Pages bindings, variables and secrets (README › Accounts and the gallery). */
export interface Env {
  readonly DB: D1Database;
  readonly GITHUB_CLIENT_ID?: string;
  readonly GITHUB_CLIENT_SECRET?: string;
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  /** Moderators, as provider:id pairs separated by commas: "github:1234567,google:1098…". */
  readonly ADMINS?: string;
  /** "1" lets anyone sign in under a made-up name; honoured only when the site is served from this computer. */
  readonly TEST_SIGN_IN?: string;
}

/** What the server reaches outside itself through, so tests can stand in for it. */
export interface Deps {
  /** Sign-in providers are asked through this. */
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
  readonly now: () => number;
}

export interface Context {
  readonly request: Request;
  readonly url: URL;
  readonly env: Env;
  readonly db: D1Database;
  readonly deps: Deps;
  /** The moment the request came in, in milliseconds. */
  readonly now: number;
  /** Who sent it, for limits on what one visitor may do: their address on Cloudflare. */
  readonly visitor: string;
  /** Cookies to send with the response, such as a session's renewal. */
  readonly cookies: string[];
  /** Who is signed in; null when no one is. Looked up once per request. */
  account(): Promise<Account | null>;
}

export function createContext(request: Request, env: Env, deps: Deps): Context {
  let account: Promise<Account | null> | null = null;
  const context: Context = {
    request,
    url: new URL(request.url),
    env,
    db: env.DB,
    deps,
    now: deps.now(),
    visitor: request.headers.get('CF-Connecting-IP') ?? 'local',
    cookies: [],
    account: () => {
      account ??= sessionAccount(env.DB, request, context.now).then((found) => {
        if (found?.renewal) context.cookies.push(found.renewal);
        return found?.account ?? null;
      });
      return account;
    },
  };
  return context;
}

/** The account a request comes from; 401 when no one is signed in. */
export async function signedIn(context: Context): Promise<Account> {
  const account = await context.account();
  if (!account) throw new HttpError(401, 'Sign in first.');
  return account;
}

/** Signed in, and not stopped by a moderator: allowed to save, publish and report. */
export async function activeAccount(context: Context): Promise<Account> {
  const account = await signedIn(context);
  if (account.banned) throw new HttpError(403, 'A moderator has stopped this account saving, publishing and reporting models.');
  return account;
}

export function isAdmin(env: Env, account: Account): boolean {
  const admins = (env.ADMINS ?? '').split(',').map((entry) => entry.trim());
  return admins.includes(`${account.provider}:${account.subject}`);
}

export async function adminAccount(context: Context): Promise<Account> {
  const account = await signedIn(context);
  if (!isAdmin(context.env, account)) throw new HttpError(403, 'Only moderators can do that.');
  return account;
}
