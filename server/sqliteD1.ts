/**
 * D1's API over a SQLite database, for running the API on this computer
 * (`bun run api`) and in tests. D1 is SQLite too, so the same SQL runs on
 * both; as D1 does, this enforces foreign keys and turns down values D1
 * cannot store.
 */
import { Database } from 'bun:sqlite';
import type { D1Database, D1PreparedStatement, D1Result, D1Value } from './db';

type Row = Record<string, unknown>;

class Statement implements D1PreparedStatement {
  constructor(
    private readonly db: Database,
    private readonly sql: string,
    private readonly values: readonly D1Value[] = [],
  ) {}

  bind(...values: D1Value[]): D1PreparedStatement {
    for (const value of values) {
      if (value === undefined || typeof value === 'boolean') throw new TypeError(`D1 cannot bind ${String(value)}`);
    }
    return new Statement(this.db, this.sql, values);
  }

  async first<T = Row>(): Promise<T | null> {
    return (this.db.query(this.sql).get(...this.values) as T | null) ?? null;
  }

  async all<T = Row>(): Promise<D1Result<T>> {
    return { results: this.db.query(this.sql).all(...this.values) as T[], meta: { changes: 0 } };
  }

  async run(): Promise<D1Result<Row>> {
    return this.execute();
  }

  /** Runs now, as a batch's statements must, inside its transaction. */
  execute(): D1Result<Row> {
    const query = this.db.query(this.sql);
    if (query.columnNames.length > 0) return { results: query.all(...this.values) as Row[], meta: { changes: 0 } };
    return { results: [], meta: { changes: query.run(...this.values).changes } };
  }
}

/** A D1 database over `db`; an in-memory one when none is given. */
export function sqliteD1(db: Database = new Database(':memory:')): D1Database {
  db.exec('PRAGMA foreign_keys = ON');
  return {
    prepare: (sql) => new Statement(db, sql),
    batch: async (statements) => db.transaction(() => statements.map((statement) => (statement as Statement).execute()))(),
  };
}
