import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildCatalog, productBoardFeet, type Product } from '../src/catalog.ts';
import { applyDiscount, divRound, percentOf } from '../src/money.ts';
import { DEFAULT_POLICY, priceQuote, TIER_DISCOUNT_BP, type Tier } from '../src/pricing.ts';
import { boardFeet, piecePriceFromMbf } from '../src/units.ts';

const catalog = buildCatalog();
const byId = (id: string) => {
  const p = catalog.find((x) => x.id === id);
  if (!p) throw new Error(id);
  return p;
};
const tiers: Tier[] = ['retail', 'contractor', 'pro'];

describe('money', () => {
  it('rounds half away from zero', () => {
    expect(divRound(5, 10)).toBe(1);
    expect(divRound(15, 10)).toBe(2);
    expect(divRound(14, 10)).toBe(1);
    expect(divRound(-15, 10)).toBe(-2);
    expect(divRound(0, 7)).toBe(0);
  });

  it('divRound is within half a unit of the exact quotient', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e9, max: 1e9 }), fc.integer({ min: 1, max: 1e6 }), (a, b) => {
        expect(Math.abs(divRound(a, b) - a / b)).toBeLessThanOrEqual(0.5 + 1e-9);
      }),
    );
  });

  it('a bigger discount never gives a higher price', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e7 }), fc.integer({ min: 0, max: 10_000 }), fc.integer({ min: 0, max: 10_000 }), (p, a, b) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        expect(applyDiscount(p, hi)).toBeLessThanOrEqual(applyDiscount(p, lo));
      }),
    );
  });
});

describe('lumber units', () => {
  it('computes board feet on nominal sizes', () => {
    expect(boardFeet({ thickness: 2, width: 4, lengthFt: 8 })).toBeCloseTo(5.3333, 4);
    expect(boardFeet({ thickness: 2, width: 12, lengthFt: 16 })).toBe(32);
  });

  it('prices a piece from $/MBF', () => {
    // 2x4x8 at $1,250/MBF: 5.333 bf * $1.25 = $6.67
    expect(piecePriceFromMbf({ thickness: 2, width: 4, lengthFt: 8 }, 125_000)).toBe(667);
    expect(byId('LBR-SPF-2X4-08').priceCents).toBe(667);
  });

  it('a longer board of the same size and species never costs less', () => {
    const lumber = catalog.filter((p) => p.category === 'lumber');
    for (const a of lumber) {
      for (const b of lumber) {
        if (a.species === b.species && a.lumber!.width === b.lumber!.width && a.lumber!.lengthFt < b.lumber!.lengthFt) {
          expect(a.priceCents).toBeLessThanOrEqual(b.priceCents);
        }
      }
    }
  });
});

describe('priceQuote', () => {
  it('prices a small framing order for a contractor', () => {
    const q = priceQuote(
      [
        { product: byId('LBR-SPF-2X4-08'), qty: 40 },
        { product: byId('SHT-OSB-716'), qty: 12 },
        { product: byId('FST-NAIL-314-5LB'), qty: 2 },
      ],
      'contractor',
    );
    // 8% off: 667 -> 614, 1949 -> 1793, 2499 -> 2299
    expect(q.lines.map((l) => l.netUnitCents)).toEqual([614, 1793, 2299]);
    expect(q.lines.map((l) => l.lineTotalCents)).toEqual([24_560, 21_516, 4_598]);
    expect(q.subtotalCents).toBe(50_674);
    expect(q.taxCents).toBe(6_588); // 13% of 506.74 = 65.8762
    expect(q.totalCents).toBe(57_262);
    expect(q.needsApproval).toBe(false);
  });

  it('adds the lumber volume break at 1,000 board feet', () => {
    const small = priceQuote([{ product: byId('LBR-SPF-2X6-16'), qty: 50 }], 'retail'); // 800 bf
    const big = priceQuote([{ product: byId('LBR-SPF-2X6-16'), qty: 63 }], 'retail'); // 1008 bf
    expect(small.lines[0]!.volumeBp).toBe(0);
    expect(big.boardFeet).toBe(1008);
    expect(big.lines[0]!.volumeBp).toBe(DEFAULT_POLICY.lumberVolume.bp);
  });

  it('adds the sheet break at 50 sheets of one SKU', () => {
    const q = priceQuote([{ product: byId('DRY-12-4X8'), qty: 30 }, { product: byId('DRY-12-4X8'), qty: 20 }], 'retail');
    expect(q.lines.every((l) => l.volumeBp === DEFAULT_POLICY.sheetVolume.bp)).toBe(true);
  });

  it('flags a rep discount over the limit and a net price under the margin floor', () => {
    const q = priceQuote([{ product: byId('CON-REG-30'), qty: 10, extraDiscountBp: 1500 }], 'pro');
    expect(q.needsApproval).toBe(true);
    expect(q.lines[0]!.approvalReasons).toHaveLength(2);
  });

  it('rejects bad quantities and discounts', () => {
    expect(() => priceQuote([{ product: byId('HDW-H25'), qty: 0 }], 'retail')).toThrow(RangeError);
    expect(() => priceQuote([{ product: byId('HDW-H25'), qty: 1.5 }], 'retail')).toThrow(RangeError);
    expect(() => priceQuote([{ product: byId('HDW-H25'), qty: 1, extraDiscountBp: -5 }], 'retail')).toThrow(RangeError);
  });

  const arbLines = fc.array(
    fc.record({
      product: fc.constantFrom<Product>(...catalog),
      qty: fc.integer({ min: 1, max: 2_000 }),
      extraDiscountBp: fc.integer({ min: 0, max: 2_000 }),
    }),
    { minLength: 1, maxLength: 12 },
  );

  it('every line multiplies out exactly and lines add up to the subtotal', () => {
    fc.assert(
      fc.property(arbLines, fc.constantFrom(...tiers), (lines, tier) => {
        const q = priceQuote(lines, tier);
        for (const l of q.lines) expect(l.lineTotalCents).toBe(l.netUnitCents * l.qty);
        expect(q.subtotalCents).toBe(q.lines.reduce((s, l) => s + l.lineTotalCents, 0));
        expect(q.taxCents).toBe(percentOf(q.subtotalCents, DEFAULT_POLICY.taxBp));
        expect(q.totalCents).toBe(q.subtotalCents + q.taxCents);
        expect(q.boardFeet).toBeCloseTo(lines.reduce((s, l) => s + productBoardFeet(l.product) * l.qty, 0), 6);
      }),
    );
  });

  it('a better tier never costs the customer more, line by line', () => {
    fc.assert(
      fc.property(arbLines, (lines) => {
        const [r, c, p] = tiers.map((t) => priceQuote(lines, t));
        r!.lines.forEach((line, i) => {
          expect(c!.lines[i]!.netUnitCents).toBeLessThanOrEqual(line.netUnitCents);
          expect(p!.lines[i]!.netUnitCents).toBeLessThanOrEqual(c!.lines[i]!.netUnitCents);
        });
      }),
    );
  });

  it('anything under the margin floor is always flagged for approval', () => {
    fc.assert(
      fc.property(arbLines, fc.constantFrom(...tiers), (lines, tier) => {
        const q = priceQuote(lines, tier);
        q.lines.forEach((l, i) => {
          const cost = lines[i]!.product.costCents;
          const floor = cost + percentOf(cost, DEFAULT_POLICY.minMarginBp);
          if (l.netUnitCents < floor) expect(l.approvalReasons.length).toBeGreaterThan(0);
          if (l.approvalReasons.length === 0) expect(l.netUnitCents).toBeGreaterThanOrEqual(floor);
        });
      }),
    );
  });

  it('tier discounts alone never need approval', () => {
    for (const tier of tiers) {
      const q = priceQuote(catalog.map((product) => ({ product, qty: 1 })), tier);
      expect(q.needsApproval, `${tier} at ${TIER_DISCOUNT_BP[tier]} bp`).toBe(false);
    }
  });
});
