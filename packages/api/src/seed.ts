import { BRANCHES, buildCatalog, initialStock } from '@yardline/core';
import { ApiError, one, type Db } from './db.ts';
import { EventBus } from './events.ts';
import {
  acceptShared,
  approveQuote,
  catalogLoader,
  createOrder,
  createQuote,
  declineShared,
  parseText,
  saveLines,
  sendQuote,
  type Ctx,
  type User,
} from './services.ts';

export const CUSTOMERS = [
  { id: 'c_northline', name: 'Northline Framing Ltd.', contact: 'Jordan Reyes', email: 'jordan@northline.example', phone: '905-555-0142', tier: 'pro', branch: 'MSS' },
  { id: 'c_ridgeway', name: 'Ridgeway Custom Homes', contact: 'Amrit Gill', email: 'amrit@ridgeway.example', phone: '905-555-0188', tier: 'contractor', branch: 'BRM' },
  { id: 'c_maple', name: 'Maple & Stone Renovations', contact: 'Chloe Martin', email: 'chloe@maplestone.example', phone: '416-555-0119', tier: 'contractor', branch: 'MSS' },
  { id: 'c_creditriver', name: 'Credit River Decks', contact: 'Tom Kowalski', email: 'tom@creditriverdecks.example', phone: '905-555-0107', tier: 'contractor', branch: 'MSS' },
  { id: 'c_halton', name: 'Halton Basement Co.', contact: 'Fatima Qureshi', email: 'fatima@haltonbasement.example', phone: '289-555-0164', tier: 'contractor', branch: 'MSS' },
  { id: 'c_lakeshore', name: 'Lakeshore Builders Inc.', contact: 'Marcus Lee', email: 'marcus@lakeshorebuilders.example', phone: '416-555-0131', tier: 'pro', branch: 'BRM' },
  { id: 'c_birchwood', name: 'Birchwood Carpentry', contact: 'Elena Petrova', email: 'elena@birchwood.example', phone: '647-555-0175', tier: 'contractor', branch: 'BRM' },
  { id: 'c_nair', name: 'Priya Nair (homeowner)', contact: 'Priya Nair', email: 'priya.nair@example.com', phone: null, tier: 'retail', branch: 'MSS' },
] as const;

export const USERS: (User & { passwordHint?: string })[] = [
  { id: 'u_maya', name: 'Maya Chen', email: 'maya@yardline.test', title: 'Inside sales', role: 'rep', branchId: 'MSS' },
  { id: 'u_daniel', name: 'Daniel Ortiz', email: 'daniel@yardline.test', title: 'Inside sales', role: 'rep', branchId: 'BRM' },
  { id: 'u_sam', name: 'Sam Okafor', email: 'sam@yardline.test', title: 'Branch manager', role: 'manager', branchId: 'MSS' },
];

export const SAMPLE_LISTS: { job: string; text: string }[] = [
  {
    job: 'Backyard deck, 16x20',
    text: "PT 4x4x10 - 6\n2x8x12 pressure treated x 14\n2x6x16 PT x 30\n2x8 joist hangers (24)\n5 boxes 3\" deck screws\n10 bags concrete 30kg\n4x4 post base x 6",
  },
  {
    job: 'Basement finish',
    text: '2x4 studs 92-5/8 x 140\n1/2 drywall 4x8 x 90\n5/8 type x drywall 4x8 - 20 sheets\nR12 batts 10\ntwo rolls 6 mil poly\nconstruction adhesive x 12\n1-1/4" drywall screws 5 lb x 3',
  },
  {
    job: 'Detached garage framing',
    text: "2x6x16 SPF x 60\n40 2x4x8 SPF\n7/16 osb 4x8 x 64\n2x10 x 16 DF - 12\n3-1/4\" framing nails 30 lb x 2\nhurricane ties x40\nhouse wrap 1 roll",
  },
  {
    job: 'Addition subfloor',
    text: '3/4 T&G osb x 36\n2x10x14 doug fir x 22\nsubfloor adhesive x 18\n2x10 joist hangers x 22',
  },
  {
    job: 'Privacy fence, 80 ft',
    text: 'PT 4x4x8 - 20\n2x4x8 pressure treated x 40\nfast setting concrete 20 bags\n2-1/2" deck screws 5 lb x 2',
  },
  {
    job: 'Kitchen wall move',
    text: '1/2 drywall 4x12 x 16\n2x4x8 spf x 30\nconstruction adhesive x 6\n2x8x10 spf x 4',
  },
];

/** Catalog, branches, stock, customers and staff. Idempotent. */
export async function seedReference(db: Db): Promise<boolean> {
  const exists = await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM products');
  if (exists && exists.n > 0) return false;
  const catalog = buildCatalog();
  await db.transaction(async (tx) => {
    for (const b of BRANCHES) await tx.query('INSERT INTO branches (id, name) VALUES ($1, $2)', [b.id, b.name]);
    for (const p of catalog) {
      await tx.query('INSERT INTO products (id, name, category, uom, price_cents, cost_cents, data) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
        p.id, p.name, p.category, p.uom, p.priceCents, p.costCents, JSON.stringify(p),
      ]);
      for (const b of BRANCHES) {
        await tx.query('INSERT INTO inventory (product_id, branch_id, on_hand) VALUES ($1, $2, $3)', [p.id, b.id, initialStock(p, b.id)]);
      }
    }
    for (const c of CUSTOMERS) {
      await tx.query('INSERT INTO customers (id, name, contact_name, email, phone, tier, branch_id) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
        c.id, c.name, c.contact, c.email, c.phone, c.tier, c.branch,
      ]);
    }
    for (const u of USERS) {
      await tx.query('INSERT INTO users (id, name, email, title, role, branch_id) VALUES ($1, $2, $3, $4, $5, $6)', [u.id, u.name, u.email, u.title, u.role, u.branchId]);
    }
  });
  return true;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Plan = 'ordered' | 'accepted' | 'declined' | 'sent' | 'draft';
/** Oldest first: most old quotes closed one way or the other, the newest are still open. */
const PLAN: Plan[] = [
  'ordered', 'ordered', 'declined', 'ordered', 'accepted', 'ordered', 'ordered', 'declined', 'ordered', 'ordered',
  'ordered', 'accepted', 'ordered', 'declined', 'ordered', 'ordered', 'accepted', 'ordered', 'sent', 'ordered',
  'sent', 'accepted', 'sent', 'draft', 'sent', 'draft',
];

/**
 * Six weeks of believable history, generated through the same service functions the API
 * uses (so pricing, numbering, events and stock reservations are all real). Deterministic.
 */
export async function seedHistory(db: Db, today: Date, opts: { quotes?: number } = {}): Promise<void> {
  const exists = await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM quotes');
  if (exists && exists.n > 0) return;
  const rand = rng(20260927);
  let clock = new Date(today.getTime() - 44 * 86_400_000);
  let seq = 0;
  const ctx: Ctx = {
    db,
    events: new EventBus(),
    now: () => clock,
    id: (prefix) => `${prefix}_seed${String(++seq).padStart(4, '0')}`,
    token: () => `seed-token-${seq}-${Math.floor(rand() * 1e9)}`,
    catalog: catalogLoader(db),
  };
  const [maya, daniel, sam] = USERS as [User, User, User];
  const total = opts.quotes ?? 26;
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;

  for (let i = 0; i < total; i++) {
    const daysAgo = Math.round(44 - (i * 43) / total);
    const day = new Date(today.getTime() - daysAgo * 86_400_000);
    day.setUTCHours(12 + Math.floor(rand() * 8), Math.floor(rand() * 60), 0, 0);
    clock = day;
    const customer = pick(CUSTOMERS);
    const rep = customer.branch === 'BRM' ? daniel : maya;
    const sample = pick(SAMPLE_LISTS);
    const quote = await createQuote(ctx, rep, { customerId: customer.id, jobName: sample.job });
    const proposals = await parseText(ctx, sample.text, rep.branchId);
    const lines = proposals.filter((p) => p.best).map((p) => ({ productId: p.best!.id, qty: p.qty, rawText: p.raw, extraDiscountBp: 0 }));
    const bigDiscount = i % 9 === 4;
    if (bigDiscount) lines[0]!.extraDiscountBp = 1500;
    // Most quotes go out within minutes; a few sit for hours.
    const minutes = rand() < 0.85 ? 3 + Math.floor(rand() * 22) : 60 + Math.floor(rand() * 300);
    clock = new Date(clock.getTime() + Math.max(1, minutes - 2) * 60_000);
    let q = await saveLines(ctx, rep, quote.id, { version: quote.version, lines });
    const plan = PLAN[i % PLAN.length]!;
    if (plan === 'draft') continue;
    if (q.needsApproval) {
      clock = new Date(clock.getTime() + 60_000);
      q = await approveQuote(ctx, sam, q.id, q.version);
    }
    clock = new Date(clock.getTime() + 2 * 60_000);
    const sent = await sendQuote(ctx, rep, q.id, q.version);
    if (plan === 'sent') continue;
    clock = new Date(clock.getTime() + (2 + Math.floor(rand() * 40)) * 3_600_000);
    if (plan === 'declined') {
      await declineShared(ctx, sent.token, { reason: pick(['Went with another supplier', 'Job postponed to spring', 'Price on sheet goods']) });
      continue;
    }
    await acceptShared(ctx, sent.token, { version: sent.quote.version, name: customer.contact });
    if (plan === 'ordered') {
      clock = new Date(clock.getTime() + 30 * 60_000);
      try {
        await createOrder(ctx, rep, q.id, `seed-order-${q.id}`);
      } catch (e) {
        if (!(e instanceof ApiError && e.code === 'insufficient_stock')) throw e;
      }
    }
  }
}
