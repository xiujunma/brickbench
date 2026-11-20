/**
 * The database: Cloudflare D1 on the hosted site, SQLite on this computer
 * (./sqliteD1.ts). The server uses only this part of D1's API
 * (https://developers.cloudflare.com/d1/worker-api/), and makes its own
 * tables the first time it runs, so a new site needs nothing but an empty
 * database.
 */

/** What a statement can be given: D1 turns `undefined` and booleans down or round, so neither is used. */
export type D1Value = string | number | null;

export interface D1Result<T> {
  readonly results: T[];
  readonly meta: { readonly changes: number };
}

export interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result<Record<string, unknown>>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  /** Runs the statements in one transaction: all of them, or none. */
  batch(statements: D1PreparedStatement[]): Promise<D1Result<Record<string, unknown>>[]>;
}

/**
 * Each version's statements, applied in order. Every statement can run
 * twice harmlessly, so two servers starting at once cannot trip each other.
 * Deleting an account deletes its sessions, models and reports with it.
 */
const MIGRATIONS: readonly (readonly string[])[] = [
  [
    `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      subject TEXT NOT NULL,
      name TEXT NOT NULL,
      banned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      UNIQUE (provider, subject)
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)`,
    `CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at)`,
    // the small columns first: lists read them without touching a model's file
    `CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      bricks INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      published_at INTEGER,
      hidden INTEGER NOT NULL DEFAULT 0,
      thumbnail TEXT,
      data TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS models_owner ON models (owner_id, updated_at)`,
    `CREATE INDEX IF NOT EXISTS models_gallery ON models (published_at, id) WHERE published_at IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS reports (
      model_id TEXT NOT NULL REFERENCES models (id) ON DELETE CASCADE,
      reporter_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (model_id, reporter_id)
    )`,
    `CREATE INDEX IF NOT EXISTS reports_reporter ON reports (reporter_id)`,
    `CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, hits INTEGER NOT NULL)`,
  ],
];

export const SCHEMA_VERSION = MIGRATIONS.length;

async function schemaVersion(db: D1Database): Promise<number> {
  try {
    const row = await db.prepare(`SELECT value FROM meta WHERE key = 'schema'`).first<{ value: string }>();
    return row ? Number(row.value) : 0;
  } catch {
    // no meta table: a new database
    return 0;
  }
}

async function migrate(db: D1Database): Promise<void> {
  const version = await schemaVersion(db);
  if (version >= SCHEMA_VERSION) return;
  const statements = MIGRATIONS.slice(version)
    .flat()
    .map((sql) => db.prepare(sql));
  statements.push(db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)`).bind(String(SCHEMA_VERSION)));
  await db.batch(statements);
}

const ready = new WeakMap<D1Database, Promise<void>>();

/** Brings the database's tables up to date, once per database; a failure is tried again on the next request. */
export function ensureSchema(db: D1Database): Promise<void> {
  let migrated = ready.get(db);
  if (!migrated) {
    migrated = migrate(db).catch((error: unknown) => {
      ready.delete(db);
      throw error;
    });
    ready.set(db, migrated);
  }
  return migrated;
}
