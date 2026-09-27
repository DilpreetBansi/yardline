/**
 * Money is always an integer number of cents (CAD). Every operation that can produce a
 * fraction of a cent rounds exactly once, half away from zero, using integer arithmetic.
 */
export type Cents = number;

/** a / b rounded half away from zero. `a` and `b` must be integers and `b > 0`. */
export function divRound(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || b <= 0) {
    throw new RangeError(`divRound expects integers with b > 0, got ${a} / ${b}`);
  }
  const sign = a < 0 ? -1 : 1;
  const abs = Math.abs(a);
  return sign * Math.floor((2 * abs + b) / (2 * b));
}

/** Basis points: 100 bp = 1%. */
export type Bp = number;

/** Apply a discount in basis points to a price in cents. */
export function applyDiscount(priceCents: Cents, discountBp: Bp): Cents {
  if (discountBp < 0 || discountBp > 10_000) throw new RangeError(`discount out of range: ${discountBp}`);
  return divRound(priceCents * (10_000 - discountBp), 10_000);
}

/** price * bp / 10000, rounded (used for tax). */
export function percentOf(cents: Cents, bp: Bp): Cents {
  return divRound(cents * bp, 10_000);
}

const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });

export function formatCents(cents: Cents): string {
  return cad.format(cents / 100);
}

/** "1,250" style formatting for board feet and other quantities. */
export function formatNumber(n: number, digits = 0): string {
  return n.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
