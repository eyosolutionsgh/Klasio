import { describe, expect, it } from 'vitest';
import { journalLines, journalTotals, type JournalSource } from './journal';

const entry = (over: Partial<JournalSource> & { id: string }): JournalSource => ({
  type: 'INVOICE',
  amount: 100,
  method: null,
  reference: `REF-${over.id}`,
  reversedId: null,
  createdAt: new Date(2026, 6, 1),
  studentName: 'Ama Mensah',
  ...over,
});

describe('journalLines', () => {
  it('maps each entry to one balanced pair over the little chart of accounts', () => {
    const lines = journalLines([
      entry({ id: 'a', type: 'INVOICE', amount: 900 }),
      entry({ id: 'b', type: 'PAYMENT', amount: 400, method: 'MOMO' }),
      entry({ id: 'c', type: 'DISCOUNT', amount: 50 }),
    ]);
    expect(lines).toHaveLength(6);
    expect(lines[0]).toMatchObject({ account: 'Fees Receivable', debit: 900 });
    expect(lines[1]).toMatchObject({ account: 'Fees Income', credit: 900 });
    expect(lines[2]).toMatchObject({ account: 'Mobile Money', debit: 400 });
    expect(lines[3]).toMatchObject({ account: 'Fees Receivable', credit: 400 });
    expect(lines[4]).toMatchObject({ account: 'Discounts & Waivers Granted', debit: 50 });

    const totals = journalTotals(lines);
    expect(totals.debits).toBe(totals.credits);
    expect(totals.debits).toBe(1350);
  });

  it('a reversal is the mirror image of what it cancels', () => {
    const lines = journalLines([
      entry({ id: 'inv', type: 'INVOICE', amount: 500 }),
      entry({ id: 'rev', type: 'REVERSAL', amount: 500, reversedId: 'inv' }),
    ]);
    // Reversal pair: Dr Fees Income / Cr Fees Receivable — undoing the invoice's pair.
    expect(lines[2]).toMatchObject({ account: 'Fees Income', debit: 500 });
    expect(lines[3]).toMatchObject({ account: 'Fees Receivable', credit: 500 });
    const totals = journalTotals(lines);
    expect(totals.debits).toBe(totals.credits);
  });

  it('a reversal whose target is missing produces nothing rather than an unbalanced line', () => {
    const lines = journalLines([entry({ id: 'rev', type: 'REVERSAL', reversedId: 'ghost' })]);
    expect(lines).toHaveLength(0);
  });
});
