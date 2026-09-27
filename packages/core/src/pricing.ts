import { productBoardFeet, type Product } from './catalog.ts';
import { applyDiscount, percentOf, type Bp, type Cents } from './money.ts';

export type Tier = 'retail' | 'contractor' | 'pro';

export const TIER_DISCOUNT_BP: Record<Tier, Bp> = { retail: 0, contractor: 800, pro: 1200 };

export interface PricingPolicy {
  /** Ontario HST. */
  taxBp: Bp;
  /** A net price below cost + this margin needs a manager. */
  minMarginBp: Bp;
  /** The most a rep can discount a line on their own, on top of tier and volume. */
  repDiscountLimitBp: Bp;
  /** Extra discount on lumber once the quote reaches this many board feet. */
  lumberVolume: { boardFeet: number; bp: Bp };
  /** Extra discount on one sheet-good SKU at this many sheets. */
  sheetVolume: { sheets: number; bp: Bp };
}

export const DEFAULT_POLICY: PricingPolicy = {
  taxBp: 1300,
  minMarginBp: 1000,
  repDiscountLimitBp: 1000,
  lumberVolume: { boardFeet: 1000, bp: 300 },
  sheetVolume: { sheets: 50, bp: 200 },
};

export interface LineInput {
  product: Product;
  qty: number;
  /** Rep's own discount on this line, in basis points. */
  extraDiscountBp?: Bp;
}

export interface PricedLine {
  productId: string;
  qty: number;
  listUnitCents: Cents;
  tierBp: Bp;
  volumeBp: Bp;
  extraBp: Bp;
  discountBp: Bp;
  netUnitCents: Cents;
  lineTotalCents: Cents;
  boardFeet: number;
  /** Why a manager has to approve this line; empty when it can go out as is. */
  approvalReasons: string[];
}

export interface PricedQuote {
  lines: PricedLine[];
  subtotalCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
  boardFeet: number;
  needsApproval: boolean;
}

const LUMBER_CATEGORIES = new Set(['lumber', 'stud', 'post']);
const SHEET_CATEGORIES = new Set(['sheet', 'drywall']);

/**
 * Prices a quote. Discounts add up in basis points (tier + volume + rep), the net unit price
 * is rounded once, and the line total is exactly qty * net unit price, so the numbers on the
 * PDF always multiply out. Tax is rounded once on the subtotal.
 */
export function priceQuote(inputs: LineInput[], tier: Tier, policy: PricingPolicy = DEFAULT_POLICY): PricedQuote {
  for (const l of inputs) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new RangeError(`quantity must be a positive integer (${l.product.id}: ${l.qty})`);
    const extra = l.extraDiscountBp ?? 0;
    if (!Number.isInteger(extra) || extra < 0 || extra > 5000) throw new RangeError(`extra discount must be 0-5000 bp (${l.product.id}: ${extra})`);
  }
  const quoteBoardFeet = inputs.reduce((sum, l) => sum + productBoardFeet(l.product) * l.qty, 0);
  const sheetsBySku = new Map<string, number>();
  for (const l of inputs) {
    if (SHEET_CATEGORIES.has(l.product.category)) sheetsBySku.set(l.product.id, (sheetsBySku.get(l.product.id) ?? 0) + l.qty);
  }

  const lines = inputs.map((l): PricedLine => {
    const p = l.product;
    const tierBp = TIER_DISCOUNT_BP[tier];
    let volumeBp = 0;
    if (LUMBER_CATEGORIES.has(p.category) && quoteBoardFeet >= policy.lumberVolume.boardFeet) volumeBp = policy.lumberVolume.bp;
    if (SHEET_CATEGORIES.has(p.category) && (sheetsBySku.get(p.id) ?? 0) >= policy.sheetVolume.sheets) volumeBp = policy.sheetVolume.bp;
    const extraBp = l.extraDiscountBp ?? 0;
    const discountBp = Math.min(tierBp + volumeBp + extraBp, 10_000);
    const netUnitCents = applyDiscount(p.priceCents, discountBp);
    const reasons: string[] = [];
    if (extraBp > policy.repDiscountLimitBp) reasons.push(`Extra discount ${extraBp / 100}% is over the ${policy.repDiscountLimitBp / 100}% rep limit`);
    const floor = p.costCents + percentOf(p.costCents, policy.minMarginBp);
    if (netUnitCents < floor) reasons.push(`Net price is under cost + ${policy.minMarginBp / 100}%`);
    return {
      productId: p.id,
      qty: l.qty,
      listUnitCents: p.priceCents,
      tierBp,
      volumeBp,
      extraBp,
      discountBp,
      netUnitCents,
      lineTotalCents: netUnitCents * l.qty,
      boardFeet: productBoardFeet(p) * l.qty,
      approvalReasons: reasons,
    };
  });

  const subtotalCents = lines.reduce((s, l) => s + l.lineTotalCents, 0);
  const taxCents = percentOf(subtotalCents, policy.taxBp);
  return {
    lines,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    boardFeet: quoteBoardFeet,
    needsApproval: lines.some((l) => l.approvalReasons.length > 0),
  };
}
