import { describe, expect, it } from 'vitest';
import { balanceOf, isLive, reversedIds } from './ledger';

const e = (id: string, type: string, amount: number, reversedId?: string) => ({
  id,
  type,
  amount,
  reversedId,
});

describe('balanceOf', () => {
  it('adds invoices and subtracts everything else', () => {
    expect(
      balanceOf([
        e('a', 'INVOICE', 1390),
        e('b', 'PAYMENT', 500),
        e('c', 'DISCOUNT', 100),
        e('d', 'WAIVER', 90),
      ]),
    ).toBe(700);
  });

  it('cancels the entry a reversal points at, not just the reversal', () => {
    // The bug this file exists for: an invoice raised twice by mistake. The bursar appends the
    // documented correction and the balance has to actually move.
    const entries = [
      e('inv1', 'INVOICE', 1390),
      e('inv2', 'INVOICE', 1390),
      e('rev', 'REVERSAL', 1390, 'inv2'),
    ];
    expect(balanceOf(entries)).toBe(1390);
  });

  it('reverses a payment back onto the balance', () => {
    // A bounced cheque is the mirror case: the money leaves again, so the family owes it again.
    expect(
      balanceOf([e('i', 'INVOICE', 1000), e('p', 'PAYMENT', 400), e('r', 'REVERSAL', 400, 'p')]),
    ).toBe(1000);
  });

  it('ignores a reversal that points at nothing', () => {
    // Legacy rows predate reversedId. They must not silently cancel an arbitrary entry.
    expect(balanceOf([e('i', 'INVOICE', 1000), e('r', 'REVERSAL', 400)])).toBe(1000);
  });

  it('does not double-cancel when a reversal is replayed', () => {
    expect(
      balanceOf([
        e('i', 'INVOICE', 1000),
        e('p', 'PAYMENT', 400),
        e('r1', 'REVERSAL', 400, 'p'),
        e('r2', 'REVERSAL', 400, 'p'),
      ]),
    ).toBe(1000);
  });

  it('rounds once at the end rather than per entry', () => {
    const thirds = Array.from({ length: 3 }, (_, i) => e(`t${i}`, 'INVOICE', 0.005));
    expect(balanceOf(thirds)).toBe(0.02);
  });

  it('is zero for an empty ledger', () => {
    expect(balanceOf([])).toBe(0);
  });

  it('skips an unparseable amount rather than poisoning the balance to NaN', () => {
    expect(balanceOf([e('i', 'INVOICE', 100), { id: 'x', type: 'PAYMENT', amount: null }])).toBe(
      100,
    );
  });

  it('accepts Decimal-like amounts', () => {
    // Prisma hands back Decimal objects, not numbers.
    const dec = (v: number) => ({ toString: () => String(v), valueOf: () => v });
    expect(balanceOf([{ id: 'i', type: 'INVOICE', amount: dec(1390) }])).toBe(1390);
  });
});

describe('reversedIds / isLive', () => {
  it('names what has been cancelled', () => {
    expect([...reversedIds([e('r', 'REVERSAL', 1, 'inv2')])]).toEqual(['inv2']);
  });

  it('hides both halves of a correction from a listing', () => {
    const entries = [e('i', 'INVOICE', 100), e('r', 'REVERSAL', 100, 'i')];
    const rev = reversedIds(entries);
    expect(entries.filter((x) => isLive(x, rev))).toEqual([]);
  });
});
