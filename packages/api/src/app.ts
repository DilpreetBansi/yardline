import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { ApiError, one } from './db.ts';
import type { EventBus, QuoteEvent } from './events.ts';
import * as svc from './services.ts';
import type { Ctx, User } from './services.ts';

export type Env = { Variables: { user: User } };

/** How a request is tied to a staff user. The server uses session cookies; the demo uses a header. */
export interface AuthStrategy {
  user(c: Context<Env>, ctx: Ctx): Promise<User | null>;
  /** Extra routes such as login/logout, mounted under /api before the auth check. */
  mount?(app: Hono<Env>, ctx: Ctx): void;
}

/** The in-browser demo picks who you are from a role switcher. Never use this on a server. */
export const demoAuth: AuthStrategy = {
  async user(c, ctx) {
    const id = c.req.header('x-yardline-user');
    if (!id) return null;
    return (await one<User>(ctx.db, 'SELECT id, name, email, title, role, branch_id AS "branchId" FROM users WHERE id = $1', [id])) ?? null;
  },
};

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, 'bad_json', 'Request body must be JSON');
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    throw new ApiError(400, 'invalid', r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), r.error.issues);
  }
  return r.data;
}

const Version = z.object({ version: z.number().int().positive() });
const LinesBody = z.object({
  version: z.number().int().positive(),
  jobName: z.string().trim().max(120).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1).max(40),
        qty: z.number().int().min(1).max(100_000),
        extraDiscountBp: z.number().int().min(0).max(5_000).optional(),
        rawText: z.string().max(300).nullish(),
      }),
    )
    .max(300),
});

export interface AppOptions {
  /** Bus the SSE stream listens on. Defaults to ctx.events; a multi-instance server passes a bus fed by LISTEN/NOTIFY. */
  stream?: EventBus;
}

export function createApp(ctx: Ctx, auth: AuthStrategy, opts: AppOptions = {}) {
  const streamBus = opts.stream ?? ctx.events;
  const app = new Hono<Env>().basePath('/api');

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, err.status as 400);
    }
    console.error(err);
    return c.json({ error: { code: 'internal', message: 'Something went wrong on our side.', details: null } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: 'not_found', message: `No route ${c.req.method} ${c.req.path}`, details: null } }, 404));

  app.get('/health', (c) => c.json({ ok: true }));

  // Customer-facing: the share token in the URL is the only credential.
  app.get('/share/:token', async (c) => c.json(await svc.getShared(ctx, c.req.param('token'), { recordView: c.req.query('view') === '1' })));
  app.post('/share/:token/accept', async (c) => {
    const b = await body(c, Version.extend({ name: z.string().trim().min(2, 'Type your name to accept').max(80) }));
    return c.json(await svc.acceptShared(ctx, c.req.param('token'), b));
  });
  app.post('/share/:token/decline', async (c) => {
    const b = await body(c, z.object({ reason: z.string().trim().min(2).max(500) }));
    return c.json(await svc.declineShared(ctx, c.req.param('token'), b));
  });

  auth.mount?.(app, ctx);

  // Everything below needs a signed-in staff member.
  app.use('*', async (c, next) => {
    const user = await auth.user(c, ctx);
    if (!user) throw new ApiError(401, 'unauthenticated', 'Sign in to continue');
    c.set('user', user);
    await next();
  });

  app.get('/me', (c) => c.json(c.get('user')));
  app.get('/users', async (c) => c.json(await svc.listUsers(ctx)));
  app.get('/customers', async (c) => c.json(await svc.listCustomers(ctx)));
  app.get('/catalog', async (c) =>
    c.json(await svc.searchCatalog(ctx, { q: c.req.query('q'), category: c.req.query('category'), branchId: c.req.query('branch') ?? c.get('user').branchId })),
  );
  app.post('/parse', async (c) => {
    const b = await body(c, z.object({ text: z.string().max(20_000), branchId: z.string().optional() }));
    return c.json(await svc.parseText(ctx, b.text, b.branchId ?? c.get('user').branchId));
  });

  app.get('/quotes', async (c) => {
    const status = c.req.query('status');
    const parsed = z.enum(['draft', 'sent', 'accepted', 'declined', 'ordered']).optional().safeParse(status || undefined);
    if (!parsed.success) throw new ApiError(400, 'invalid', `Unknown status ${status}`);
    return c.json(await svc.listQuotes(ctx, { status: parsed.data, q: c.req.query('q') }));
  });
  app.post('/quotes', async (c) => {
    const b = await body(c, z.object({ customerId: z.string().min(1), jobName: z.string().trim().max(120).optional() }));
    return c.json(await svc.createQuote(ctx, c.get('user'), b), 201);
  });
  app.get('/quotes/:id', async (c) => c.json(await svc.getQuote(ctx, c.req.param('id'))));
  app.put('/quotes/:id/lines', async (c) => {
    const b = await body(c, LinesBody);
    return c.json(await svc.saveLines(ctx, c.get('user'), c.req.param('id'), b));
  });
  app.post('/quotes/:id/approve', async (c) => {
    const b = await body(c, Version);
    return c.json(await svc.approveQuote(ctx, c.get('user'), c.req.param('id'), b.version));
  });
  app.post('/quotes/:id/send', async (c) => {
    const b = await body(c, Version);
    return c.json(await svc.sendQuote(ctx, c.get('user'), c.req.param('id'), b.version));
  });
  app.post('/quotes/:id/order', async (c) => {
    const key = c.req.header('idempotency-key');
    if (!key) throw new ApiError(400, 'idempotency_key_required', 'Send an Idempotency-Key header so a retry cannot create a second order');
    const r = await svc.createOrder(ctx, c.get('user'), c.req.param('id'), key);
    return c.json({ replayed: r.replayed, order: await svc.getOrder(ctx, r.orderId) }, r.replayed ? 200 : 201);
  });

  /** Live updates for one quote as Server-Sent Events (server mode). */
  app.get('/quotes/:id/stream', (c) => {
    const id = c.req.param('id');
    return streamSSE(c, async (stream) => {
      const queue: QuoteEvent[] = [];
      let wake: (() => void) | null = null;
      const off = streamBus.subscribe((e) => {
        if (e.quoteId !== id) return;
        queue.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        off();
        wake?.();
      });
      await stream.writeSSE({ event: 'ready', data: '{}' });
      while (!stream.aborted) {
        while (queue.length) await stream.writeSSE({ event: 'quote', data: JSON.stringify(queue.shift()) });
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 25_000);
        });
        wake = null;
        if (!queue.length && !stream.aborted) await stream.writeSSE({ event: 'ping', data: '{}' });
      }
      off();
    });
  });

  app.get('/orders', async (c) => c.json(await svc.listOrders(ctx)));
  app.get('/orders/:id', async (c) => c.json(await svc.getOrder(ctx, c.req.param('id'))));
  app.get('/metrics', async (c) => c.json(await svc.metrics(ctx)));

  return app;
}

export type App = ReturnType<typeof createApp>;
