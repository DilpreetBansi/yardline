import { beforeAll, describe, expect, it } from 'vitest';
import type { QuoteEvent } from '../src/events.ts';
import { harness, quoteFromList, type Harness } from './helpers.ts';

let h: Harness;
beforeAll(async () => {
  h = await harness();
}, 60_000);

const DECK = "PT 4x4x10 - 6\n2x8x12 pressure treated x 14\n2x8 joist hangers (14)\n10 bags concrete 30kg";

describe('auth', () => {
  it('needs a staff user for internal routes', async () => {
    expect((await h.call('GET', '/api/quotes', undefined, { user: null })).status).toBe(401);
    expect((await h.call('GET', '/api/quotes', undefined, { user: 'u_nobody' })).status).toBe(401);
    expect((await h.call('GET', '/api/health', undefined, { user: null })).status).toBe(200);
  });

  it('returns JSON errors for unknown routes and bad bodies', async () => {
    const r = await h.call('GET', '/api/nope');
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe('not_found');
    const bad = await h.app.request('/api/quotes', { method: 'POST', headers: { 'x-yardline-user': 'u_maya' }, body: '{not json' });
    expect(bad.status).toBe(400);
    const invalid = await h.call('POST', '/api/quotes', { customerId: 42 });
    expect(invalid.status).toBe(400);
    expect(invalid.json.error.code).toBe('invalid');
  });
});

describe('quotes', () => {
  it('parses a pasted list into priced lines', async () => {
    const q = await quoteFromList(h, 'c_creditriver', DECK);
    expect(q.number).toMatch(/^Q-2026-\d{4}$/);
    expect(q.version).toBe(2);
    expect(q.lines.map((l: any) => [l.productId, l.qty])).toEqual([
      ['PST-PT-4X4-10', 6],
      ['LBR-PT-2X8-12', 14],
      ['HDW-HGR-2X8', 14],
      ['CON-REG-30', 10],
    ]);
    // Credit River Decks is a contractor: 8% off every line.
    expect(q.lines.every((l: any) => l.tierBp === 800)).toBe(true);
    const subtotal = q.lines.reduce((s: number, l: any) => s + l.lineTotalCents, 0);
    expect(q.subtotalCents).toBe(subtotal);
    expect(q.taxCents).toBe(Math.round(subtotal * 0.13));
    expect(q.totalCents).toBe(q.subtotalCents + q.taxCents);
    expect(q.events.map((e: any) => e.kind)).toEqual(['lines_updated', 'created']);
  });

  it('refuses a stale save instead of overwriting someone else', async () => {
    const q = await quoteFromList(h, 'c_maple', '40 2x4x8 SPF');
    const mine = await h.call('PUT', `/api/quotes/${q.id}/lines`, { version: q.version, lines: [{ productId: 'LBR-SPF-2X4-08', qty: 50 }] });
    expect(mine.status).toBe(200);
    const theirs = await h.call('PUT', `/api/quotes/${q.id}/lines`, { version: q.version, lines: [{ productId: 'LBR-SPF-2X4-08', qty: 10 }] }, { user: 'u_daniel' });
    expect(theirs.status).toBe(409);
    expect(theirs.json.error.code).toBe('version_conflict');
    expect(theirs.json.error.details.currentVersion).toBe(q.version + 1);
    const now = await h.call('GET', `/api/quotes/${q.id}`);
    expect(now.json.lines[0].qty).toBe(50);
  });

  it('rejects unknown products and bad quantities without changing anything', async () => {
    const q = await quoteFromList(h, 'c_maple', '40 2x4x8 SPF');
    const unknown = await h.call('PUT', `/api/quotes/${q.id}/lines`, { version: q.version, lines: [{ productId: 'NOPE', qty: 1 }] });
    expect(unknown.status).toBe(400);
    const zero = await h.call('PUT', `/api/quotes/${q.id}/lines`, { version: q.version, lines: [{ productId: 'LBR-SPF-2X4-08', qty: 0 }] });
    expect(zero.status).toBe(400);
    expect((await h.call('GET', `/api/quotes/${q.id}`)).json.version).toBe(q.version);
  });

  it('needs a manager when a discount goes past the rep limit', async () => {
    const q = await quoteFromList(h, 'c_northline', '10 bags concrete 30kg', (lines) => {
      lines[0].extraDiscountBp = 1500;
    });
    expect(q.needsApproval).toBe(true);
    expect(q.lines[0].approvalReasons.length).toBeGreaterThan(0);
    const send = await h.call('POST', `/api/quotes/${q.id}/send`, { version: q.version });
    expect(send.status).toBe(409);
    expect(send.json.error.code).toBe('needs_approval');
    expect((await h.call('POST', `/api/quotes/${q.id}/approve`, { version: q.version })).status).toBe(403);
    const approved = await h.call('POST', `/api/quotes/${q.id}/approve`, { version: q.version }, { user: 'u_sam' });
    expect(approved.status).toBe(200);
    expect(approved.json.approved).toBe(true);
    expect((await h.call('POST', `/api/quotes/${q.id}/send`, { version: q.version })).status).toBe(200);
  });

  it('drops the approval as soon as the lines change', async () => {
    const q = await quoteFromList(h, 'c_northline', '10 bags concrete 30kg', (lines) => {
      lines[0].extraDiscountBp = 1500;
    });
    await h.call('POST', `/api/quotes/${q.id}/approve`, { version: q.version }, { user: 'u_sam' });
    const edited = await h.call('PUT', `/api/quotes/${q.id}/lines`, { version: q.version, lines: [{ productId: 'CON-REG-30', qty: 12, extraDiscountBp: 1500 }] });
    expect(edited.json.approved).toBe(false);
    expect((await h.call('POST', `/api/quotes/${q.id}/send`, { version: edited.json.version })).json.error.code).toBe('needs_approval');
  });
});

describe('customer link', () => {
  it('shows the customer prices but not costs, and only works with the token', async () => {
    const q = await quoteFromList(h, 'c_halton', DECK);
    const sent = await h.call('POST', `/api/quotes/${q.id}/send`, { version: q.version });
    expect(sent.status).toBe(200);
    const token = sent.json.token as string;
    expect(token.length).toBeGreaterThanOrEqual(32);
    const view = await h.call('GET', `/api/share/${token}?view=1`, undefined, { user: null });
    expect(view.status).toBe(200);
    expect(view.json.totalCents).toBe(q.totalCents);
    expect(JSON.stringify(view.json)).not.toMatch(/cost|raw|approval|tier/i);
    expect((await h.call('GET', '/api/share/not-a-real-token', undefined, { user: null })).status).toBe(404);
    // The stored value is a hash, not the token.
    const stored = await h.ctx.db.query<{ share_token_hash: string }>('SELECT share_token_hash FROM quotes WHERE id = $1', [q.id]);
    expect(stored.rows[0]!.share_token_hash).not.toBe(token);
    expect(stored.rows[0]!.share_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records a view once per ten minutes', async () => {
    const q = await quoteFromList(h, 'c_halton', '12 sheets 1/2" plywood');
    const { json } = await h.call('POST', `/api/quotes/${q.id}/send`, { version: q.version });
    await h.call('GET', `/api/share/${json.token}?view=1`, undefined, { user: null });
    await h.call('GET', `/api/share/${json.token}?view=1`, undefined, { user: null });
    h.clock.advance(11 * 60_000);
    await h.call('GET', `/api/share/${json.token}?view=1`, undefined, { user: null });
    const events = (await h.call('GET', `/api/quotes/${q.id}`)).json.events.map((e: any) => e.kind);
    expect(events.filter((k: string) => k === 'viewed')).toHaveLength(2);
  });

  it('makes the customer accept the version they are looking at', async () => {
    const q = await quoteFromList(h, 'c_ridgeway', DECK);
    const { json } = await h.call('POST', `/api/quotes/${q.id}/send`, { version: q.version });
    // The rep edits after sending; the customer still has the old version open.
    const edited = await h.call('PUT', `/api/quotes/${q.id}/lines`, { version: json.quote.version, lines: [{ productId: 'CON-REG-30', qty: 20 }] });
    expect(edited.json.status).toBe('sent');
    const stale = await h.call('POST', `/api/share/${json.token}/accept`, { version: json.quote.version, name: 'Amrit Gill' }, { user: null });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('version_conflict');
    const ok = await h.call('POST', `/api/share/${json.token}/accept`, { version: edited.json.version, name: 'Amrit Gill' }, { user: null });
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe('accepted');
    expect(ok.json.acceptedByName).toBe('Amrit Gill');
    const locked = await h.call('PUT', `/api/quotes/${q.id}/lines`, { version: edited.json.version, lines: [] });
    expect(locked.json.error.code).toBe('locked');
    expect((await h.call('POST', `/api/share/${json.token}/accept`, { version: edited.json.version, name: 'Amrit Gill' }, { user: null })).status).toBe(409);
  });

  it('lets the customer decline with a reason', async () => {
    const q = await quoteFromList(h, 'c_birchwood', DECK);
    const { json } = await h.call('POST', `/api/quotes/${q.id}/send`, { version: q.version });
    const r = await h.call('POST', `/api/share/${json.token}/decline`, { reason: 'Job postponed' }, { user: null });
    expect(r.json.status).toBe('declined');
    expect((await h.call('GET', `/api/quotes/${q.id}`)).json.declineReason).toBe('Job postponed');
  });

  it('expires after 30 days', async () => {
    const q = await quoteFromList(h, 'c_nair', 'R20 batts 8');
    const { json } = await h.call('POST', `/api/quotes/${q.id}/send`, { version: q.version });
    h.clock.advance(31 * 86_400_000);
    const r = await h.call('POST', `/api/share/${json.token}/accept`, { version: json.quote.version, name: 'Priya Nair' }, { user: null });
    expect(r.status).toBe(410);
    h.clock.advance(-31 * 86_400_000);
  });
});

async function acceptedQuote(customerId: string, text: string) {
  const q = await quoteFromList(h, customerId, text);
  const { json } = await h.call('POST', `/api/quotes/${q.id}/send`, { version: q.version });
  await h.call('POST', `/api/share/${json.token}/accept`, { version: json.quote.version, name: 'Test' }, { user: null });
  return q;
}

async function stock(productId: string, branch = 'MSS') {
  const { rows } = await h.ctx.db.query<{ on_hand: number; reserved: number }>('SELECT on_hand, reserved FROM inventory WHERE product_id = $1 AND branch_id = $2', [productId, branch]);
  return rows[0]!;
}

describe('orders', () => {
  it('turns an accepted quote into an order and reserves the stock, once', async () => {
    const q = await acceptedQuote('c_creditriver', DECK);
    const before = await stock('LBR-PT-2X8-12');
    expect((await h.call('POST', `/api/quotes/${q.id}/order`)).json.error.code).toBe('idempotency_key_required');
    const first = await h.call('POST', `/api/quotes/${q.id}/order`, undefined, { headers: { 'idempotency-key': `order-${q.id}` } });
    expect(first.status).toBe(201);
    expect(first.json.order.number).toMatch(/^SO-2026-\d{5}$/);
    expect(first.json.order.lines).toHaveLength(4);
    expect(first.json.order.totalCents).toBe(q.totalCents);
    const after = await stock('LBR-PT-2X8-12');
    expect(after.reserved - before.reserved).toBe(14);
    // A network retry with the same key gets the same order back and reserves nothing more.
    const retry = await h.call('POST', `/api/quotes/${q.id}/order`, undefined, { headers: { 'idempotency-key': `order-${q.id}` } });
    expect(retry.status).toBe(200);
    expect(retry.json.replayed).toBe(true);
    expect(retry.json.order.id).toBe(first.json.order.id);
    expect((await stock('LBR-PT-2X8-12')).reserved).toBe(after.reserved);
    // A second, different attempt is refused.
    const again = await h.call('POST', `/api/quotes/${q.id}/order`, undefined, { headers: { 'idempotency-key': `other-${q.id}` } });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe('already_ordered');
  });

  it('refuses to reuse an idempotency key for a different quote', async () => {
    const a = await acceptedQuote('c_maple', '10 bags concrete 30kg');
    const b = await acceptedQuote('c_maple', '10 bags concrete 30kg');
    expect((await h.call('POST', `/api/quotes/${a.id}/order`, undefined, { headers: { 'idempotency-key': 'shared-key-123' } })).status).toBe(201);
    const r = await h.call('POST', `/api/quotes/${b.id}/order`, undefined, { headers: { 'idempotency-key': 'shared-key-123' } });
    expect(r.status).toBe(422);
  });

  it('refuses a short order without reserving any of it', async () => {
    // Only 12 of these at Mississauga.
    const q = await acceptedQuote('c_maple', '2x12x16 doug fir x 30\n40 2x4x8 SPF');
    const before = await stock('LBR-SPF-2X4-08');
    const r = await h.call('POST', `/api/quotes/${q.id}/order`, undefined, { headers: { 'idempotency-key': `short-${q.id}` } });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('insufficient_stock');
    expect(r.json.error.details.short).toEqual([{ productId: 'LBR-DF-2X12-16', name: expect.any(String), needed: 30, available: 12 }]);
    expect(await stock('LBR-SPF-2X4-08')).toEqual(before);
    expect((await h.call('GET', `/api/quotes/${q.id}`)).json.status).toBe('accepted');
  });

  it('only orders accepted quotes', async () => {
    const q = await quoteFromList(h, 'c_maple', '10 bags concrete 30kg');
    const r = await h.call('POST', `/api/quotes/${q.id}/order`, undefined, { headers: { 'idempotency-key': `draft-${q.id}` } });
    expect(r.json.error.code).toBe('not_accepted');
  });
});

describe('events', () => {
  it('publishes each change after it commits, in order', async () => {
    const seen: QuoteEvent[] = [];
    const off = h.ctx.events.subscribe((e) => seen.push(e));
    const q = await acceptedQuote('c_lakeshore', '12 sheets 1/2" plywood');
    await h.call('POST', `/api/quotes/${q.id}/order`, undefined, { headers: { 'idempotency-key': `ev-${q.id}` } });
    off();
    expect(seen.filter((e) => e.quoteId === q.id).map((e) => e.kind)).toEqual(['created', 'lines_updated', 'sent', 'accepted', 'ordered']);
  });

  it('publishes nothing when a transaction fails', async () => {
    const q = await quoteFromList(h, 'c_maple', '40 2x4x8 SPF');
    const seen: QuoteEvent[] = [];
    const off = h.ctx.events.subscribe((e) => seen.push(e));
    await h.call('PUT', `/api/quotes/${q.id}/lines`, { version: q.version, lines: [{ productId: 'NOPE', qty: 1 }] });
    off();
    expect(seen).toEqual([]);
  });
});

describe('catalog and reporting', () => {
  it('finds products by fuzzy name with pg_trgm', async () => {
    const r = await h.call('GET', '/api/catalog?q=douglas fir 2x10');
    expect(r.status).toBe(200);
    expect(r.json[0].id).toMatch(/^LBR-DF-2X10-/);
    expect(r.json[0]).toHaveProperty('available');
  });

  it('reports the pipeline', async () => {
    const r = await h.call('GET', '/api/metrics');
    expect(r.status).toBe(200);
    expect(r.json.counts.ordered).toBeGreaterThan(0);
    expect(r.json.daily).toHaveLength(14);
    expect(typeof r.json.minutesToSend.quotes).toBe('number');
  });

  it('lists orders newest first', async () => {
    const r = await h.call('GET', '/api/orders');
    expect(r.json.length).toBeGreaterThan(0);
    const times = r.json.map((o: any) => new Date(o.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});
