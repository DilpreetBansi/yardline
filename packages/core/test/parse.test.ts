import { describe, expect, it } from 'vitest';
import { parseLine, splitList } from '../src/parse.ts';

type Expect = Partial<{
  qty: number | null;
  qtyUnit: string | null;
  lumber: { thickness: number; width: number; lengthFt: number | null } | null;
  studLength: string | null;
  thickness: string | null;
  sheetSize: string | null;
  fastenerLength: string | null;
  pack: string | null;
  rValue: number | null;
  species: string | null;
  tokens: string[];
}>;

const cases: [string, Expect][] = [
  ['40 2x4x8 SPF', { qty: 40, lumber: { thickness: 2, width: 4, lengthFt: 8 }, species: 'SPF' }],
  ["2x6-16' x 24", { qty: 24, lumber: { thickness: 2, width: 6, lengthFt: 16 } }],
  ['(12) 2x10x12 DF', { qty: 12, lumber: { thickness: 2, width: 10, lengthFt: 12 }, species: 'DF' }],
  ['2x4 8ft studs - 120 pcs', { qty: 120, qtyUnit: 'piece', lumber: { thickness: 2, width: 4, lengthFt: 8 }, tokens: ['stud'] }],
  ['2 x 10 x 16 DF - 18', { qty: 18, lumber: { thickness: 2, width: 10, lengthFt: 16 } }],
  ['2x12x16 doug fir x 30', { qty: 30, species: 'DF', lumber: { thickness: 2, width: 12, lengthFt: 16 } }],
  ['20 pcs 2x6x12 pressure treated', { qty: 20, species: 'PT' }],
  ['PT 4x4x10 - 6', { qty: 6, species: 'PT', lumber: { thickness: 4, width: 4, lengthFt: 10 } }],
  ['40 x 2x4x8', { qty: 40, lumber: { thickness: 2, width: 4, lengthFt: 8 } }],
  ['2x4x8 SPF 40', { qty: 40 }],
  ['2x4 studs 92-5/8 x 200', { qty: 200, studLength: '92-5/8', lumber: { thickness: 2, width: 4, lengthFt: null } }],
  ['300 lf 2x4', { qty: 300, qtyUnit: 'lf', lumber: { thickness: 2, width: 4, lengthFt: null } }],
  ['12 sheets 1/2" plywood', { qty: 12, qtyUnit: 'sheet', thickness: '1/2', tokens: ['plywood'] }],
  ['3/4 T&G plywood x 30', { qty: 30, thickness: '3/4', tokens: ['tg', 'plywood'] }],
  ['1/2 drywall 4x12 x 45', { qty: 45, thickness: '1/2', sheetSize: '4x12', lumber: null }],
  ['5/8 type x drywall 4x8 - 60 sheets', { qty: 60, thickness: '5/8', sheetSize: '4x8', tokens: ['typex', 'drywall'] }],
  ['7/16 osb 4x8 x 80', { qty: 80, thickness: '7/16', sheetSize: '4x8' }],
  ['2" rigid foam x 20', { qty: 20, thickness: '2', tokens: ['foam'] }],
  ['5 boxes 3" deck screws', { qty: 5, qtyUnit: 'box', fastenerLength: '3', tokens: ['deck', 'screw'] }],
  ['3-1/4" framing nails 30 lb x 2', { qty: 2, fastenerLength: '3-1/4', pack: '30lb', tokens: ['framing', 'nail'] }],
  ['6" structural screws box of 50 x 3', { qty: 3, fastenerLength: '6', pack: '50' }],
  ['hurricane ties x50', { qty: 50, tokens: ['hurricane', 'tie'] }],
  ['2x8 joist hangers (20)', { qty: 20, tokens: ['hanger', 'joist'], lumber: { thickness: 2, width: 8, lengthFt: null } }],
  ['4x4 post base x 6', { qty: 6, tokens: ['postbase'] }],
  ['10 bags concrete 30kg', { qty: 10, qtyUnit: 'bag', tokens: ['concrete'] }],
  ['fast setting concrete 15 bags', { qty: 15, qtyUnit: 'bag', tokens: ['fast', 'concrete'] }],
  ['R20 batts 8', { qty: 8, rValue: 20, tokens: ['batt', 'r20'] }],
  ['R-31 insulation x 12', { qty: 12, rValue: 31 }],
  ['two rolls 6 mil poly', { qty: 2, qtyUnit: 'roll', tokens: ['poly'] }],
  ['house wrap 1 roll', { qty: 1, qtyUnit: 'roll', tokens: ['housewrap'] }],
  ['subfloor adhesive x 24', { qty: 24, tokens: ['subfloor', 'adhesive'] }],
  ['qty: 16 2x8x14', { qty: 16, lumber: { thickness: 2, width: 8, lengthFt: 14 } }],
  ['2×6×10 – 36', { qty: 36, lumber: { thickness: 2, width: 6, lengthFt: 10 } }],
  ['misc hardware', { qty: null, lumber: null }],
];

describe('parseLine', () => {
  it.each(cases)('%s', (line, expected) => {
    const got = parseLine(line);
    const { tokens, ...fields } = expected;
    expect(got).toMatchObject(fields);
    for (const t of tokens ?? []) expect(got.tokens).toContain(t);
  });

  it('keeps the original text', () => {
    expect(parseLine('  40 2x4x8 SPF  ').raw).toBe('40 2x4x8 SPF');
  });

  it('never throws on arbitrary input', () => {
    for (const s of ['', 'x', '////', '2x', 'xx 99999999', '"', "''''", '1/0 osb', 'r 9', '(()) 2x4x']) {
      expect(() => parseLine(s)).not.toThrow();
    }
  });
});

describe('splitList', () => {
  it('splits lines and drops bullets and numbering', () => {
    expect(splitList('- 40 2x4x8\n* 12 sheets osb\n3. R20 batts 8\n\n  \n;hurricane ties x50')).toEqual([
      '40 2x4x8',
      '12 sheets osb',
      'R20 batts 8',
      'hurricane ties x50',
    ]);
  });
});
