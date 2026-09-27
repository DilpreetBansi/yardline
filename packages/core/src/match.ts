import type { Category, Product } from './catalog.ts';
import type { ParsedLine } from './parse.ts';
import { similarity } from './trigram.ts';
import { piecesForLinearFeet } from './units.ts';

export type Confidence = 'high' | 'medium' | 'low' | 'none';

export interface Candidate {
  product: Product;
  score: number;
  reasons: string[];
}

export interface MatchResult {
  line: ParsedLine;
  /** Best first; at most four. */
  candidates: Candidate[];
  best: Candidate | null;
  confidence: Confidence;
  /** Quantity in the best product's unit of measure. */
  qty: number;
  notes: string[];
}

/**
 * The first group whose word appears on the line decides which categories are allowed.
 * Order matters: "drywall screws" are fasteners, "subfloor adhesive" is adhesive,
 * "2x8 joist hangers" are hardware even though the line has a lumber size.
 */
const TYPE_GROUPS: [string[], Category[]][] = [
  [['adhesive'], ['adhesive']],
  [['screw', 'nail'], ['fastener']],
  [['hanger', 'hurricane', 'postbase'], ['hardware']],
  [['concrete', 'mortar'], ['concrete']],
  [['poly', 'housewrap'], ['membrane']],
  [['batt'], ['insulation']],
  [['insulation'], ['insulation', 'sheet']],
  [['drywall', 'typex', 'mr'], ['drywall']],
  [['osb', 'plywood', 'foam', 'tg', 'sheathing', 'subfloor'], ['sheet']],
  [['post'], ['post']],
  [['stud'], ['stud', 'lumber']],
];

/** Sheet materials exclude each other: a line that says plywood is not asking for OSB. */
const MATERIALS = ['osb', 'plywood', 'foam'];

/** Words that pick one sibling over another; mentioning one the product lacks is a strong no. */
const DISTINGUISHING = ['typex', 'mr', 'tg', 'fast', 'mortar', 'structural', 'subfloor', 'postbase', 'foam', 'deck', 'framing'];

export function allowedCategories(line: ParsedLine): Set<Category> | null {
  const tokens = new Set(line.tokens);
  for (const [words, cats] of TYPE_GROUPS) if (words.some((w) => tokens.has(w))) return new Set(cats);
  if (line.lumber) return new Set<Category>(['lumber', 'stud', 'post']);
  if (line.rValue !== null) return new Set<Category>(['insulation']);
  return null;
}

export function scoreProduct(line: ParsedLine, p: Product): Candidate | null {
  const allowed = allowedCategories(line);
  if (allowed && !allowed.has(p.category)) return null;
  const tokens = new Set(line.tokens);
  const why: string[] = [];
  let s = allowed ? 20 : 0;

  if (line.lumber) {
    const size = `${line.lumber.thickness}x${line.lumber.width}`;
    if (p.lumber) {
      if (p.lumber.thickness !== line.lumber.thickness || p.lumber.width !== line.lumber.width) return null;
      s += 30;
      why.push(`size ${size}`);
      const L = line.lumber.lengthFt;
      const askedForStud = tokens.has('stud') || line.studLength !== null;
      if (p.category === 'stud' && !askedForStud) {
        // "2x4x8" is an 8' board; a precut 92-5/8" stud is a different product.
        s -= 15;
      } else if (L !== null) {
        if (p.lumber.lengthFt === L) {
          s += 30;
          why.push(p.category === 'stud' ? `precut stud for ${L}' walls` : `${L}' long`);
        } else {
          s -= 10 + 5 * Math.abs(p.lumber.lengthFt - L);
        }
      } else if (p.category === 'stud') {
        s += 25;
        if (p.studLength === '92-5/8') s += 5;
      } else if (line.qtyUnit === 'lf') {
        if (p.lumber.lengthFt === 16) s += 8;
      } else if (p.lumber.lengthFt === 8) {
        s += 2;
      }
    } else if (p.fits) {
      if (p.fits !== size) return null;
      s += 40;
      why.push(`fits ${size}`);
    } else {
      return null;
    }
  } else if (p.lumber && p.category !== 'stud') {
    // Lumber with no size on the line is a guess at best.
    s -= 25;
  }

  if (line.studLength) {
    if (p.studLength === line.studLength) {
      s += 40;
      why.push(`precut ${line.studLength}"`);
    } else if (p.category === 'lumber') {
      s -= 20;
    }
  }

  if (line.species) {
    if (p.species === line.species) {
      s += 20;
      why.push(line.species);
    } else if (p.species) {
      s -= 35;
    }
  } else if (p.species === 'SPF') {
    s += 6;
  }

  if (line.thickness && p.thickness) {
    if (line.thickness === p.thickness) {
      s += 30;
      why.push(`${p.thickness}" thick`);
    } else {
      s -= 30;
    }
  }

  if (p.sheetSize) {
    if (line.sheetSize) s += line.sheetSize === p.sheetSize ? 15 : -20;
    else if (p.sheetSize === '4x8') s += 4;
  }

  if (line.fastenerLength && p.fastenerLength) {
    if (line.fastenerLength === p.fastenerLength) {
      s += 30;
      why.push(`${p.fastenerLength}" long`);
    } else {
      s -= 30;
    }
  }
  if (line.pack && p.pack) s += line.pack === p.pack ? 15 : -10;

  if (line.rValue !== null && p.rValue !== undefined) {
    if (line.rValue === p.rValue) {
      s += 40;
      why.push(`R-${p.rValue}`);
    } else {
      s -= 40;
    }
  }

  if (tokens.has('stud') && p.category === 'lumber') s -= 10;
  const materials = MATERIALS.filter((m) => tokens.has(m));
  if (materials.length && p.keywords.some((k) => MATERIALS.includes(k) && !materials.includes(k))) s -= 25;

  let hits = 0;
  for (const k of p.keywords) {
    if (tokens.has(k)) {
      s += 8;
      hits++;
    }
  }
  if (p.keywords.length) s += (15 * hits) / p.keywords.length;
  for (const req of p.requires ?? []) {
    const satisfied = tokens.has(req) || line.pack === req;
    if (!satisfied) s -= 18;
  }
  for (const d of DISTINGUISHING) if (tokens.has(d) && !p.keywords.includes(d)) s -= 18;

  s += 10 * similarity(line.raw, p.name);
  return { product: p, score: Math.round(s * 10) / 10, reasons: why };
}

export function matchLine(line: ParsedLine, catalog: Product[]): MatchResult {
  const scored: Candidate[] = [];
  for (const p of catalog) {
    const c = scoreProduct(line, p);
    if (c) scored.push(c);
  }
  scored.sort((a, b) => b.score - a.score || a.product.priceCents - b.product.priceCents);
  const candidates = scored.slice(0, 4);
  const first = candidates[0];
  const second = candidates[1];
  const b1 = first?.score ?? -Infinity;
  const gap = b1 - (second?.score ?? -Infinity);
  let confidence: Confidence;
  if (!first || b1 < 30) confidence = 'none';
  else if ((b1 >= 45 && gap >= 25) || (b1 >= 75 && gap >= 12)) confidence = 'high';
  else if (b1 >= 40 && gap >= 5) confidence = 'medium';
  else confidence = 'low';

  const best = confidence === 'none' ? null : first!;
  const notes: string[] = [];
  let qty = line.qty ?? 1;
  if (line.qty === null) notes.push('No quantity on the line; assumed 1.');
  if (best && line.qtyUnit === 'lf') {
    if (best.product.lumber) {
      const pieces = piecesForLinearFeet(line.qty ?? 0, best.product.lumber.lengthFt);
      notes.push(`${line.qty} linear ft = ${pieces} pcs at ${best.product.lumber.lengthFt}'.`);
      qty = pieces;
    } else {
      notes.push('Linear feet only convert for lumber; check the quantity.');
    }
  }
  if (best && line.lumber && line.lumber.lengthFt === null && best.product.category === 'lumber' && line.qtyUnit !== 'lf') {
    notes.push('No length on the line; pick one.');
  }
  return { line, candidates, best, confidence, qty, notes };
}
