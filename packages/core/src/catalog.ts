import { boardFeet, piecePriceFromMbf, type LumberDims } from './units.ts';
import type { Cents } from './money.ts';

export type Category =
  | 'lumber'
  | 'stud'
  | 'post'
  | 'sheet'
  | 'drywall'
  | 'fastener'
  | 'hardware'
  | 'concrete'
  | 'insulation'
  | 'membrane'
  | 'adhesive';

export type Uom = 'piece' | 'sheet' | 'box' | 'bag' | 'roll' | 'tube' | 'each';
export type Species = 'SPF' | 'DF' | 'PT';

export interface Product {
  /** SKU, e.g. LBR-SPF-2X4-08. */
  id: string;
  name: string;
  category: Category;
  uom: Uom;
  species?: Species;
  /** Dimensional lumber, studs and posts. */
  lumber?: LumberDims;
  /** For precut studs: length label such as 92-5/8. */
  studLength?: string;
  /** Sheet and drywall thickness as sold, e.g. 1/2, 5/8, 7/16. */
  thickness?: string;
  sheetSize?: string;
  /** Hardware that fits a lumber size, e.g. a 2x8 joist hanger. */
  fits?: string;
  /** Fastener length label, e.g. 3, 2-1/2, 3-1/4. */
  fastenerLength?: string;
  /** Pack label for boxed fasteners, e.g. 5lb. */
  pack?: string;
  /** R-value for insulation. */
  rValue?: number;
  /** Canonical tokens the matcher compares against. */
  keywords: string[];
  /** Tokens that distinguish this product from its siblings; the text should mention them. */
  requires?: string[];
  priceCents: Cents;
  /** Lumber is priced per thousand board feet; priceCents is derived from it. */
  perMbfCents?: Cents;
  costCents: Cents;
}

export interface Branch {
  id: string;
  name: string;
}

export const BRANCHES: Branch[] = [
  { id: 'MSS', name: 'Mississauga yard' },
  { id: 'BRM', name: 'Brampton yard' },
];

const LENGTHS = [8, 10, 12, 14, 16];

/** CAD per thousand board feet, by species and size. */
const MBF: Record<Species, Record<string, number>> = {
  SPF: { '2x4': 1250, '2x6': 1300, '2x8': 1400, '2x10': 1500, '2x12': 1650 },
  DF: { '2x6': 1625, '2x8': 1750, '2x10': 1875, '2x12': 2060 },
  PT: { '2x4': 1810, '2x6': 1885, '2x8': 2030, '2x10': 2175 },
};

const SPECIES_NAME: Record<Species, string> = {
  SPF: 'SPF #2 & Better KD',
  DF: 'Douglas Fir #2',
  PT: 'Pressure Treated (brown)',
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const cost = (price: Cents, marginBp: number) => Math.round((price * (10_000 - marginBp)) / 10_000);

function lumber(species: Species, size: string, lengthFt: number): Product {
  const [t, w] = size.split('x').map(Number) as [number, number];
  const dims = { thickness: t, width: w, lengthFt };
  const perMbfCents = (MBF[species][size] ?? 0) * 100;
  const priceCents = piecePriceFromMbf(dims, perMbfCents);
  return {
    id: `LBR-${species}-${size.toUpperCase()}-${pad2(lengthFt)}`,
    name: `${size} x ${lengthFt}' ${SPECIES_NAME[species]}`,
    category: 'lumber',
    uom: 'piece',
    species,
    lumber: dims,
    keywords: ['lumber', species.toLowerCase(), size],
    priceCents,
    perMbfCents,
    costCents: cost(priceCents, 2400),
  };
}

function product(p: Omit<Product, 'costCents'> & { marginBp?: number }): Product {
  const { marginBp = 3000, ...rest } = p;
  return { ...rest, costCents: cost(p.priceCents, marginBp) };
}

/** The demo catalog: about a hundred SKUs a GTA building-supply yard would stock. Prices are illustrative. */
export function buildCatalog(): Product[] {
  const out: Product[] = [];
  for (const size of Object.keys(MBF.SPF)) for (const L of LENGTHS) out.push(lumber('SPF', size, L));
  for (const size of Object.keys(MBF.DF)) for (const L of LENGTHS) out.push(lumber('DF', size, L));
  for (const size of Object.keys(MBF.PT)) for (const L of [8, 10, 12, 16]) out.push(lumber('PT', size, L));

  const studs: [string, string, number, number][] = [
    ['2x4', '92-5/8', 8, 549],
    ['2x4', '104-5/8', 9, 649],
    ['2x6', '92-5/8', 8, 899],
    ['2x6', '104-5/8', 9, 1049],
  ];
  for (const [size, label, approxFt, price] of studs) {
    const [t, w] = size.split('x').map(Number) as [number, number];
    out.push(
      product({
        id: `STD-SPF-${size.toUpperCase()}-${label.replace(/[^0-9]/g, '')}`,
        name: `${size} precut stud ${label}" SPF`,
        category: 'stud',
        uom: 'piece',
        species: 'SPF',
        lumber: { thickness: t, width: w, lengthFt: approxFt },
        studLength: label,
        keywords: ['stud', 'lumber', 'spf', size],
        priceCents: price,
        marginBp: 2400,
      }),
    );
  }

  const posts: [string, number, number][] = [
    ['4x4', 8, 1899], ['4x4', 10, 2449], ['4x4', 12, 2999],
    ['6x6', 8, 4999], ['6x6', 10, 6499], ['6x6', 12, 7999],
  ];
  for (const [size, L, price] of posts) {
    const [t, w] = size.split('x').map(Number) as [number, number];
    out.push(
      product({
        id: `PST-PT-${size.toUpperCase()}-${pad2(L)}`,
        name: `${size} x ${L}' Pressure Treated post`,
        category: 'post',
        uom: 'piece',
        species: 'PT',
        lumber: { thickness: t, width: w, lengthFt: L },
        keywords: ['post', 'lumber', 'pt', size],
        priceCents: price,
        marginBp: 2600,
      }),
    );
  }

  const sheets: [string, string, string, string[], string[], number][] = [
    ['SHT-OSB-716', '7/16" OSB sheathing 4x8', '7/16', ['osb', 'sheathing'], [], 1949],
    ['SHT-OSB-58TG', '5/8" OSB T&G subfloor 4x8', '5/8', ['osb', 'tg', 'subfloor'], ['tg'], 3299],
    ['SHT-OSB-34TG', '3/4" OSB T&G subfloor 4x8', '3/4', ['osb', 'tg', 'subfloor'], ['tg'], 4199],
    ['SHT-PLY-12', '1/2" spruce plywood sheathing 4x8', '1/2', ['plywood', 'sheathing'], [], 3999],
    ['SHT-PLY-58', '5/8" spruce plywood 4x8', '5/8', ['plywood'], [], 4999],
    ['SHT-PLY-34', '3/4" spruce plywood 4x8', '3/4', ['plywood'], [], 5999],
    ['SHT-PLY-34TG', '3/4" plywood T&G subfloor 4x8', '3/4', ['plywood', 'tg', 'subfloor'], ['tg'], 6499],
    ['SHT-XPS-2', '2" XPS rigid foam insulation 4x8', '2', ['foam', 'insulation', 'rigid'], ['foam'], 4499],
  ];
  for (const [id, name, thickness, keywords, requires, price] of sheets) {
    out.push(product({ id, name, category: 'sheet', uom: 'sheet', thickness, sheetSize: '4x8', keywords, requires, priceCents: price }));
  }

  const drywall: [string, string, string, string, string[], string[], number][] = [
    ['DRY-12-4X8', '1/2" regular drywall 4x8', '1/2', '4x8', ['drywall'], [], 1749],
    ['DRY-12-4X12', '1/2" regular drywall 4x12', '1/2', '4x12', ['drywall'], [], 2599],
    ['DRY-58X-4X8', '5/8" Type X fire-rated drywall 4x8', '5/8', '4x8', ['drywall', 'typex'], ['typex'], 2199],
    ['DRY-58X-4X12', '5/8" Type X fire-rated drywall 4x12', '5/8', '4x12', ['drywall', 'typex'], ['typex'], 3249],
    ['DRY-12MR-4X8', '1/2" moisture-resistant drywall 4x8', '1/2', '4x8', ['drywall', 'mr'], ['mr'], 2499],
  ];
  for (const [id, name, thickness, sheetSize, keywords, requires, price] of drywall) {
    out.push(product({ id, name, category: 'drywall', uom: 'sheet', thickness, sheetSize, keywords, requires, priceCents: price }));
  }

  const fasteners: [string, string, string, string, string[], string[], number][] = [
    ['FST-NAIL-314-5LB', '3-1/4" common framing nails, 5 lb box', '3-1/4', '5lb', ['nail', 'framing'], [], 2499],
    ['FST-NAIL-314-30LB', '3-1/4" common framing nails, 30 lb box', '3-1/4', '30lb', ['nail', 'framing'], ['30lb'], 10900],
    ['FST-DECK-212-1LB', '2-1/2" deck screws, 1 lb box', '2-1/2', '1lb', ['screw', 'deck'], ['1lb'], 1199],
    ['FST-DECK-212-5LB', '2-1/2" deck screws, 5 lb box', '2-1/2', '5lb', ['screw', 'deck'], [], 4499],
    ['FST-DECK-3-1LB', '3" deck screws, 1 lb box', '3', '1lb', ['screw', 'deck'], ['1lb'], 1299],
    ['FST-DECK-3-5LB', '3" deck screws, 5 lb box', '3', '5lb', ['screw', 'deck'], [], 4799],
    ['FST-STRUCT-6-50', '6" structural wood screws, box of 50', '6', '50', ['screw', 'structural'], ['structural'], 6299],
    ['FST-DRY-114-5LB', '1-1/4" drywall screws, 5 lb box', '1-1/4', '5lb', ['screw', 'drywall'], [], 2999],
  ];
  for (const [id, name, fastenerLength, pack, keywords, requires, price] of fasteners) {
    out.push(product({ id, name, category: 'fastener', uom: 'box', fastenerLength, pack, keywords, requires, priceCents: price, marginBp: 4000 }));
  }

  for (const [size, price] of [['2x6', 249], ['2x8', 299], ['2x10', 349], ['2x12', 399]] as const) {
    out.push(
      product({
        id: `HDW-HGR-${size.toUpperCase()}`,
        name: `${size} joist hanger, galvanized`,
        category: 'hardware',
        uom: 'each',
        fits: size,
        keywords: ['hanger', 'joist'],
        priceCents: price,
        marginBp: 4200,
      }),
    );
  }
  out.push(product({ id: 'HDW-H25', name: 'Hurricane tie H2.5A, galvanized', category: 'hardware', uom: 'each', keywords: ['hurricane', 'tie'], priceCents: 139, marginBp: 4200 }));
  for (const [size, price] of [['4x4', 1499], ['6x6', 2499]] as const) {
    out.push(
      product({
        id: `HDW-PB-${size.toUpperCase()}`,
        name: `${size} adjustable post base`,
        category: 'hardware',
        uom: 'each',
        fits: size,
        keywords: ['postbase', 'post'],
        requires: ['postbase'],
        priceCents: price,
        marginBp: 4000,
      }),
    );
  }

  out.push(product({ id: 'CON-REG-30', name: 'Concrete mix, 30 kg bag', category: 'concrete', uom: 'bag', keywords: ['concrete'], priceCents: 849, marginBp: 2500 }));
  out.push(product({ id: 'CON-FAST-30', name: 'Fast-setting concrete, 30 kg bag', category: 'concrete', uom: 'bag', keywords: ['concrete', 'fast'], requires: ['fast'], priceCents: 1099, marginBp: 2500 }));
  out.push(product({ id: 'CON-MORT-30', name: 'Type S mortar mix, 30 kg bag', category: 'concrete', uom: 'bag', keywords: ['mortar'], requires: ['mortar'], priceCents: 1149, marginBp: 2500 }));

  for (const [r, price, use] of [[12, 6499, '2x4 walls'], [20, 6999, '2x6 walls'], [22, 7299, '2x6 walls'], [31, 8499, 'ceilings']] as const) {
    out.push(
      product({
        id: `INS-R${r}`,
        name: `R-${r} fibreglass batts (${use}), bag`,
        category: 'insulation',
        uom: 'bag',
        rValue: r,
        keywords: ['batt', 'insulation', `r${r}`],
        priceCents: price,
        marginBp: 2800,
      }),
    );
  }

  out.push(product({ id: 'MEM-POLY-6', name: '6 mil vapour barrier, 10\' x 100\' roll', category: 'membrane', uom: 'roll', keywords: ['poly'], priceCents: 8999 }));
  out.push(product({ id: 'MEM-WRAP-9', name: 'House wrap, 9\' x 150\' roll', category: 'membrane', uom: 'roll', keywords: ['housewrap'], priceCents: 19900 }));
  out.push(product({ id: 'ADH-CONST-300', name: 'Construction adhesive, 300 mL tube', category: 'adhesive', uom: 'tube', keywords: ['adhesive', 'construction'], priceCents: 699, marginBp: 4000 }));
  out.push(product({ id: 'ADH-SUBFLR-300', name: 'Subfloor adhesive, 300 mL tube', category: 'adhesive', uom: 'tube', keywords: ['adhesive', 'subfloor'], requires: ['subfloor'], priceCents: 849, marginBp: 4000 }));

  return out;
}

/** Deterministic PRNG so every install seeds the same stock levels. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A few SKUs are deliberately short so the demo can show a stock conflict. */
export const SCARCE: Record<string, Record<string, number>> = {
  'LBR-DF-2X12-16': { MSS: 12, BRM: 0 },
  'SHT-PLY-34TG': { MSS: 24, BRM: 6 },
  'PST-PT-6X6-12': { MSS: 4, BRM: 2 },
};

export function initialStock(p: Product, branchId: string): number {
  const scarce = SCARCE[p.id]?.[branchId];
  if (scarce !== undefined) return scarce;
  const r = mulberry32(hash(`${p.id}@${branchId}`))();
  const [lo, hi] =
    p.category === 'lumber' || p.category === 'stud' ? [80, 900]
    : p.category === 'sheet' || p.category === 'drywall' ? [60, 500]
    : p.category === 'post' ? [20, 160]
    : [30, 400];
  return Math.round(lo + r * (hi - lo));
}

export function productBoardFeet(p: Product): number {
  return p.lumber && (p.category === 'lumber' || p.category === 'post' || p.category === 'stud') ? boardFeet(p.lumber) : 0;
}
