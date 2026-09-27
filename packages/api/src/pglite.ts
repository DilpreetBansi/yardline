import type { PGlite, Transaction } from '@electric-sql/pglite';
import type { Db } from './db.ts';

type Queryable = PGlite | Transaction;

function wrap(q: Queryable, root: PGlite): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await q.query<T>(sql, params as never[]);
      return { rows: r.rows };
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      if (q !== root) return fn(wrap(q, root)); // already inside one; PGlite has a single connection
      return root.transaction((tx) => fn(wrap(tx, root)));
    },
    async exec(sql: string) {
      await q.exec(sql);
    },
  };
}

/** Adapts a PGlite instance (browser or Node) to the Db interface. */
export function pgliteDb(pg: PGlite): Db {
  return wrap(pg, pg);
}

/**
 * Postgres with pg_trgm: in memory for tests, or persisted to IndexedDB (idb://name) in the
 * browser. relaxedDurability flushes to IndexedDB after the query returns instead of before,
 * which is what keeps the demo fast; the worst case is losing the last write on a crash.
 */
export async function createPglite(dataDir?: string): Promise<PGlite> {
  const [{ PGlite }, { pg_trgm }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pg_trgm'),
  ]);
  return PGlite.create(dataDir, { extensions: { pg_trgm }, relaxedDurability: dataDir?.startsWith('idb://') ?? false });
}
