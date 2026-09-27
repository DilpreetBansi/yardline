/// <reference lib="webworker" />
/**
 * The demo's "server": the real Hono API and a real Postgres (PGlite, WebAssembly) running in
 * a SharedWorker. Every open tab connects to this one instance, so a customer link opened in a
 * second tab and the rep's editor see the same data and get the same live events.
 */
import { createApp, createCtx, demoAuth, migrate, seedHistory, seedReference, type Db, type QuoteEvent } from '@yardline/api';
import { createPglite, pgliteDb } from '@yardline/api/pglite';

type Port = { postMessage(msg: unknown): void };
type InMsg =
  | { type: 'hello' }
  | { type: 'request'; id: number; method: string; path: string; headers: Record<string, string>; body?: string }
  | { type: 'reset'; id: number };

const ports = new Set<Port>();
const shared = typeof (self as unknown as { onconnect?: unknown }).onconnect !== 'undefined' || 'SharedWorkerGlobalScope' in self;

function broadcast(msg: unknown) {
  for (const p of ports) p.postMessage(msg);
}

let app: ReturnType<typeof createApp> | null = null;
let db: Db | null = null;
let booting: Promise<void> | null = null;
let opening: Promise<Db> | null = null;

/** One PGlite for the life of the worker (IndexedDB allows only one owner). */
function openDb(): Promise<Db> {
  // Without a SharedWorker every tab would get its own copy, so keep that case in memory.
  opening ??= createPglite(shared ? 'idb://yardline-demo' : undefined).then(pgliteDb);
  return opening;
}

async function boot() {
  broadcast({ type: 'progress', message: 'Starting Postgres in your browser…' });
  const database = await openDb();
  broadcast({ type: 'progress', message: 'Creating tables…' });
  await migrate(database);
  const fresh = await seedReference(database);
  if (fresh) {
    broadcast({ type: 'progress', message: 'Loading the catalog and six weeks of sample quotes…' });
    await seedHistory(database, new Date());
  }
  return { db: database };
}

function start(): Promise<void> {
  booting ??= (async () => {
    try {
      const b = await boot();
      db = b.db;
      const ctx = createCtx(db);
      ctx.events.subscribe((event: QuoteEvent) => broadcast({ type: 'event', event }));
      app = createApp(ctx, demoAuth);
      broadcast({ type: 'ready' });
    } catch (e) {
      booting = null;
      broadcast({ type: 'error', message: (e as Error).message ?? String(e) });
    }
  })();
  return booting;
}

async function handle(port: Port, msg: InMsg) {
  if (msg.type === 'hello') {
    await start();
    if (app) port.postMessage({ type: 'ready' });
    return;
  }
  await start();
  if (msg.type === 'reset') {
    await db!.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    booting = null;
    app = null;
    await start();
    port.postMessage({ type: 'response', id: msg.id, status: 204, body: '' });
    broadcast({ type: 'event', event: { quoteId: '*', kind: 'created', version: 0, actor: 'system', at: new Date().toISOString() } });
    return;
  }
  if (msg.type === 'request') {
    try {
      const res = await app!.request(msg.path, { method: msg.method, headers: msg.headers, body: msg.body });
      port.postMessage({ type: 'response', id: msg.id, status: res.status, body: await res.text() });
    } catch (e) {
      port.postMessage({ type: 'response', id: msg.id, status: 500, body: JSON.stringify({ error: { code: 'worker', message: (e as Error).message } }) });
    }
  }
}

if (shared) {
  (self as unknown as { onconnect: (e: MessageEvent) => void }).onconnect = (e: MessageEvent) => {
    const port = e.ports[0]!;
    ports.add(port);
    port.onmessage = (m: MessageEvent<InMsg>) => void handle(port, m.data);
    port.start();
  };
} else {
  const port: Port = { postMessage: (msg) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg) };
  ports.add(port);
  self.onmessage = (m: MessageEvent<InMsg>) => void handle(port, m.data);
}
