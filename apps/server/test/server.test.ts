import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCtx, createOrder, migrate, parseText, saveLines, createQuote, sendQuote, acceptShared, seedReference, USERS, type Ctx } from '@yardline/api';
import { pgDb } from '../src/pg.ts';
import { startServer } from '../src/main.ts';

/**
 * These run against a real Postgres (DATABASE_URL), because row locks and concurrent
 * transactions are exactly what PGlite's single connection can't show. CI starts one.
 */
const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

async function resetSchema(connectionString: string) {
  const c = new pg.Client({ connectionString });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
}

d('against Postgres', () => {
  let pool: pg.Pool;
  let ctx: Ctx;
  const maya = USERS[0]!;

  beforeAll(async () => {
    await resetSchema(url!);
    pool = new pg.Pool({ connectionString: url, max: 10 });
    const db = pgDb(pool);
    await migrate(db);
    await seedReference(db);
    ctx = createCtx(db);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  async function accepted(text: string) {
    const q = await createQuote(ctx, maya, { customerId: 'c_maple' });
    const lines = (await parseText(ctx, text, 'MSS')).map((p) => ({ productId: p.best!.id, qty: p.qty }));
    const saved = await saveLines(ctx, maya, q.id, { version: q.version, lines });
    const { token } = await sendQuote(ctx, maya, q.id, saved.version);
    await acceptShared(ctx, token, { version: saved.version, name: 'Chloe Martin' });
    return saved;
  }

  it('never oversells when two orders race for the last boards', async () => {
    // 12 of these at Mississauga; each quote wants 8.
    const [a, b] = await Promise.all([accepted('2x12x16 doug fir x 8'), accepted('2x12x16 doug fir x 8')]);
    const results = await Promise.allSettled([
      createOrder(ctx, maya, a.id, `race-a-${a.id}`),
      createOrder(ctx, maya, b.id, `race-b-${b.id}`),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason.code).toBe('insufficient_stock');
    const { rows } = await pool.query("SELECT on_hand, reserved FROM inventory WHERE product_id = 'LBR-DF-2X12-16' AND branch_id = 'MSS'");
    expect(rows[0]).toEqual({ on_hand: 12, reserved: 8 });
  });

  it('the same idempotency key under concurrency creates one order', async () => {
    const q = await accepted('10 bags concrete 30kg');
    const key = `dup-${q.id}`;
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => createOrder(ctx, maya, q.id, key)));
    const ok = results.filter((r): r is PromiseFulfilledResult<{ replayed: boolean; orderId: string }> => r.status === 'fulfilled');
    expect(ok).toHaveLength(5);
    expect(new Set(ok.map((r) => r.value.orderId)).size).toBe(1);
    expect(ok.filter((r) => r.value.replayed)).toHaveLength(4);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM orders WHERE quote_id = $1', [q.id]);
    expect(rows[0].n).toBe(1);
  });
});

d('HTTP server', () => {
  let srv: Awaited<ReturnType<typeof startServer>>;
  let base: string;

  beforeAll(async () => {
    await resetSchema(url!);
    srv = await startServer({ databaseUrl: url!, port: 0, demoPassword: 'correct horse', seedHistory: false, webDist: '/nonexistent' });
    base = `http://127.0.0.1:${srv.port}`;
  }, 60_000);

  afterAll(async () => {
    await srv?.close();
  });

  it('signs in with a password and keeps the session in an HttpOnly cookie', async () => {
    const bad = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'maya@yardline.test', password: 'nope' }) });
    expect(bad.status).toBe(401);
    const res = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'maya@yardline.test', password: 'correct horse' }) });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/yl_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const session = cookie.split(';')[0]!;
    expect((await fetch(`${base}/api/me`)).status).toBe(401);
    const me = await fetch(`${base}/api/me`, { headers: { cookie: session } });
    expect((await me.json()).email).toBe('maya@yardline.test');
    // The demo header is not honoured on the server.
    expect((await fetch(`${base}/api/me`, { headers: { 'x-yardline-user': 'u_sam' } })).status).toBe(401);
    await fetch(`${base}/api/session`, { method: 'DELETE', headers: { cookie: session } });
    expect((await fetch(`${base}/api/me`, { headers: { cookie: session } })).status).toBe(401);
  });

  it('streams quote changes over Server-Sent Events', async () => {
    const login = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'maya@yardline.test', password: 'correct horse' }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const json = { cookie, 'content-type': 'application/json' };
    const q = await (await fetch(`${base}/api/quotes`, { method: 'POST', headers: json, body: JSON.stringify({ customerId: 'c_halton' }) })).json();
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/quotes/${q.id}/stream`, { headers: { cookie }, signal: ctrl.signal });
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const events: string[] = [];
    const reading = (async () => {
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
        for (const m of buf.matchAll(/event: (\w+)\ndata: (.*)\n/g)) events.push(`${m[1]}:${m[1] === 'quote' ? JSON.parse(m[2]!).kind : ''}`);
        buf = buf.slice(buf.lastIndexOf('\n\n') + 2);
        if (events.includes('quote:lines_updated')) break;
      }
    })();
    await new Promise((r) => setTimeout(r, 200));
    await fetch(`${base}/api/quotes/${q.id}/lines`, { method: 'PUT', headers: json, body: JSON.stringify({ version: q.version, lines: [{ productId: 'CON-REG-30', qty: 3 }] }) });
    await Promise.race([reading, new Promise((r) => setTimeout(r, 5_000))]);
    ctrl.abort();
    expect(events).toContain('ready:');
    expect(events).toContain('quote:lines_updated');
  });
});
