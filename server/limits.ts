/**
 * How much one account, or one visitor, may do in a while: a count per
 * fixed window, kept in the database. Reads are left to Cloudflare (README ›
 * Accounts and the gallery suggests a rate limiting rule); these cap what
 * writes to the database.
 */
import type { D1Database } from './db';
import { HttpError } from './http';
import { digest } from './ids';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** How often a count also clears out old ones, so the table stays small without a schedule of its own. */
const SWEEP_CHANCE = 0.02;

export interface Limit {
  readonly name: string;
  readonly max: number;
  readonly windowMs: number;
}

export const LIMITS = {
  /** Sign-ins started, per visitor. */
  signIn: { name: 'sign-in', max: 20, windowMs: 10 * MINUTE },
  /** Models saved, new or over an old copy. */
  save: { name: 'save', max: 120, windowMs: HOUR },
  /** Models published or taken out of the gallery. */
  publish: { name: 'publish', max: 60, windowMs: HOUR },
  report: { name: 'report', max: 20, windowMs: HOUR },
  /** Changes to an account's name. */
  account: { name: 'account', max: 20, windowMs: HOUR },
} as const satisfies Record<string, Limit>;

/**
 * Counts one more against `limit` for `who` (an account, or a visitor's
 * address, kept only as a hash); 429, saying when to try again, once it is
 * used up.
 */
export async function spend(db: D1Database, limit: Limit, who: string, now: number, chance = Math.random()): Promise<void> {
  if (chance < SWEEP_CHANCE) await sweepLimits(db, now);
  const windowStart = Math.floor(now / limit.windowMs) * limit.windowMs;
  const row = await db
    .prepare(
      `INSERT INTO limits (key, window_start, hits) VALUES (?, ?, 1)
       ON CONFLICT (key) DO UPDATE SET
         hits = CASE WHEN limits.window_start = excluded.window_start THEN limits.hits + 1 ELSE 1 END,
         window_start = excluded.window_start
       RETURNING hits`,
    )
    .bind(`${limit.name}:${await digest(who)}`, windowStart)
    .first<{ hits: number }>();
  if ((row?.hits ?? 0) > limit.max) {
    const wait = Math.ceil((windowStart + limit.windowMs - now) / 1000);
    const minutes = Math.ceil(wait / 60);
    throw new HttpError(429, `That is enough for now: try again in ${minutes === 1 ? 'a minute' : `${minutes} minutes`}.`, {
      'Retry-After': String(wait),
    });
  }
}

/** Clears out counts from windows long gone. */
export async function sweepLimits(db: D1Database, now: number): Promise<void> {
  await db.prepare('DELETE FROM limits WHERE window_start < ?').bind(now - 24 * HOUR).run();
}
