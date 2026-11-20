/**
 * Sessions: a signed-in browser holds a random secret in a cookie that
 * scripts cannot read; the database keeps only its SHA-256, with the account
 * and when it runs out. A session lasts 30 days from its last renewal, and
 * is renewed when it is used with fewer than 15 days left.
 */
import type { D1Database } from './db';
import { cookie, cookiesOf, isSecure } from './http';
import { digest, newSecret } from './ids';

const DAY = 86_400_000;
export const SESSION_MS = 30 * DAY;
const RENEW_BELOW_MS = 15 * DAY;

export interface Account {
  readonly id: string;
  readonly provider: string;
  /** The provider's id for the person: their GitHub user number, their Google account id. */
  readonly subject: string;
  readonly name: string;
  readonly banned: boolean;
}

interface SessionRow {
  readonly id: string;
  readonly provider: string;
  readonly subject: string;
  readonly name: string;
  readonly banned: number;
  readonly expires_at: number;
}

/** __Host- cookies are sent only to the host that set them, over HTTPS, on every path. */
export function sessionCookieName(request: Request): string {
  return isSecure(request) ? '__Host-bb_session' : 'bb_session';
}

function sessionCookie(request: Request, token: string): string {
  return cookie(request, sessionCookieName(request), token, { maxAge: SESSION_MS / 1000 });
}

/** The cookie that ends the session in the browser. */
export function endedSessionCookie(request: Request): string {
  return cookie(request, sessionCookieName(request), '', { maxAge: 0 });
}

/** Starts a session for an account; returns its cookie. */
export async function startSession(db: D1Database, request: Request, accountId: string, now: number): Promise<string> {
  const token = newSecret();
  await db
    .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await digest(token), accountId, now + SESSION_MS)
    .run();
  return sessionCookie(request, token);
}

/** The account a request's session belongs to, and a renewed cookie when it was renewed; null without a live session. */
export async function sessionAccount(
  db: D1Database,
  request: Request,
  now: number,
): Promise<{ readonly account: Account; readonly renewal: string | null } | null> {
  const token = cookiesOf(request).get(sessionCookieName(request));
  if (!token) return null;
  const hash = await digest(token);
  const row = await db
    .prepare(
      `SELECT u.id, u.provider, u.subject, u.name, u.banned, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .bind(hash)
    .first<SessionRow>();
  if (!row || row.expires_at <= now) return null;
  let renewal: string | null = null;
  if (row.expires_at - now < RENEW_BELOW_MS) {
    await db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(now + SESSION_MS, hash).run();
    renewal = sessionCookie(request, token);
  }
  const account = { id: row.id, provider: row.provider, subject: row.subject, name: row.name, banned: row.banned === 1 };
  return { account, renewal };
}

/** Ends the session a request carries, if it carries one. */
export async function endSession(db: D1Database, request: Request): Promise<void> {
  const token = cookiesOf(request).get(sessionCookieName(request));
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await digest(token)).run();
}

/** Clears out sessions that have run out. */
export async function sweepSessions(db: D1Database, now: number): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now).run();
}
