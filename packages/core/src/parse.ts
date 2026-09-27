import type { Species } from './catalog.ts';

/**
 * Turns one line of a contractor's materials list into structured fields.
 * Lists arrive in every shape: "40 2x4x8 SPF", "2x6-16' x 24", "(12) 2x10x12 DF",
 * "12 sheets 5/8 type x", "hurricane ties x50", "two rolls 6 mil poly".
 */
export type QtyUnit = 'piece' | 'sheet' | 'box' | 'bag' | 'roll' | 'tube' | 'lf';

export interface ParsedLine {
  raw: string;
  qty: number | null;
  qtyUnit: QtyUnit | null;
  /** Nominal lumber size; lengthFt is null when the line gives no length. */
  lumber: { thickness: number; width: number; lengthFt: number | null } | null;
  studLength: string | null;
  thickness: string | null;
  sheetSize: string | null;
  fastenerLength: string | null;
  pack: string | null;
  rValue: number | null;
  species: Species | null;
  /** Canonical tokens (see SYNONYMS) plus leftover words, for matching. */
  tokens: string[];
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, dozen: 12,
};

const UNIT_WORDS: [RegExp, QtyUnit][] = [
  [/^(?:pcs?|pieces?|ea|each|lengths?)$/, 'piece'],
  [/^(?:sheets?|shts?|sht)$/, 'sheet'],
  [/^(?:boxe?s?|bx|bxs|pails?)$/, 'box'],
  [/^(?:bags?)$/, 'bag'],
  [/^(?:rolls?)$/, 'roll'],
  [/^(?:tubes?)$/, 'tube'],
  [/^(?:lf|lin\.?ft|linft)$/, 'lf'],
];

/** Phrases first (so "type x" wins over "x"), then single words. */
const PHRASES: [RegExp, string][] = [
  [/\bpressure[\s-]*treated\b/g, ' pt '],
  [/\bdoug(?:las)?[\s-]*fir\b/g, ' df '],
  [/\btype[\s-]*x\b/g, ' typex '],
  [/\bfire[\s-]*(?:rated|code)\b/g, ' typex '],
  [/\bmoisture[\s-]*(?:resistant|resistance)\b/g, ' mr '],
  [/\bgreen[\s-]*board\b/g, ' mr '],
  [/\btongue[\s-]*(?:and|&|n)[\s-]*groove\b/g, ' tg '],
  [/\bt\s*&\s*g\b/g, ' tg '],
  [/\bhouse[\s-]*wrap\b/g, ' housewrap '],
  [/\bvapou?r[\s-]*barrier\b/g, ' poly '],
  [/\b6[\s-]*mil\b/g, ' poly '],
  [/\bjoist[\s-]*hangers?\b/g, ' hanger joist '],
  [/\bpost[\s-]*bases?\b/g, ' postbase '],
  [/\bhurricane[\s-]*(?:ties?|clips?)\b/g, ' hurricane tie '],
  [/\bh2\.5a?\b/g, ' hurricane tie '],
  [/\bfast[\s-]*(?:setting|set)\b/g, ' fast '],
  [/\bsub[\s-]*floor\b/g, ' subfloor '],
  [/\brigid[\s-]*foam\b/g, ' foam '],
  [/\bconstruction[\s-]*adhesive\b/g, ' adhesive construction '],
  [/\bpl[\s-]*(?:400|premium)\b/g, ' adhesive construction '],
];

const SYNONYMS: Record<string, string> = {
  treated: 'pt', brown: 'pt', pt: 'pt', 'p.t': 'pt',
  df: 'df', fir: 'df', 'd.f': 'df',
  spf: 'spf', spruce: 'spf', kd: 'spf', 's-p-f': 'spf',
  osb: 'osb', chipboard: 'osb', waferboard: 'osb',
  ply: 'plywood', plywood: 'plywood', plyw: 'plywood',
  drywall: 'drywall', gyp: 'drywall', gypsum: 'drywall', sheetrock: 'drywall', gypboard: 'drywall', board: 'board',
  typex: 'typex', mr: 'mr', tg: 'tg', tng: 'tg',
  poly: 'poly', vapour: 'poly', vapor: 'poly', polyethylene: 'poly',
  housewrap: 'housewrap', tyvek: 'housewrap',
  concrete: 'concrete', quikrete: 'concrete', sakrete: 'concrete', cement: 'concrete',
  mortar: 'mortar', fast: 'fast',
  batt: 'batt', batts: 'batt', insulation: 'insulation', pink: 'batt', fibreglass: 'batt', fiberglass: 'batt',
  foam: 'foam', xps: 'foam', eps: 'foam', styrofoam: 'foam',
  hanger: 'hanger', hangers: 'hanger', joist: 'joist', joists: 'joist',
  hurricane: 'hurricane', tie: 'tie', ties: 'tie',
  postbase: 'postbase',
  adhesive: 'adhesive', glue: 'adhesive', construction: 'construction', subfloor: 'subfloor',
  screw: 'screw', screws: 'screw', deck: 'deck', decking: 'deck',
  nail: 'nail', nails: 'nail', spikes: 'nail', spike: 'nail', framing: 'framing', common: 'framing',
  structural: 'structural', timberlok: 'structural', ledgerlok: 'structural',
  stud: 'stud', studs: 'stud', precut: 'stud',
  post: 'post', posts: 'post',
  sheathing: 'sheathing',
};

const STOPWORDS = new Set(['of', 'and', 'the', 'for', 'with', 'x', 'in', 'ft', 'feet', 'foot', 'inch', 'inches', 'lb', 'lbs', 'kg', 'mm', 'box', 'boxes', 'bag', 'bags', 'sheet', 'sheets', 'roll', 'rolls', 'tube', 'tubes', 'pcs', 'pc', 'ea', 'each', 'qty', 'please', 'need', 'approx', 'about', 'plus', 'extra', 'or', 'to', 'a', 'an', 'lengths', 'length', 'gal', 'galv', 'galvanized']);

const SHEET_TOKENS = new Set(['osb', 'plywood', 'drywall', 'foam', 'sheathing', 'subfloor', 'typex', 'mr', 'tg']);
const FRACTION_THICKNESSES = new Set(['1/4', '3/8', '7/16', '1/2', '5/8', '3/4']);

export function normalize(line: string): string {
  return line
    .toLowerCase()
    .replace(/[′’‘`]/g, "'")
    .replace(/[″“”]/g, '"')
    .replace(/''/g, '"')
    .replace(/×/g, 'x')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function unitFromWord(w: string): QtyUnit | null {
  for (const [re, u] of UNIT_WORDS) if (re.test(w)) return u;
  return null;
}

export function parseLine(input: string): ParsedLine {
  const raw = input.trim();
  let s = ` ${normalize(raw)} `;
  const out: ParsedLine = {
    raw, qty: null, qtyUnit: null, lumber: null, studLength: null, thickness: null,
    sheetSize: null, fastenerLength: null, pack: null, rValue: null, species: null, tokens: [],
  };
  const cut = (m: RegExpMatchArray) => {
    s = s.slice(0, m.index!) + ' ' + s.slice(m.index! + m[0].length);
  };

  for (const [re, rep] of PHRASES) s = s.replace(re, rep);

  // Precut stud lengths: 92-5/8, 104 5/8.
  let m = s.match(/\b(92|104)[\s-]?5\/8"?/);
  if (m) {
    out.studLength = `${m[1]}-5/8`;
    cut(m);
  }

  // R-values: R20, R-20, r 22.
  m = s.match(/\br[\s-]?(\d{2})\b/);
  if (m) {
    out.rValue = Number(m[1]);
    cut(m);
  }

  // Pack sizes: 5 lb, 30lb box, box of 50.
  m = s.match(/\b(\d{1,2})\s*(?:lb|lbs|#)(?=\W)/);
  if (m) {
    out.pack = `${m[1]}lb`;
    cut(m);
  } else {
    m = s.match(/\bbox(?:es)? of (\d{2,3})\b/);
    if (m) {
      out.pack = m[1]!;
      cut(m);
    }
  }
  // Bag weights are part of the product, not the quantity: "30 kg".
  m = s.match(/\b\d{2}\s*kg\b/);
  if (m) cut(m);

  // Sheet sizes and lumber sizes share the NxM shape. Decide by the other words on the line.
  const looksLikeSheet = [...SHEET_TOKENS].some((t) => new RegExp(`\\b${t}\\b`).test(s)) || /\b(?:ply|gyp|gypsum|sheetrock|chipboard|xps|eps)\b/.test(s);
  m = looksLikeSheet ? s.match(/\b(4)\s*x\s*(8|10|12)\b(?:'|\s*ft\b)?/) : null;
  if (m) {
    out.sheetSize = `${m[1]}x${m[2]}`;
    cut(m);
  }

  // Lumber: 2x4, 2x4x8, 2x6-16', 2 x 10 x 12', 4x4x10.
  m = s.match(/\b([1-8])\s*x\s*(\d{1,2})(?:\s*(?:x|-|@)\s*(\d{1,2})(?:\s*(?:'|ft\b|feet\b|foot\b))?)?/);
  if (m && !looksLikeSheet) {
    const width = Number(m[2]);
    if ([2, 3, 4, 6, 8, 10, 12].includes(width)) {
      out.lumber = { thickness: Number(m[1]), width, lengthFt: m[3] ? Number(m[3]) : null };
      cut(m);
    }
  }
  if (out.lumber && out.lumber.lengthFt === null) {
    m = s.match(/(?:^|\s|-)(\d{1,2})\s*(?:'|ft\b|feet\b|foot\b)/);
    if (m && Number(m[1]) >= 6 && Number(m[1]) <= 24) {
      out.lumber.lengthFt = Number(m[1]);
      cut(m);
    }
  }

  // Fastener lengths: 3", 2-1/2", 3-1/4 in, 1 1/4". Only when a fastener word is on the line.
  const isFastener = /\b(?:screws?|nails?|spikes?|structural|timberlok|ledgerlok)\b/.test(s);
  if (isFastener) {
    m = s.match(/\b(\d{1,2}(?:[\s-]\d\/\d)?)\s*(?:"|in\b|inch(?:es)?\b)/) ?? s.match(/\b(\d(?:-\d\/\d))\b/);
    if (m) {
      out.fastenerLength = m[1]!.replace(' ', '-');
      cut(m);
    }
  }

  // Sheet/drywall thickness: 1/2, 5/8", 7/16. Rigid foam: 2" or 2 in.
  m = s.match(/\b(\d{1,2}\/\d{1,2})\s*(?:"|in\b|inch\b)?/);
  if (m && FRACTION_THICKNESSES.has(m[1]!)) {
    out.thickness = m[1]!;
    cut(m);
  } else if (/\bfoam\b/.test(s)) {
    m = s.match(/\b([1-3])\s*(?:"|in\b|inch\b)/);
    if (m) {
      out.thickness = m[1]!;
      cut(m);
    }
  }

  // Quantity. Try the explicit forms first.
  const setQty = (n: number, unit: QtyUnit | null) => {
    if (out.qty === null && Number.isFinite(n) && n > 0 && n < 100_000) {
      out.qty = n;
      if (unit) out.qtyUnit = unit;
    }
  };
  m = s.match(/\b(\d{1,5})\s*(pcs?|pieces?|ea|each|sheets?|shts?|boxe?s?|bx|bags?|rolls?|tubes?|lengths?|lf|lin\.?\s?ft|linear\s+(?:feet|ft))\b/);
  if (m) {
    const unit = /linear|lin/.test(m[2]!) ? 'lf' : unitFromWord(m[2]!.replace(/\s/g, ''));
    setQty(Number(m[1]), unit);
    cut(m);
  }
  if (out.qty === null) {
    m = s.match(/\bqty\.?:?\s*(\d{1,5})\b/) ?? s.match(/\((\d{1,5})\)/);
    if (m) {
      setQty(Number(m[1]), null);
      cut(m);
    }
  }
  if (out.qty === null) {
    m = s.match(/(?:\bx|\*|@|-|:|=)\s*(\d{1,5})\s*$/);
    if (m) {
      setQty(Number(m[1]), null);
      cut(m);
    }
  }
  if (out.qty === null) {
    m = s.match(/^\s*(\d{1,5})\b(?!\s*(?:\/|x\s*\d|'|"|ft\b|feet\b))/);
    if (m) {
      setQty(Number(m[1]), null);
      cut(m);
    }
  }
  if (out.qty === null) {
    m = s.match(new RegExp(`^\\s*(${Object.keys(NUMBER_WORDS).join('|')})\\b`));
    if (m) {
      setQty(NUMBER_WORDS[m[1]!]!, null);
      cut(m);
    }
  }
  // A bare number left over after everything else ("2x4 studs 120").
  if (out.qty === null) {
    m = s.match(/\b(\d{1,5})\b(?!\s*(?:\/|'|"))/);
    if (m) {
      setQty(Number(m[1]), null);
      cut(m);
    }
  }
  // Unit words without a number next to them still tell us the unit ("12 x drywall sheets").
  if (!out.qtyUnit) {
    for (const w of s.split(/[^a-z.]+/)) {
      const u = unitFromWord(w);
      if (u && u !== 'piece') {
        out.qtyUnit = u;
        break;
      }
    }
  }

  // Species.
  const words = s.split(/[^a-z0-9&.\-]+/).filter(Boolean);
  const tokens = new Set<string>();
  for (let w of words) {
    w = w.replace(/^[.\-]+|[.\-]+$/g, '');
    if (!w || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    const canon = SYNONYMS[w] ?? SYNONYMS[w.replace(/s$/, '')] ?? w.replace(/s$/, '');
    tokens.add(canon);
  }
  if (tokens.has('pt')) out.species = 'PT';
  else if (tokens.has('df')) out.species = 'DF';
  else if (tokens.has('spf')) out.species = 'SPF';
  if (out.rValue !== null) tokens.add(`r${out.rValue}`);
  if (out.studLength) tokens.add('stud');
  out.tokens = [...tokens];
  return out;
}

/** Split pasted text into items: one per line (semicolons also separate). Bullets and numbering are dropped. */
export function splitList(text: string): string[] {
  return text
    .split(/\r?\n|;/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter((l) => l.length > 1);
}

export function parseList(text: string): ParsedLine[] {
  return splitList(text).map(parseLine);
}
