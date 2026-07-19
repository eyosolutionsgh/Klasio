import { describe, expect, it } from 'vitest';
import {
  matchLine,
  parseSettlementCsv,
  reconcile,
  type KnownIntent,
  type SettlementLine,
} from './reconcile';

const intents: KnownIntent[] = [
  { id: 'i1', reference: 'ONL-aaa', amount: 500 },
  { id: 'i2', reference: 'ONL-bbb', amount: 250.5 },
];
const index = new Map(intents.map((i) => [i.reference, i]));
const line = (over: Partial<SettlementLine> = {}): SettlementLine => ({
  reference: 'ONL-aaa',
  gross: 500,
  net: 493.75,
  ...over,
});

describe('matchLine', () => {
  it('matches on reference and records what the gateway kept', () => {
    const r = matchLine(line(), index);
    expect(r.status).toBe('MATCHED');
    expect(r.intentId).toBe('i1');
    expect(r.charge).toBe(6.25);
  });

  it('flags money arriving for a payment we never issued', () => {
    const r = matchLine(line({ reference: 'ONL-zzz' }), index);
    expect(r.status).toBe('UNMATCHED');
    expect(r.note).toContain('ONL-zzz');
  });

  it('disputes a short payment and says how short, in words a bursar can act on', () => {
    const r = matchLine(line({ gross: 450 }), index);
    expect(r.status).toBe('DISPUTED');
    expect(r.note).toContain('50.00 short');
  });

  it('disputes an overpayment too', () => {
    const r = matchLine(line({ gross: 560 }), index);
    expect(r.status).toBe('DISPUTED');
    expect(r.note).toContain('60.00 more than expected');
  });

  it('absorbs a pesewa of rounding rather than raising a false alarm', () => {
    // Gateways round their own fee arithmetic differently. One pesewa is not a discrepancy.
    expect(matchLine(line({ gross: 500.01 }), index).status).toBe('MATCHED');
    expect(matchLine(line({ gross: 499.99 }), index).status).toBe('MATCHED');
  });

  it('does not absorb a real shortfall just above tolerance', () => {
    expect(matchLine(line({ gross: 499.9 }), index).status).toBe('DISPUTED');
  });

  it('compares in minor units so decimal addition cannot drift', () => {
    const r = matchLine({ reference: 'ONL-bbb', gross: 250.5, net: 250.5 }, index);
    expect(r.status).toBe('MATCHED');
    expect(r.charge).toBe(0);
  });

  it('refuses to invent a negative fee when net exceeds gross', () => {
    const r = matchLine(line({ gross: 100, net: 400 }), index);
    expect(r.status).toBe('DISPUTED');
  });

  it('ignores surrounding whitespace on the reference', () => {
    expect(matchLine(line({ reference: '  ONL-aaa  ' }), index).status).toBe('MATCHED');
  });
});

describe('reconcile', () => {
  it('summarises a mixed file', () => {
    const { summary } = reconcile(
      [
        line(),
        line({ reference: 'ONL-bbb', gross: 250.5, net: 247 }),
        line({ reference: 'ONL-ghost', gross: 90, net: 88 }),
      ],
      intents,
    );
    expect(summary).toMatchObject({ matched: 2, unmatched: 1, disputed: 0 });
    expect(summary.grossTotal).toBe(840.5);
    expect(summary.netTotal).toBe(828.75);
    expect(summary.chargesTotal).toBe(9.75);
  });

  it('reports payments the file never mentions', () => {
    // A file that simply omits a payment looks like a clean run if you only check the rows you
    // were handed. This is the half that catches money that never arrived.
    const { summary } = reconcile([line()], intents);
    expect(summary.missingReferences).toEqual(['ONL-bbb']);
  });

  it('counts a disputed line as seen, so it is not also reported missing', () => {
    const { summary } = reconcile(
      [line({ gross: 400 }), line({ reference: 'ONL-bbb', gross: 250.5, net: 248 })],
      intents,
    );
    expect(summary.disputed).toBe(1);
    expect(summary.missingReferences).toEqual([]);
  });
});

describe('parseSettlementCsv', () => {
  it('finds columns by header name rather than position', () => {
    // Hubtel and Paystack disagree on column order; a positional parser reads the wrong one.
    const csv = [
      'Settlement Amount,Customer,Transaction Reference,Amount',
      '493.75,Ama Owusu,ONL-aaa,500.00',
    ].join('\n');
    expect(parseSettlementCsv(csv)).toEqual([{ reference: 'ONL-aaa', gross: 500, net: 493.75 }]);
  });

  it('strips currency symbols and thousands separators', () => {
    const csv = 'Reference,Amount,Net\nONL-aaa,"GHS 1,500.00","GHS 1,477.50"';
    expect(parseSettlementCsv(csv)).toEqual([{ reference: 'ONL-aaa', gross: 1500, net: 1477.5 }]);
  });

  it('treats net as gross when the file has no settlement column', () => {
    const csv = 'Reference,Amount\nONL-aaa,500.00';
    expect(parseSettlementCsv(csv)).toEqual([{ reference: 'ONL-aaa', gross: 500, net: 500 }]);
  });

  it('respects quoted cells containing commas', () => {
    const csv = 'Reference,Customer,Amount\nONL-aaa,"Owusu, Ama",500.00';
    expect(parseSettlementCsv(csv)[0].gross).toBe(500);
  });

  it('skips rows with no reference rather than inventing blank ones', () => {
    const csv = 'Reference,Amount\n,500.00\nONL-aaa,500.00';
    expect(parseSettlementCsv(csv)).toHaveLength(1);
  });

  it('returns nothing for a file with no recognisable columns', () => {
    expect(parseSettlementCsv('name,phone\nAma,024')).toEqual([]);
    expect(parseSettlementCsv('')).toEqual([]);
  });
});

describe('repeated references', () => {
  const expected = [{ reference: 'ONL-aaa', amount: 500, id: 'i1' }];

  it('counts a reference once when the file lists it twice', () => {
    // A gateway re-export, or two exports concatenated. Matching both would credit the school
    // with a fee it never paid and money it never received.
    const { results, summary } = reconcile(
      [
        { reference: 'ONL-aaa', gross: 500, net: 490 },
        { reference: 'ONL-aaa', gross: 500, net: 490 },
      ],
      expected,
    );
    expect(results.map((r) => r.status)).toEqual(['MATCHED', 'DUPLICATE']);
    expect(summary.matched).toBe(1);
    expect(summary.duplicate).toBe(1);
    expect(summary.chargesTotal).toBe(10);
  });

  it('still reports the duplicate rather than hiding it', () => {
    const { results } = reconcile(
      [
        { reference: 'ONL-aaa', gross: 500, net: 490 },
        { reference: 'ONL-aaa', gross: 500, net: 490 },
      ],
      expected,
    );
    expect(results[1].note).toMatch(/more than once/i);
  });

  it('does not treat two genuinely different references as duplicates', () => {
    const { summary } = reconcile(
      [
        { reference: 'ONL-aaa', gross: 500, net: 490 },
        { reference: 'ONL-bbb', gross: 300, net: 295 },
      ],
      [...expected, { reference: 'ONL-bbb', amount: 300, id: 'i2' }],
    );
    expect(summary.matched).toBe(2);
    expect(summary.duplicate).toBe(0);
  });

  it('lets a repeated unmatched reference stay unmatched, not duplicate', () => {
    // Nothing was claimed the first time, so the second line is just as unknown as the first —
    // reporting it as a duplicate would imply we had matched one of them.
    const { summary } = reconcile(
      [
        { reference: 'ONL-zzz', gross: 500, net: 490 },
        { reference: 'ONL-zzz', gross: 500, net: 490 },
      ],
      expected,
    );
    expect(summary.unmatched).toBe(2);
    expect(summary.duplicate).toBe(0);
  });
});
