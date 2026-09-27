import { createApp, createCtx, demoAuth, migrate, seedReference, type Ctx } from '../src/index.ts';
import { createPglite, pgliteDb } from '../src/pglite.ts';

export interface Harness {
  ctx: Ctx;
  app: ReturnType<typeof createApp>;
  clock: { now: Date; advance(ms: number): void };
  /** fetch-like helper that acts as a staff user (u_maya by default). */
  call(method: string, path: string, body?: unknown, opts?: { user?: string | null; headers?: Record<string, string> }): Promise<{ status: number; json: any }>;
}

export async function harness(): Promise<Harness> {
  const pg = await createPglite();
  const db = pgliteDb(pg);
  await migrate(db);
  await seedReference(db);
  const clock = {
    now: new Date('2026-09-27T14:00:00Z'),
    advance(ms: number) {
      this.now = new Date(this.now.getTime() + ms);
    },
  };
  let n = 0;
  const ctx = createCtx(db, { now: () => clock.now, id: (p) => `${p}_t${++n}` });
  const app = createApp(ctx, demoAuth);
  const call: Harness['call'] = async (method, path, body, opts = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    const user = opts.user === undefined ? 'u_maya' : opts.user;
    if (user) headers['x-yardline-user'] = user;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
  return { ctx, app, clock, call };
}

/** Create a quote for a customer and fill it from a pasted list, returning the saved quote. */
export async function quoteFromList(h: Harness, customerId: string, text: string, extra?: (lines: any[]) => void) {
  const created = await h.call('POST', '/api/quotes', { customerId, jobName: 'Test job' });
  const parsed = await h.call('POST', '/api/parse', { text });
  const lines = parsed.json.filter((p: any) => p.best).map((p: any) => ({ productId: p.best.id, qty: p.qty, rawText: p.raw }));
  extra?.(lines);
  const saved = await h.call('PUT', `/api/quotes/${created.json.id}/lines`, { version: created.json.version, lines });
  if (saved.status !== 200) throw new Error(JSON.stringify(saved.json));
  return saved.json;
}
