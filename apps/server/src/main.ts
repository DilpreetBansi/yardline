import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { serve, type ServerType } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import pg from 'pg';
import { createApp, createCtx, EventBus, migrate, seedHistory, seedReference, type QuoteEvent } from '@yardline/api';
import { hashPassword, sessionAuth } from './auth.ts';
import { pgDb } from './pg.ts';

export interface ServerOptions {
  databaseUrl: string;
  port: number;
  /** Seeded staff get this password if they have none yet. Leave unset in production. */
  demoPassword?: string;
  seedHistory?: boolean;
  webDist?: string;
  secureCookies?: boolean;
}

export async function startServer(opts: ServerOptions): Promise<{ server: ServerType; port: number; close(): Promise<void> }> {
  const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 10 });
  const db = pgDb(pool);
  await migrate(db);
  await seedReference(db);
  if (opts.seedHistory) await seedHistory(db, new Date());
  if (opts.demoPassword) {
    const hash = await hashPassword(opts.demoPassword);
    await db.query('UPDATE users SET password_hash = $1 WHERE password_hash IS NULL', [hash]);
  }

  const ctx = createCtx(db);

  // Live updates across server instances: every event goes out on NOTIFY, and each instance
  // feeds what it hears from the others into the bus its SSE streams read from.
  const instance = randomUUID();
  const stream = new EventBus();
  ctx.events.subscribe((e) => {
    stream.publish(e);
    pool.query('SELECT pg_notify($1, $2)', ['yardline_events', JSON.stringify({ instance, e })]).catch((err) => console.error('notify failed', err));
  });
  const listener = new pg.Client({ connectionString: opts.databaseUrl });
  await listener.connect();
  await listener.query('LISTEN yardline_events');
  listener.on('notification', (msg) => {
    try {
      const { instance: from, e } = JSON.parse(msg.payload ?? '{}') as { instance: string; e: QuoteEvent };
      if (from !== instance) stream.publish(e);
    } catch (err) {
      console.error('bad notification', err);
    }
  });

  const root = new Hono();
  root.route('/', createApp(ctx, sessionAuth({ secureCookies: opts.secureCookies ?? false }), { stream }));

  const dist = opts.webDist ?? resolve(import.meta.dirname, '../../web/dist-server');
  if (existsSync(dist)) {
    const rel = relative(process.cwd(), dist) || '.';
    root.use('/*', serveStatic({ root: rel }));
    root.get('*', serveStatic({ path: `${rel}/index.html` }));
  } else {
    root.get('/', (c) => c.text('API is running. Build the web app with `npm run build:server -w @yardline/web` to serve the UI here.'));
  }

  const server = await new Promise<ServerType>((ok) => {
    const s = serve({ fetch: root.fetch, port: opts.port }, () => ok(s));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  return {
    server,
    port,
    async close() {
      await new Promise<void>((ok) => server.close(() => ok()));
      await listener.end();
      await pool.end();
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const { port } = await startServer({
    databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/yardline',
    port: Number(process.env.PORT ?? 8787),
    demoPassword: process.env.YARDLINE_DEMO_PASSWORD,
    seedHistory: process.env.YARDLINE_SEED_HISTORY !== '0',
    secureCookies: process.env.SECURE_COOKIES === '1',
  });
  console.log(`Yardline listening on http://localhost:${port}`);
}
