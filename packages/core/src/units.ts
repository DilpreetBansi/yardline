import { divRound, type Cents } from './money.ts';

/** Nominal lumber dimensions, the way the yard sells them: 2x4x8 is 2" x 4" x 8'. */
export interface LumberDims {
  thickness: number;
  width: number;
  lengthFt: number;
}

/**
 * Board feet use nominal inches: one board foot is 1" x 12" x 1'.
 * A 2x4x8 is 2 * 4 * 8 / 12 = 5.333 board feet.
 */
export function boardFeet(d: LumberDims): number {
  return (d.thickness * d.width * d.lengthFt) / 12;
}

/**
 * Lumber is priced per thousand board feet (MBF). The price of one piece is
 * thickness * width * length / 12 / 1000 * perMbf, rounded once to the cent.
 */
export function piecePriceFromMbf(d: LumberDims, perMbfCents: Cents): Cents {
  return divRound(d.thickness * d.width * d.lengthFt * perMbfCents, 12_000);
}

export function formatDims(d: Partial<LumberDims> & { thickness: number; width: number }): string {
  return d.lengthFt ? `${d.thickness}x${d.width}x${d.lengthFt}'` : `${d.thickness}x${d.width}`;
}

/** Pieces needed to cover a run of linear feet with boards of a given length. */
export function piecesForLinearFeet(linearFeet: number, lengthFt: number): number {
  if (linearFeet <= 0 || lengthFt <= 0) return 0;
  return Math.ceil(linearFeet / lengthFt);
}
