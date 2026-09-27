import type { Db } from './db.ts';

/**
 * Migrations are plain SQL kept in code so the browser bundle can run them too.
 * Each runs once, in order, inside a transaction, and is recorded in schema_migrations.
 */
export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: '001_init',
    sql: /* sql */ `
      CREATE EXTENSION IF NOT EXISTS pg_trgm;

      CREATE TABLE branches (
        id text PRIMARY KEY,
        name text NOT NULL
      );

      CREATE TABLE products (
        id text PRIMARY KEY,
        name text NOT NULL,
        category text NOT NULL,
        uom text NOT NULL,
        price_cents integer NOT NULL CHECK (price_cents >= 0),
        cost_cents integer NOT NULL CHECK (cost_cents >= 0),
        data jsonb NOT NULL,
        active boolean NOT NULL DEFAULT true
      );
      CREATE INDEX products_name_trgm ON products USING gin (name gin_trgm_ops);

      CREATE TABLE inventory (
        product_id text NOT NULL REFERENCES products(id),
        branch_id text NOT NULL REFERENCES branches(id),
        on_hand integer NOT NULL CHECK (on_hand >= 0),
        reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
        PRIMARY KEY (product_id, branch_id),
        CONSTRAINT reserved_within_on_hand CHECK (reserved <= on_hand)
      );

      CREATE TABLE customers (
        id text PRIMARY KEY,
        name text NOT NULL,
        contact_name text NOT NULL,
        email text NOT NULL,
        phone text,
        tier text NOT NULL CHECK (tier IN ('retail', 'contractor', 'pro')),
        branch_id text NOT NULL REFERENCES branches(id)
      );

      CREATE TABLE users (
        id text PRIMARY KEY,
        name text NOT NULL,
        email text NOT NULL UNIQUE,
        title text NOT NULL,
        role text NOT NULL CHECK (role IN ('rep', 'manager')),
        branch_id text NOT NULL REFERENCES branches(id),
        password_hash text
      );

      CREATE TABLE sessions (
        token_hash text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL
      );

      CREATE TABLE counters (
        name text PRIMARY KEY,
        value integer NOT NULL
      );

      CREATE TABLE quotes (
        id text PRIMARY KEY,
        number text NOT NULL UNIQUE,
        customer_id text NOT NULL REFERENCES customers(id),
        rep_id text NOT NULL REFERENCES users(id),
        branch_id text NOT NULL REFERENCES branches(id),
        status text NOT NULL CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'ordered')),
        version integer NOT NULL DEFAULT 1,
        job_name text NOT NULL DEFAULT '',
        subtotal_cents integer NOT NULL DEFAULT 0,
        tax_cents integer NOT NULL DEFAULT 0,
        total_cents integer NOT NULL DEFAULT 0,
        board_feet numeric(12, 3) NOT NULL DEFAULT 0,
        needs_approval boolean NOT NULL DEFAULT false,
        approved_version integer,
        approved_by text REFERENCES users(id),
        share_token_hash text UNIQUE,
        decline_reason text,
        accepted_by_name text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        sent_at timestamptz,
        accepted_at timestamptz,
        valid_until timestamptz
      );
      CREATE INDEX quotes_status_updated ON quotes (status, updated_at DESC);

      CREATE TABLE quote_lines (
        quote_id text NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
        position integer NOT NULL,
        product_id text NOT NULL REFERENCES products(id),
        qty integer NOT NULL CHECK (qty > 0),
        raw_text text,
        list_unit_cents integer NOT NULL,
        tier_bp integer NOT NULL,
        volume_bp integer NOT NULL,
        extra_bp integer NOT NULL,
        net_unit_cents integer NOT NULL,
        line_total_cents integer NOT NULL,
        approval_reasons jsonb NOT NULL DEFAULT '[]',
        PRIMARY KEY (quote_id, position)
      );

      CREATE TABLE orders (
        id text PRIMARY KEY,
        number text NOT NULL UNIQUE,
        quote_id text NOT NULL UNIQUE REFERENCES quotes(id),
        customer_id text NOT NULL REFERENCES customers(id),
        branch_id text NOT NULL REFERENCES branches(id),
        status text NOT NULL CHECK (status IN ('open', 'picked', 'delivered', 'cancelled')),
        total_cents integer NOT NULL,
        created_by text NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL
      );

      CREATE TABLE order_lines (
        order_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        position integer NOT NULL,
        product_id text NOT NULL REFERENCES products(id),
        qty integer NOT NULL CHECK (qty > 0),
        net_unit_cents integer NOT NULL,
        line_total_cents integer NOT NULL,
        PRIMARY KEY (order_id, position)
      );

      CREATE TABLE idempotency_keys (
        key text PRIMARY KEY,
        scope text NOT NULL,
        status integer NOT NULL,
        response jsonb NOT NULL,
        created_at timestamptz NOT NULL
      );

      CREATE TABLE quote_events (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        quote_id text NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
        at timestamptz NOT NULL,
        actor text NOT NULL,
        kind text NOT NULL,
        version integer NOT NULL,
        detail jsonb NOT NULL DEFAULT '{}'
      );
      CREATE INDEX quote_events_quote ON quote_events (quote_id, id);
    `,
  },
];

export async function migrate(db: Db): Promise<string[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const { rows } = await db.query<{ id: string }>('SELECT id FROM schema_migrations');
  const done = new Set(rows.map((r) => r.id));
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
    });
    applied.push(m.id);
  }
  return applied;
}
