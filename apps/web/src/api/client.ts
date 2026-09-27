import type { QuoteDetail, QuoteSummary, SharedQuote, User } from '@yardline/api';
import type { Confidence, Tier } from '@yardline/core';
import type { Transport } from './transport.ts';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: any;
  constructor(status: number, code: string, message: string, details: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type { QuoteDetail, QuoteSummary, SharedQuote, User };
export type QuoteLine = QuoteDetail['lines'][number];
export type QuoteStatus = QuoteSummary['status'];

export interface ProductLite {
  id: string;
  name: string;
  uom: string;
  category: string;
  priceCents: number;
  available: number;
}

export interface Proposal {
  raw: string;
  qty: number;
  confidence: Confidence;
  notes: string[];
  best: ProductLite | null;
  candidates: { product: ProductLite; score: number; reasons: string[] }[];
}

export interface Customer {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string | null;
  tier: Tier;
  branchId: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  uom: string;
  priceCents: number;
  available: number;
  onHand: number;
  reserved: number;
}

export interface OrderSummary {
  id: string;
  number: string;
  status: string;
  totalCents: number;
  createdAt: string;
  customerName: string;
  quoteId: string;
  quoteNumber: string;
  branchName: string;
  lineCount: number;
}

export interface OrderDetail extends Omit<OrderSummary, 'lineCount'> {
  createdBy: string;
  lines: { position: number; productId: string; name: string; uom: string; qty: number; netUnitCents: number; lineTotalCents: number }[];
}

export interface Metrics {
  counts: Record<QuoteStatus, number>;
  openValueCents: number;
  wonValueCents: number;
  winRate: number | null;
  minutesToSend: { median: number | null; p90: number | null; quotes: number };
  daily: { day: string; created: number; won: number }[];
}

export interface LineSave {
  productId: string;
  qty: number;
  extraDiscountBp?: number;
  rawText?: string | null;
}

export function createClient(t: Transport) {
  async function call<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    const res = await t.request(method, `/api${path}`, body, headers);
    const data = res.body ? JSON.parse(res.body) : null;
    if (res.status >= 400) {
      const e = data?.error ?? {};
      throw new HttpError(res.status, e.code ?? 'error', e.message ?? `Request failed (${res.status})`, e.details);
    }
    return data as T;
  }
  const q = (params: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
    return s ? `?${s}` : '';
  };

  return {
    transport: t,
    me: () => call<User>('GET', '/me'),
    login: (email: string, password: string) => call<User>('POST', '/session', { email, password }),
    logout: () => call<null>('DELETE', '/session'),
    users: () => call<User[]>('GET', '/users'),
    customers: () => call<Customer[]>('GET', '/customers'),
    catalog: (opts: { q?: string; category?: string } = {}) => call<CatalogItem[]>('GET', `/catalog${q(opts)}`),
    parse: (text: string) => call<Proposal[]>('POST', '/parse', { text }),
    quotes: (opts: { status?: string; q?: string } = {}) => call<QuoteSummary[]>('GET', `/quotes${q(opts)}`),
    quote: (id: string) => call<QuoteDetail>('GET', `/quotes/${id}`),
    createQuote: (customerId: string, jobName: string) => call<QuoteDetail>('POST', '/quotes', { customerId, jobName }),
    saveLines: (id: string, version: number, lines: LineSave[], jobName?: string) => call<QuoteDetail>('PUT', `/quotes/${id}/lines`, { version, lines, jobName }),
    approve: (id: string, version: number) => call<QuoteDetail>('POST', `/quotes/${id}/approve`, { version }),
    send: (id: string, version: number) => call<{ token: string; quote: QuoteDetail }>('POST', `/quotes/${id}/send`, { version }),
    order: (id: string, key: string) => call<{ replayed: boolean; order: OrderDetail }>('POST', `/quotes/${id}/order`, undefined, { 'idempotency-key': key }),
    orders: () => call<OrderSummary[]>('GET', '/orders'),
    orderDetail: (id: string) => call<OrderDetail>('GET', `/orders/${id}`),
    metrics: () => call<Metrics>('GET', '/metrics'),
    shared: (token: string, view = false) => call<SharedQuote>('GET', `/share/${encodeURIComponent(token)}${view ? '?view=1' : ''}`),
    accept: (token: string, version: number, name: string) => call<SharedQuote>('POST', `/share/${encodeURIComponent(token)}/accept`, { version, name }),
    decline: (token: string, reason: string) => call<SharedQuote>('POST', `/share/${encodeURIComponent(token)}/decline`, { reason }),
  };
}

export type Client = ReturnType<typeof createClient>;
