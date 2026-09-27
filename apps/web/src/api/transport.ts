import type { QuoteEvent } from '@yardline/api';

export interface RawResponse {
  status: number;
  body: string;
}

/**
 * How the UI reaches the API. In server mode that is fetch + EventSource. In the demo it is
 * a SharedWorker that runs the same Hono app on PGlite, so every tab talks to one database.
 */
export interface Transport {
  mode: 'server' | 'demo';
  request(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<RawResponse>;
  /** Live quote events. In the demo this spans every open tab. */
  subscribe(fn: (e: QuoteEvent) => void, quoteId?: string): () => void;
  /** Demo only: wipe and re-seed the in-browser database. */
  reset?(): Promise<void>;
  /** Demo only: who the requests are made as. */
  setUser?(userId: string): void;
}

export function httpTransport(): Transport {
  return {
    mode: 'server',
    async request(method, path, body, headers = {}) {
      const res = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.text() };
    },
    subscribe(fn, quoteId) {
      if (!quoteId) return () => undefined;
      const es = new EventSource(`/api/quotes/${encodeURIComponent(quoteId)}/stream`, { withCredentials: true });
      es.addEventListener('quote', (m) => fn(JSON.parse((m as MessageEvent<string>).data) as QuoteEvent));
      return () => es.close();
    },
  };
}

type WorkerMsg =
  | { type: 'response'; id: number; status: number; body: string }
  | { type: 'event'; event: QuoteEvent }
  | { type: 'ready' }
  | { type: 'progress'; message: string }
  | { type: 'error'; message: string };

export interface DemoBoot {
  transport: Transport;
  ready: Promise<void>;
  onProgress(fn: (message: string) => void): void;
}

export function demoTransport(): DemoBoot {
  const pending = new Map<number, (r: RawResponse) => void>();
  const listeners = new Set<(e: QuoteEvent) => void>();
  const progress = new Set<(m: string) => void>();
  let nextId = 1;
  let userId = localStorageGet('yardline.user') ?? 'u_maya';
  let resolveReady!: () => void;
  let rejectReady!: (e: Error) => void;
  const ready = new Promise<void>((ok, fail) => {
    resolveReady = ok;
    rejectReady = fail;
  });

  const onMessage = (m: MessageEvent<WorkerMsg>) => {
    const msg = m.data;
    if (msg.type === 'response') {
      pending.get(msg.id)?.({ status: msg.status, body: msg.body });
      pending.delete(msg.id);
    } else if (msg.type === 'event') {
      for (const fn of listeners) fn(msg.event);
    } else if (msg.type === 'ready') {
      resolveReady();
    } else if (msg.type === 'progress') {
      for (const fn of progress) fn(msg.message);
    } else if (msg.type === 'error') {
      rejectReady(new Error(msg.message));
    }
  };

  let post: (msg: unknown) => void;
  if (typeof SharedWorker !== 'undefined') {
    const w = new SharedWorker(new URL('../demo/worker.ts', import.meta.url), { type: 'module', name: 'yardline-demo' });
    w.port.onmessage = onMessage;
    w.port.start();
    post = (msg) => w.port.postMessage(msg);
  } else {
    // No SharedWorker (e.g. Chrome on Android): one database per tab, kept in memory.
    const w = new Worker(new URL('../demo/worker.ts', import.meta.url), { type: 'module', name: 'yardline-demo' });
    w.onmessage = onMessage;
    post = (msg) => w.postMessage(msg);
  }
  post({ type: 'hello' });

  const call = (msg: Record<string, unknown>) =>
    new Promise<RawResponse>((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      post({ ...msg, id });
    });

  const transport: Transport = {
    mode: 'demo',
    async request(method, path, body, headers = {}) {
      await ready;
      return call({
        type: 'request',
        method,
        path,
        headers: { 'x-yardline-user': userId, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
    subscribe(fn, quoteId) {
      const wrapped = (e: QuoteEvent) => {
        if (!quoteId || e.quoteId === quoteId) fn(e);
      };
      listeners.add(wrapped);
      return () => listeners.delete(wrapped);
    },
    async reset() {
      await call({ type: 'reset' });
    },
    setUser(id) {
      userId = id;
      localStorageSet('yardline.user', id);
    },
  };
  return { transport, ready, onProgress: (fn) => progress.add(fn) };
}

function localStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function localStorageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the choice just won't survive a reload.
  }
}
