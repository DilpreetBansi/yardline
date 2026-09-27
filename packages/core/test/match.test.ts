import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../src/catalog.ts';
import { matchLine } from '../src/match.ts';
import { parseLine } from '../src/parse.ts';

const catalog = buildCatalog();
const match = (line: string) => matchLine(parseLine(line), catalog);

describe('matchLine', () => {
  const expected: [string, string, number][] = [
    ['40 2x4x8 SPF', 'LBR-SPF-2X4-08', 40],
    ['(12) 2x10x12 DF', 'LBR-DF-2X10-12', 12],
    ['2x10 x 16 DF - 18', 'LBR-DF-2X10-16', 18],
    ['20 pcs 2x6x12 pressure treated', 'LBR-PT-2X6-12', 20],
    ['2x4 studs 92-5/8 x 200', 'STD-SPF-2X4-9258', 200],
    ['2x4 8ft studs - 120 pcs', 'STD-SPF-2X4-9258', 120],
    ['PT 4x4x10 - 6', 'PST-PT-4X4-10', 6],
    ['6x6x12 PT posts - 4', 'PST-PT-6X6-12', 4],
    ['12 sheets 1/2" plywood', 'SHT-PLY-12', 12],
    ['3/4 T&G plywood x 30', 'SHT-PLY-34TG', 30],
    ['7/16 osb 4x8 x 80', 'SHT-OSB-716', 80],
    ['2" rigid foam x 20', 'SHT-XPS-2', 20],
    ['1/2 drywall 4x12 x 45', 'DRY-12-4X12', 45],
    ['5/8 type x drywall 4x8 - 60 sheets', 'DRY-58X-4X8', 60],
    ['5 boxes 3" deck screws', 'FST-DECK-3-5LB', 5],
    ['3-1/4" framing nails 30 lb x 2', 'FST-NAIL-314-30LB', 2],
    ['6" structural screws box of 50 x 3', 'FST-STRUCT-6-50', 3],
    ['hurricane ties x50', 'HDW-H25', 50],
    ['2x8 joist hangers (20)', 'HDW-HGR-2X8', 20],
    ['4x4 post base x 6', 'HDW-PB-4X4', 6],
    ['10 bags concrete 30kg', 'CON-REG-30', 10],
    ['fast setting concrete 15 bags', 'CON-FAST-30', 15],
    ['R20 batts 8', 'INS-R20', 8],
    ['two rolls 6 mil poly', 'MEM-POLY-6', 2],
    ['subfloor adhesive x 24', 'ADH-SUBFLR-300', 24],
  ];

  it.each(expected)('%s -> %s x %i', (line, sku, qty) => {
    const m = match(line);
    expect(m.best?.product.id).toBe(sku);
    expect(m.qty).toBe(qty);
    expect(m.confidence).not.toBe('none');
  });

  it('is confident when the line pins down one product', () => {
    for (const line of ['(12) 2x10x12 DF', '5/8 type x drywall 4x8 - 60 sheets', 'R20 batts 8', '2x8 joist hangers (20)']) {
      expect(match(line).confidence).toBe('high');
    }
  });

  it('is not confident when the species is missing', () => {
    const m = match("2x6-16' x 24");
    expect(m.best?.product.id).toBe('LBR-SPF-2X6-16');
    expect(m.confidence).not.toBe('high');
    expect(m.candidates.map((c) => c.product.id)).toEqual(expect.arrayContaining(['LBR-DF-2X6-16', 'LBR-PT-2X6-16']));
  });

  it('never picks Type X or moisture-resistant drywall for a plain drywall line', () => {
    const m = match('1/2 drywall 4x8 x 100');
    expect(m.best?.product.id).toBe('DRY-12-4X8');
  });

  it('does not offer OSB when the line says plywood', () => {
    const m = match('3/4 plywood x 10');
    expect(m.best?.product.id).toBe('SHT-PLY-34');
  });

  it('turns linear feet into pieces of the longest stock length', () => {
    const m = match('300 lf 2x4');
    expect(m.best?.product.id).toBe('LBR-SPF-2X4-16');
    expect(m.qty).toBe(19);
    expect(m.notes.join(' ')).toMatch(/300 linear ft = 19 pcs/);
  });

  it('assumes one when there is no quantity and says so', () => {
    const m = match('2x8x12 spf');
    expect(m.qty).toBe(1);
    expect(m.notes[0]).toMatch(/assumed 1/);
  });

  it('refuses lines it cannot place', () => {
    for (const line of ['misc hardware', 'call me about the deck', 'thanks!']) {
      const m = match(line);
      expect(m.best).toBeNull();
      expect(m.confidence).toBe('none');
    }
  });

  it('never matches a lumber size to a different size', () => {
    for (const size of ['2x4', '2x6', '2x8', '2x10', '2x12', '4x4', '6x6']) {
      const m = match(`10 ${size}x12`);
      for (const c of m.candidates) {
        if (c.product.lumber) expect(`${c.product.lumber.thickness}x${c.product.lumber.width}`).toBe(size);
      }
    }
  });
});
