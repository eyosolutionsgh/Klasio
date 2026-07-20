import { describe, expect, it } from 'vitest';
import { balanceOf } from './ledger';
import { statementLines, type StatementEntry } from './statement';

const at = (day: number) => new Date(2026, 6, day);

const entry = (over: Partial<StatementEntry> & { id: string }): StatementEntry => ({
  type: 'INVOICE',
  amount: 100,
  reference: `REF-${over.id}`,
  createdAt: at(1),
  ...over,
});

describe('statementLines', () => {
  it('runs the balance chronologically and matches balanceOf at the end', () => {
    const entries = [
      entry({ id: 'a', type: 'INVOICE', amount: 500, createdAt: at(1) }),
      entry({ id: 'b', type: 'PAYMENT', amount: 200, method: 'CASH', createdAt: at(3) }),
      entry({ id: 'c', type: 'DISCOUNT', amount: 50, createdAt: at(5) }),
    ];
    const { lines, totals } = statementLines(entries);
    expect(lines.map((l) => l.balance)).toEqual([500, 300, 250]);
    expect(totals.billed).toBe(500);
    expect(totals.credited).toBe(250);
    expect(totals.balance).toBe(balanceOf(entries));
    expect(totals.balance).toBe(250);
  });

  it('shows both the reversed charge and its reversal, and still lands on balanceOf', () => {
    const entries = [
      entry({ id: 'a', type: 'INVOICE', amount: 500, createdAt: at(1) }),
      entry({ id: 'dup', type: 'INVOICE', amount: 500, createdAt: at(1) }),
      entry({ id: 'rev', type: 'REVERSAL', amount: 500, reversedId: 'dup', createdAt: at(4) }),
      entry({ id: 'pay', type: 'PAYMENT', amount: 300, createdAt: at(6) }),
    ];
    const { lines, totals } = statementLines(entries);
    // All four rows are visible — corrections never hide history.
    expect(lines).toHaveLength(4);
    expect(lines.map((l) => l.balance)).toEqual([500, 1000, 500, 200]);
    expect(totals.balance).toBe(balanceOf(entries));
    expect(totals.balance).toBe(200);
  });

  it('a reversal of a payment puts the amount back on the bill', () => {
    const entries = [
      entry({ id: 'a', type: 'INVOICE', amount: 400, createdAt: at(1) }),
      entry({ id: 'p', type: 'PAYMENT', amount: 400, createdAt: at(2) }),
      entry({ id: 'r', type: 'REVERSAL', amount: 400, reversedId: 'p', createdAt: at(3) }),
    ];
    const { lines, totals } = statementLines(entries);
    expect(lines.map((l) => l.balance)).toEqual([400, 0, 400]);
    expect(totals.balance).toBe(400);
  });
});
