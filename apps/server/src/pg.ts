import pg from 'pg';
import type { Db } from '@yardline/api';

type Client = pg.Pool | pg.PoolClient;

function wrap(pool: pg.Pool, client: Client, inTx: boolean): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await client.query(sql, params);
      return { rows: r.rows as T[] };
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      if (inTx) return fn(wrap(pool, client, true));
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const result = await fn(wrap(pool, c, true));
        await c.query('COMMIT');
        return result;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    },
    async exec(sql: string) {
      await client.query(sql);
    },
  };
}

/** node-postgres behind the Db interface. Each transaction gets its own pooled connection. */
export function pgDb(pool: pg.Pool): Db {
  return wrap(pool, pool, false);
}
