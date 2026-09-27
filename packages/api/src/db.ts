/**
 * The whole data layer talks to this interface. Two implementations exist: PGlite
 * (Postgres compiled to WebAssembly, used in the browser demo and in tests) and
 * node-postgres (the server). Both run the same SQL.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Runs fn in one transaction; rolls back if it throws. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  /** Runs a multi-statement script without parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export async function one<T>(db: Db, sql: string, params?: unknown[]): Promise<T | undefined> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

export async function many<T>(db: Db, sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

/** Error with an HTTP status and a machine-readable code; the API turns it into a JSON response. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
