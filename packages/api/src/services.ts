import {
  matchLine,
  parseList,
  priceQuote,
  type Confidence,
  type Product,
  type Tier,
} from '@yardline/core';
import { ApiError, many, one, type Db } from './db.ts';
import type { EventBus, QuoteEvent } from './events.ts';

export interface User {
  id: string;
  name: string;
  email: string;
  title: string;
  role: 'rep' | 'manager';
  branchId: string;
}

export interface Ctx {
  db: Db;
  events: EventBus;
  now: () => Date;
  /** Random id with a prefix, e.g. q_8f2k3... */
  id: (prefix: string) => string;
  /** Unguessable token for share links. */
  token: () => string;
  catalog: () => Promise<Product[]>;
}

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'ordered';

const SHARE_DAYS = 30;

// ---------------------------------------------------------------------------------------
// Helpers

function randomId(bytes = 12): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(a, (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
}

export function defaultIds() {
  return {
    id: (prefix: string) => `${prefix}_${randomId(10)}`,
    token: () => {
      const a = crypto.getRandomValues(new Uint8Array(24));
      return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
  };
}

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function catalogLoader(db: Db): () => Promise<Product[]> {
  let cached: Promise<Product[]> | null = null;
  return () => {
    cached ??= many<{ data: Product }>(db, 'SELECT data FROM products WHERE active ORDER BY id').then((rows) => rows.map((r) => r.data));
    return cached;
  };
}

type Emit = (e: Omit<QuoteEvent, 'at'>) => Promise<void>;

/** Runs fn in a transaction, records events in quote_events, and publishes them after commit. */
async function inTx<T>(ctx: Ctx, fn: (tx: Db, emit: Emit) => Promise<T>): Promise<T> {
  const pending: QuoteEvent[] = [];
  const result = await ctx.db.transaction(async (tx) => {
    const emit: Emit = async (e) => {
      const at = ctx.now().toISOString();
      await tx.query('INSERT INTO quote_events (quote_id, at, actor, kind, version, detail) VALUES ($1, $2, $3, $4, $5, $6)', [
        e.quoteId, at, e.actor, e.kind, e.version, JSON.stringify(e.detail ?? {}),
      ]);
      pending.push({ ...e, at });
    };
    return fn(tx, emit);
  });
  for (const e of pending) ctx.events.publish(e);
  return result;
}

async function nextNumber(tx: Db, name: string): Promise<number> {
  const r = await one<{ value: number }>(
    tx,
    'INSERT INTO counters (name, value) VALUES ($1, 1) ON CONFLICT (name) DO UPDATE SET value = counters.value + 1 RETURNING value',
    [name],
  );
  return r!.value;
}

// ---------------------------------------------------------------------------------------
// Rows and DTOs

interface QuoteRow {
  id: string;
  number: string;
  status: QuoteStatus;
  version: number;
  job_name: string;
  customer_id: string;
  customer_name: string;
  customer_tier: Tier;
  customer_contact: string;
  customer_email: string;
  rep_id: string;
  rep_name: string;
  rep_email: string;
  branch_id: string;
  branch_name: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  board_feet: number;
  needs_approval: boolean;
  approved_version: number | null;
  approved_by_name: string | null;
  share_token_hash: string | null;
  decline_reason: string | null;
  accepted_by_name: string | null;
  created_at: Date;
  updated_at: Date;
  sent_at: Date | null;
  accepted_at: Date | null;
  valid_until: Date | null;
  order_id: string | null;
  order_number: string | null;
}

const QUOTE_SELECT = /* sql */ `
  SELECT q.id, q.number, q.status, q.version, q.job_name,
         q.customer_id, c.name AS customer_name, c.tier AS customer_tier, c.contact_name AS customer_contact, c.email AS customer_email,
         q.rep_id, u.name AS rep_name, u.email AS rep_email,
         q.branch_id, b.name AS branch_name,
         q.subtotal_cents, q.tax_cents, q.total_cents, q.board_feet::float8 AS board_feet,
         q.needs_approval, q.approved_version, a.name AS approved_by_name, q.share_token_hash,
         q.decline_reason, q.accepted_by_name,
         q.created_at, q.updated_at, q.sent_at, q.accepted_at, q.valid_until,
         o.id AS order_id, o.number AS order_number
    FROM quotes q
    JOIN customers c ON c.id = q.customer_id
    JOIN users u ON u.id = q.rep_id
    JOIN branches b ON b.id = q.branch_id
    LEFT JOIN users a ON a.id = q.approved_by
    LEFT JOIN orders o ON o.quote_id = q.id`;

function summary(r: QuoteRow) {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    version: r.version,
    jobName: r.job_name,
    customer: { id: r.customer_id, name: r.customer_name, tier: r.customer_tier, contact: r.customer_contact, email: r.customer_email },
    rep: { id: r.rep_id, name: r.rep_name, email: r.rep_email },
    branch: { id: r.branch_id, name: r.branch_name },
    subtotalCents: r.subtotal_cents,
    taxCents: r.tax_cents,
    totalCents: r.total_cents,
    boardFeet: r.board_feet,
    needsApproval: r.needs_approval,
    approved: r.needs_approval ? r.approved_version === r.version : true,
    approvedByName: r.approved_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    sentAt: r.sent_at,
    acceptedAt: r.accepted_at,
    acceptedByName: r.accepted_by_name,
    declineReason: r.decline_reason,
    validUntil: r.valid_until,
    order: r.order_id ? { id: r.order_id, number: r.order_number } : null,
  };
}
export type QuoteSummary = ReturnType<typeof summary>;

interface LineRow {
  position: number;
  product_id: string;
  name: string;
  uom: string;
  category: string;
  qty: number;
  raw_text: string | null;
  list_unit_cents: number;
  tier_bp: number;
  volume_bp: number;
  extra_bp: number;
  net_unit_cents: number;
  line_total_cents: number;
  approval_reasons: string[];
  available: number | null;
}

function lineDto(r: LineRow) {
  return {
    position: r.position,
    productId: r.product_id,
    name: r.name,
    uom: r.uom,
    category: r.category,
    qty: r.qty,
    rawText: r.raw_text,
    listUnitCents: r.list_unit_cents,
    tierBp: r.tier_bp,
    volumeBp: r.volume_bp,
    extraBp: r.extra_bp,
    discountBp: r.tier_bp + r.volume_bp + r.extra_bp,
    netUnitCents: r.net_unit_cents,
    lineTotalCents: r.line_total_cents,
    approvalReasons: r.approval_reasons,
    available: r.available,
  };
}
export type QuoteLine = ReturnType<typeof lineDto>;

async function loadQuoteRow(db: Db, id: string, lock = false): Promise<QuoteRow> {
  const row = await one<QuoteRow>(db, `${QUOTE_SELECT} WHERE q.id = $1`, [id]);
  if (!row) throw new ApiError(404, 'not_found', `No quote ${id}`);
  if (lock) await db.query('SELECT 1 FROM quotes WHERE id = $1 FOR UPDATE', [id]);
  return row;
}

async function loadLines(db: Db, quoteId: string, branchId: string): Promise<QuoteLine[]> {
  const rows = await many<LineRow>(
    db,
    `SELECT l.position, l.product_id, p.name, p.uom, p.category, l.qty, l.raw_text, l.list_unit_cents,
            l.tier_bp, l.volume_bp, l.extra_bp, l.net_unit_cents, l.line_total_cents, l.approval_reasons,
            (i.on_hand - i.reserved) AS available
       FROM quote_lines l
       JOIN products p ON p.id = l.product_id
       LEFT JOIN inventory i ON i.product_id = l.product_id AND i.branch_id = $2
      WHERE l.quote_id = $1
      ORDER BY l.position`,
    [quoteId, branchId],
  );
  return rows.map(lineDto);
}

// ---------------------------------------------------------------------------------------
// Reads

export async function listQuotes(ctx: Ctx, opts: { status?: QuoteStatus; q?: string } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    params.push(opts.status);
    where.push(`q.status = $${params.length}`);
  }
  if (opts.q) {
    params.push(`%${opts.q.toLowerCase()}%`);
    where.push(`(lower(q.number) LIKE $${params.length} OR lower(c.name) LIKE $${params.length} OR lower(q.job_name) LIKE $${params.length})`);
  }
  const rows = await many<QuoteRow>(ctx.db, `${QUOTE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY q.updated_at DESC LIMIT 200`, params);
  return rows.map(summary);
}

export async function getQuote(ctx: Ctx, id: string) {
  const row = await loadQuoteRow(ctx.db, id);
  const [lines, events] = await Promise.all([
    loadLines(ctx.db, id, row.branch_id),
    many<{ id: number; at: Date; actor: string; actor_name: string | null; kind: string; version: number; detail: Record<string, unknown> }>(
      ctx.db,
      `SELECT e.id::int AS id, e.at, e.actor, u.name AS actor_name, e.kind, e.version, e.detail
         FROM quote_events e LEFT JOIN users u ON u.id = e.actor
        WHERE e.quote_id = $1 ORDER BY e.id DESC LIMIT 100`,
      [id],
    ),
  ]);
  return {
    ...summary(row),
    shareActive: row.share_token_hash !== null,
    lines,
    events: events.map((e) => ({
      id: e.id,
      at: e.at,
      actor: e.actor_name ?? (e.actor === 'customer' ? row.customer_contact : e.actor),
      kind: e.kind,
      version: e.version,
      detail: e.detail,
    })),
  };
}
export type QuoteDetail = Awaited<ReturnType<typeof getQuote>>;

export async function listCustomers(ctx: Ctx) {
  return many<{ id: string; name: string; contactName: string; email: string; phone: string | null; tier: Tier; branchId: string }>(
    ctx.db,
    'SELECT id, name, contact_name AS "contactName", email, phone, tier, branch_id AS "branchId" FROM customers ORDER BY name',
  );
}

export async function listUsers(ctx: Ctx) {
  return many<User>(ctx.db, 'SELECT id, name, email, title, role, branch_id AS "branchId" FROM users ORDER BY role DESC, name');
}

export async function searchCatalog(ctx: Ctx, opts: { q?: string; category?: string; branchId: string; limit?: number }) {
  const params: unknown[] = [opts.branchId];
  const where = ['p.active'];
  let order = 'p.category, p.name';
  if (opts.category) {
    params.push(opts.category);
    where.push(`p.category = $${params.length}`);
  }
  if (opts.q && opts.q.trim()) {
    params.push(opts.q.trim());
    const i = params.length;
    where.push(`(p.name ILIKE '%' || $${i} || '%' OR p.id ILIKE '%' || $${i} || '%' OR word_similarity($${i}, p.name) > 0.3)`);
    order = `word_similarity($${i}, p.name) DESC, p.name`;
  }
  params.push(opts.limit ?? 200);
  return many<{ id: string; name: string; category: string; uom: string; priceCents: number; available: number; onHand: number; reserved: number }>(
    ctx.db,
    `SELECT p.id, p.name, p.category, p.uom, p.price_cents AS "priceCents",
            COALESCE(i.on_hand - i.reserved, 0) AS available, COALESCE(i.on_hand, 0) AS "onHand", COALESCE(i.reserved, 0) AS reserved
       FROM products p LEFT JOIN inventory i ON i.product_id = p.id AND i.branch_id = $1
      WHERE ${where.join(' AND ')}
      ORDER BY ${order}
      LIMIT $${params.length}`,
    params,
  );
}

/** Parse a pasted list and propose catalog matches. Nothing is saved. */
export async function parseText(ctx: Ctx, text: string, branchId: string) {
  if (text.length > 20_000) throw new ApiError(413, 'too_large', 'Paste at most 20,000 characters at a time');
  const catalog = await ctx.catalog();
  const stock = new Map(
    (await many<{ product_id: string; available: number }>(ctx.db, 'SELECT product_id, on_hand - reserved AS available FROM inventory WHERE branch_id = $1', [branchId])).map((r) => [r.product_id, r.available]),
  );
  const lite = (p: Product) => ({ id: p.id, name: p.name, uom: p.uom, category: p.category, priceCents: p.priceCents, available: stock.get(p.id) ?? 0 });
  return parseList(text).slice(0, 200).map((line) => {
    const m = matchLine(line, catalog);
    return {
      raw: line.raw,
      qty: m.qty,
      confidence: m.confidence as Confidence,
      notes: m.notes,
      best: m.best ? lite(m.best.product) : null,
      candidates: m.candidates.map((c) => ({ product: lite(c.product), score: c.score, reasons: c.reasons })),
    };
  });
}

// ---------------------------------------------------------------------------------------
// Writes

export async function createQuote(ctx: Ctx, user: User, input: { customerId: string; jobName?: string }) {
  const id = ctx.id('q');
  await inTx(ctx, async (tx, emit) => {
    const customer = await one<{ id: string; branch_id: string }>(tx, 'SELECT id, branch_id FROM customers WHERE id = $1', [input.customerId]);
    if (!customer) throw new ApiError(404, 'not_found', 'No such customer');
    const year = ctx.now().getUTCFullYear();
    const n = await nextNumber(tx, `quote-${year}`);
    const now = ctx.now().toISOString();
    await tx.query(
      `INSERT INTO quotes (id, number, customer_id, rep_id, branch_id, status, version, job_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'draft', 1, $6, $7, $7)`,
      [id, `Q-${year}-${String(n).padStart(4, '0')}`, customer.id, user.id, user.branchId, input.jobName ?? '', now],
    );
    await emit({ quoteId: id, kind: 'created', version: 1, actor: user.id });
  });
  return getQuote(ctx, id);
}

export interface LineInput {
  productId: string;
  qty: number;
  extraDiscountBp?: number;
  rawText?: string | null;
}

/**
 * Replace a quote's lines. The caller sends the version it was looking at; if someone else
 * saved in the meantime the write is refused with 409 and nothing changes.
 */
export async function saveLines(ctx: Ctx, user: User, quoteId: string, input: { version: number; lines: LineInput[]; jobName?: string }) {
  await inTx(ctx, async (tx, emit) => {
    await tx.query('SELECT 1 FROM quotes WHERE id = $1 FOR UPDATE', [quoteId]);
    const q = await loadQuoteRow(tx, quoteId);
    if (q.version !== input.version) {
      throw new ApiError(409, 'version_conflict', `This quote was changed by someone else (you had v${input.version}, it is now v${q.version}). Reload to see their changes.`, { currentVersion: q.version });
    }
    if (q.status !== 'draft' && q.status !== 'sent') throw new ApiError(409, 'locked', `A ${q.status} quote can't be edited`);
    const catalog = new Map((await ctx.catalog()).map((p) => [p.id, p]));
    const inputs = input.lines.map((l) => {
      const product = catalog.get(l.productId);
      if (!product) throw new ApiError(400, 'unknown_product', `Unknown product ${l.productId}`);
      return { product, qty: l.qty, extraDiscountBp: l.extraDiscountBp ?? 0 };
    });
    let priced;
    try {
      priced = priceQuote(inputs, q.customer_tier);
    } catch (e) {
      throw new ApiError(400, 'invalid_line', (e as Error).message);
    }
    await tx.query('DELETE FROM quote_lines WHERE quote_id = $1', [quoteId]);
    for (const [i, l] of priced.lines.entries()) {
      await tx.query(
        `INSERT INTO quote_lines (quote_id, position, product_id, qty, raw_text, list_unit_cents, tier_bp, volume_bp, extra_bp, net_unit_cents, line_total_cents, approval_reasons)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [quoteId, i + 1, l.productId, l.qty, input.lines[i]!.rawText ?? null, l.listUnitCents, l.tierBp, l.volumeBp, l.extraBp, l.netUnitCents, l.lineTotalCents, JSON.stringify(l.approvalReasons)],
      );
    }
    const version = q.version + 1;
    await tx.query(
      `UPDATE quotes SET version = $2, subtotal_cents = $3, tax_cents = $4, total_cents = $5, board_feet = $6,
              needs_approval = $7, job_name = COALESCE($8, job_name), updated_at = $9
        WHERE id = $1`,
      [quoteId, version, priced.subtotalCents, priced.taxCents, priced.totalCents, priced.boardFeet, priced.needsApproval, input.jobName ?? null, ctx.now().toISOString()],
    );
    await emit({ quoteId, kind: 'lines_updated', version, actor: user.id, detail: { lines: priced.lines.length, totalCents: priced.totalCents } });
  });
  return getQuote(ctx, quoteId);
}

export async function approveQuote(ctx: Ctx, user: User, quoteId: string, version: number) {
  if (user.role !== 'manager') throw new ApiError(403, 'forbidden', 'Only a manager can approve pricing');
  await inTx(ctx, async (tx, emit) => {
    await tx.query('SELECT 1 FROM quotes WHERE id = $1 FOR UPDATE', [quoteId]);
    const q = await loadQuoteRow(tx, quoteId);
    if (q.version !== version) throw new ApiError(409, 'version_conflict', 'The quote changed; review the latest version before approving', { currentVersion: q.version });
    if (!q.needs_approval) throw new ApiError(409, 'not_needed', 'This quote does not need approval');
    await tx.query('UPDATE quotes SET approved_version = $2, approved_by = $3, updated_at = $4 WHERE id = $1', [quoteId, version, user.id, ctx.now().toISOString()]);
    await emit({ quoteId, kind: 'approved', version, actor: user.id });
  });
  return getQuote(ctx, quoteId);
}

/** Send (or re-send) a quote. Returns a fresh share token; only its hash is stored. */
export async function sendQuote(ctx: Ctx, user: User, quoteId: string, version: number) {
  const token = ctx.token();
  const hash = await sha256(token);
  await inTx(ctx, async (tx, emit) => {
    await tx.query('SELECT 1 FROM quotes WHERE id = $1 FOR UPDATE', [quoteId]);
    const q = await loadQuoteRow(tx, quoteId);
    if (q.version !== version) throw new ApiError(409, 'version_conflict', 'The quote changed; review it before sending', { currentVersion: q.version });
    if (q.status !== 'draft' && q.status !== 'sent') throw new ApiError(409, 'locked', `A ${q.status} quote can't be sent`);
    const { rows } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM quote_lines WHERE quote_id = $1', [quoteId]);
    if (!rows[0]!.n) throw new ApiError(409, 'empty', 'Add at least one line before sending');
    if (q.needs_approval && q.approved_version !== q.version) throw new ApiError(409, 'needs_approval', 'Pricing on this quote needs a manager to approve it first');
    const now = ctx.now();
    const validUntil = new Date(now.getTime() + SHARE_DAYS * 86_400_000);
    await tx.query(
      `UPDATE quotes SET status = 'sent', share_token_hash = $2, sent_at = COALESCE(sent_at, $3), valid_until = $4, updated_at = $3 WHERE id = $1`,
      [quoteId, hash, now.toISOString(), validUntil.toISOString()],
    );
    await emit({ quoteId, kind: 'sent', version, actor: user.id });
  });
  return { token, quote: await getQuote(ctx, quoteId) };
}

async function quoteIdForToken(db: Db, token: string): Promise<string> {
  const row = await one<{ id: string }>(db, 'SELECT id FROM quotes WHERE share_token_hash = $1', [await sha256(token)]);
  if (!row) throw new ApiError(404, 'not_found', 'This link is not valid. Ask your rep for a new one.');
  return row.id;
}

/** What the customer sees: no costs, no internal notes. */
export async function getShared(ctx: Ctx, token: string, opts: { recordView?: boolean } = {}) {
  const quoteId = await quoteIdForToken(ctx.db, token);
  const q = await loadQuoteRow(ctx.db, quoteId);
  if (opts.recordView) {
    const last = await one<{ kind: string; at: Date }>(ctx.db, 'SELECT kind, at FROM quote_events WHERE quote_id = $1 ORDER BY id DESC LIMIT 1', [quoteId]);
    const recent = last?.kind === 'viewed' && ctx.now().getTime() - new Date(last.at).getTime() < 10 * 60_000;
    if (!recent) await inTx(ctx, (_tx, emit) => emit({ quoteId, kind: 'viewed', version: q.version, actor: 'customer' }));
  }
  const lines = await loadLines(ctx.db, quoteId, q.branch_id);
  const expired = q.valid_until !== null && ctx.now() > new Date(q.valid_until);
  return {
    number: q.number,
    status: q.status,
    version: q.version,
    jobName: q.job_name,
    expired,
    customer: { name: q.customer_name, contact: q.customer_contact },
    rep: { name: q.rep_name, email: q.rep_email },
    branch: q.branch_name,
    sentAt: q.sent_at,
    validUntil: q.valid_until,
    acceptedAt: q.accepted_at,
    acceptedByName: q.accepted_by_name,
    updatedAt: q.updated_at,
    subtotalCents: q.subtotal_cents,
    taxCents: q.tax_cents,
    totalCents: q.total_cents,
    lines: lines.map((l) => ({ position: l.position, name: l.name, uom: l.uom, qty: l.qty, discountBp: l.discountBp, netUnitCents: l.netUnitCents, lineTotalCents: l.lineTotalCents })),
  };
}
export type SharedQuote = Awaited<ReturnType<typeof getShared>>;

export async function acceptShared(ctx: Ctx, token: string, input: { version: number; name: string }) {
  const quoteId = await quoteIdForToken(ctx.db, token);
  await inTx(ctx, async (tx, emit) => {
    await tx.query('SELECT 1 FROM quotes WHERE id = $1 FOR UPDATE', [quoteId]);
    const q = await loadQuoteRow(tx, quoteId);
    if (q.status !== 'sent') throw new ApiError(409, 'not_open', q.status === 'accepted' || q.status === 'ordered' ? 'This quote is already accepted' : `This quote is ${q.status}`);
    if (q.valid_until && ctx.now() > new Date(q.valid_until)) throw new ApiError(410, 'expired', 'This quote has expired. Ask your rep to re-issue it.');
    if (q.version !== input.version) {
      throw new ApiError(409, 'version_conflict', 'Your rep just updated this quote. Review the new version, then accept.', { currentVersion: q.version });
    }
    await tx.query(`UPDATE quotes SET status = 'accepted', accepted_at = $2, accepted_by_name = $3, updated_at = $2 WHERE id = $1`, [quoteId, ctx.now().toISOString(), input.name]);
    await emit({ quoteId, kind: 'accepted', version: q.version, actor: 'customer', detail: { name: input.name } });
  });
  return getShared(ctx, token);
}

export async function declineShared(ctx: Ctx, token: string, input: { reason: string }) {
  const quoteId = await quoteIdForToken(ctx.db, token);
  await inTx(ctx, async (tx, emit) => {
    await tx.query('SELECT 1 FROM quotes WHERE id = $1 FOR UPDATE', [quoteId]);
    const q = await loadQuoteRow(tx, quoteId);
    if (q.status !== 'sent') throw new ApiError(409, 'not_open', `This quote is ${q.status}`);
    await tx.query(`UPDATE quotes SET status = 'declined', decline_reason = $2, updated_at = $3 WHERE id = $1`, [quoteId, input.reason, ctx.now().toISOString()]);
    await emit({ quoteId, kind: 'declined', version: q.version, actor: 'customer', detail: { reason: input.reason } });
  });
  return getShared(ctx, token);
}

/**
 * Turn an accepted quote into an order and reserve the stock. Safe to retry: the same
 * Idempotency-Key returns the same order. Inventory rows are locked in a fixed order so two
 * concurrent orders for the same SKUs serialize instead of deadlocking or overselling.
 */
export async function createOrder(ctx: Ctx, user: User, quoteId: string, idempotencyKey: string) {
  if (!/^[\w-]{8,100}$/.test(idempotencyKey)) throw new ApiError(400, 'bad_idempotency_key', 'Idempotency-Key must be 8-100 letters, digits, - or _');
  const scope = `order:${quoteId}`;
  return inTx(ctx, async (tx, emit) => {
    // Lock first, then look up the key: concurrent retries queue on the lock and then see the
    // first attempt's committed key, so they all get the same order back.
    await tx.query('SELECT 1 FROM quotes WHERE id = $1 FOR UPDATE', [quoteId]);
    const prior = await one<{ scope: string; status: number; response: { orderId: string } }>(tx, 'SELECT scope, status, response FROM idempotency_keys WHERE key = $1', [idempotencyKey]);
    if (prior) {
      if (prior.scope !== scope) throw new ApiError(422, 'idempotency_key_reused', 'This Idempotency-Key was used for a different request');
      return { replayed: true, orderId: prior.response.orderId };
    }
    const q = await loadQuoteRow(tx, quoteId);
    if (q.status === 'ordered') throw new ApiError(409, 'already_ordered', `Already ordered as ${q.order_number}`, { orderId: q.order_id });
    if (q.status !== 'accepted') throw new ApiError(409, 'not_accepted', 'Only an accepted quote can become an order');
    const lines = await many<{ position: number; product_id: string; qty: number; net_unit_cents: number; line_total_cents: number }>(
      tx,
      'SELECT position, product_id, qty, net_unit_cents, line_total_cents FROM quote_lines WHERE quote_id = $1 ORDER BY position',
      [quoteId],
    );
    const need = new Map<string, number>();
    for (const l of lines) need.set(l.product_id, (need.get(l.product_id) ?? 0) + l.qty);
    const ids = [...need.keys()].sort();
    const stock = await many<{ product_id: string; name: string; on_hand: number; reserved: number }>(
      tx,
      `SELECT i.product_id, p.name, i.on_hand, i.reserved FROM inventory i JOIN products p ON p.id = i.product_id
        WHERE i.branch_id = $1 AND i.product_id = ANY($2::text[]) ORDER BY i.product_id FOR UPDATE OF i`,
      [q.branch_id, ids],
    );
    const byId = new Map(stock.map((s) => [s.product_id, s]));
    const short = ids
      .map((id) => {
        const s = byId.get(id);
        const available = s ? s.on_hand - s.reserved : 0;
        return { productId: id, name: s?.name ?? id, needed: need.get(id)!, available };
      })
      .filter((s) => s.available < s.needed);
    if (short.length) throw new ApiError(409, 'insufficient_stock', `Not enough stock at ${q.branch_name} for ${short.length} item${short.length > 1 ? 's' : ''}`, { short });

    for (const id of ids) {
      await tx.query('UPDATE inventory SET reserved = reserved + $3 WHERE product_id = $1 AND branch_id = $2', [id, q.branch_id, need.get(id)]);
    }
    const orderId = ctx.id('so');
    const year = ctx.now().getUTCFullYear();
    const n = await nextNumber(tx, `order-${year}`);
    const now = ctx.now().toISOString();
    await tx.query(
      `INSERT INTO orders (id, number, quote_id, customer_id, branch_id, status, total_cents, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8)`,
      [orderId, `SO-${year}-${String(n).padStart(5, '0')}`, quoteId, q.customer_id, q.branch_id, q.total_cents, user.id, now],
    );
    for (const l of lines) {
      await tx.query('INSERT INTO order_lines (order_id, position, product_id, qty, net_unit_cents, line_total_cents) VALUES ($1, $2, $3, $4, $5, $6)', [
        orderId, l.position, l.product_id, l.qty, l.net_unit_cents, l.line_total_cents,
      ]);
    }
    await tx.query(`UPDATE quotes SET status = 'ordered', updated_at = $2 WHERE id = $1`, [quoteId, now]);
    await tx.query('INSERT INTO idempotency_keys (key, scope, status, response, created_at) VALUES ($1, $2, 201, $3, $4)', [idempotencyKey, scope, JSON.stringify({ orderId }), now]);
    await emit({ quoteId, kind: 'ordered', version: q.version, actor: user.id, detail: { orderId } });
    return { replayed: false, orderId };
  });
}

export async function listOrders(ctx: Ctx) {
  return many<{ id: string; number: string; status: string; totalCents: number; createdAt: Date; customerName: string; quoteId: string; quoteNumber: string; branchName: string; lineCount: number }>(
    ctx.db,
    `SELECT o.id, o.number, o.status, o.total_cents AS "totalCents", o.created_at AS "createdAt", c.name AS "customerName",
            q.id AS "quoteId", q.number AS "quoteNumber", b.name AS "branchName",
            (SELECT count(*)::int FROM order_lines l WHERE l.order_id = o.id) AS "lineCount"
       FROM orders o JOIN customers c ON c.id = o.customer_id JOIN quotes q ON q.id = o.quote_id JOIN branches b ON b.id = o.branch_id
      ORDER BY o.created_at DESC LIMIT 200`,
  );
}

export async function getOrder(ctx: Ctx, id: string) {
  const o = await one<{ id: string; number: string; status: string; totalCents: number; createdAt: Date; customerName: string; quoteId: string; quoteNumber: string; branchName: string; createdBy: string }>(
    ctx.db,
    `SELECT o.id, o.number, o.status, o.total_cents AS "totalCents", o.created_at AS "createdAt", c.name AS "customerName",
            q.id AS "quoteId", q.number AS "quoteNumber", b.name AS "branchName", u.name AS "createdBy"
       FROM orders o JOIN customers c ON c.id = o.customer_id JOIN quotes q ON q.id = o.quote_id
       JOIN branches b ON b.id = o.branch_id JOIN users u ON u.id = o.created_by
      WHERE o.id = $1`,
    [id],
  );
  if (!o) throw new ApiError(404, 'not_found', `No order ${id}`);
  const lines = await many<{ position: number; productId: string; name: string; uom: string; qty: number; netUnitCents: number; lineTotalCents: number }>(
    ctx.db,
    `SELECT l.position, l.product_id AS "productId", p.name, p.uom, l.qty, l.net_unit_cents AS "netUnitCents", l.line_total_cents AS "lineTotalCents"
       FROM order_lines l JOIN products p ON p.id = l.product_id WHERE l.order_id = $1 ORDER BY l.position`,
    [id],
  );
  return { ...o, lines };
}

export async function metrics(ctx: Ctx) {
  const now = ctx.now().toISOString();
  const counts = await many<{ status: QuoteStatus; n: number; value: number }>(ctx.db, 'SELECT status, count(*)::int AS n, COALESCE(sum(total_cents), 0)::float8 AS value FROM quotes GROUP BY status');
  const send = await one<{ median: number | null; p90: number | null; n: number }>(
    ctx.db,
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM sent_at - created_at) / 60) AS median,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM sent_at - created_at) / 60) AS p90,
            count(*)::int AS n
       FROM quotes WHERE sent_at IS NOT NULL AND created_at > $1::timestamptz - interval '30 days'`,
    [now],
  );
  const daily = await many<{ day: string; created: number; won: number }>(
    ctx.db,
    `SELECT to_char(d, 'YYYY-MM-DD') AS day,
            (SELECT count(*)::int FROM quotes q WHERE q.created_at >= d AND q.created_at < d + interval '1 day') AS created,
            (SELECT count(*)::int FROM quotes q WHERE q.accepted_at >= d AND q.accepted_at < d + interval '1 day') AS won
       FROM generate_series(date_trunc('day', $1::timestamptz) - interval '13 days', date_trunc('day', $1::timestamptz), interval '1 day') AS d
      ORDER BY d`,
    [now],
  );
  const by = Object.fromEntries(counts.map((c) => [c.status, c])) as Partial<Record<QuoteStatus, { n: number; value: number }>>;
  const n = (s: QuoteStatus) => by[s]?.n ?? 0;
  const won = n('accepted') + n('ordered');
  const decided = won + n('declined');
  return {
    counts: { draft: n('draft'), sent: n('sent'), accepted: n('accepted'), declined: n('declined'), ordered: n('ordered') },
    openValueCents: (by.sent?.value ?? 0) + (by.draft?.value ?? 0),
    wonValueCents: (by.accepted?.value ?? 0) + (by.ordered?.value ?? 0),
    winRate: decided ? won / decided : null,
    minutesToSend: { median: send?.median ?? null, p90: send?.p90 ?? null, quotes: send?.n ?? 0 },
    daily,
  };
}
