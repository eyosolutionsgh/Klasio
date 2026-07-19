import { describe, expect, it } from 'vitest';
import {
  changeEffect,
  graceCutoff,
  GRACE_DAYS,
  isEntitled,
  isUpgrade,
  periodFor,
  quoteFor,
  TIER_PRICES,
} from './pricing';

const at = (iso: string) => new Date(iso);

describe('quoteFor', () => {
  it('charges per student per term', () => {
    const q = quoteFor('MEDIUM', 300);
    expect(q.subtotal).toBe(1800);
    expect(q.amount).toBe(1800);
    expect(q.applied).toBeNull();
  });

  it('applies a floor for a very small school', () => {
    const q = quoteFor('MEDIUM', 20);
    expect(q.subtotal).toBe(120);
    expect(q.amount).toBe(TIER_PRICES.MEDIUM.floor);
    expect(q.applied).toBe('floor');
  });

  it('applies a cap for a very large one', () => {
    const q = quoteFor('MEDIUM', 5000);
    expect(q.subtotal).toBe(30000);
    expect(q.amount).toBe(TIER_PRICES.MEDIUM.cap);
    expect(q.applied).toBe('cap');
  });

  it('keeps Basic free at every size, floor included', () => {
    // A floor on the free tier would quietly make it a paid one.
    for (const n of [0, 1, 150, 10000]) {
      const q = quoteFor('BASIC', n);
      expect(q.amount).toBe(0);
      expect(q.applied).toBeNull();
    }
  });

  it('prices Advanced above Medium at the same size', () => {
    expect(quoteFor('ADVANCED', 300).amount).toBeGreaterThan(quoteFor('MEDIUM', 300).amount);
  });

  it('never charges for a negative or fractional roll', () => {
    expect(quoteFor('MEDIUM', -5).studentCount).toBe(0);
    expect(quoteFor('MEDIUM', 10.7).studentCount).toBe(10);
  });

  it('shows the subtotal even when a bound overrides it, so the price is explicable', () => {
    const q = quoteFor('MEDIUM', 20);
    expect(q.subtotal).not.toBe(q.amount);
  });
});

describe('changeEffect', () => {
  const periodEnd = at('2026-12-20T00:00:00Z');

  it('applies an upgrade immediately', () => {
    expect(changeEffect('BASIC', 'MEDIUM', periodEnd)).toEqual({
      kind: 'upgrade',
      immediate: true,
    });
    expect(changeEffect('MEDIUM', 'ADVANCED', periodEnd).kind).toBe('upgrade');
  });

  it('defers a downgrade to the end of the paid period', () => {
    // The term is already paid for. Taking features away mid-term takes back something sold.
    const e = changeEffect('ADVANCED', 'MEDIUM', periodEnd);
    expect(e).toEqual({ kind: 'downgrade', immediate: false, effectiveAt: periodEnd });
  });

  it('defers dropping to Basic too', () => {
    expect(changeEffect('MEDIUM', 'BASIC', periodEnd).kind).toBe('downgrade');
  });

  it('does nothing when the tier is unchanged', () => {
    expect(changeEffect('MEDIUM', 'MEDIUM', periodEnd)).toEqual({ kind: 'none' });
  });

  it('ranks tiers consistently', () => {
    expect(isUpgrade('BASIC', 'ADVANCED')).toBe(true);
    expect(isUpgrade('ADVANCED', 'BASIC')).toBe(false);
    expect(isUpgrade('MEDIUM', 'MEDIUM')).toBe(false);
  });
});

describe('periodFor', () => {
  it('bills to the end of the term when the calendar knows it', () => {
    const p = periodFor(at('2026-09-01T00:00:00Z'), at('2026-12-20T00:00:00Z'));
    expect(p.end.toISOString()).toBe('2026-12-20T00:00:00.000Z');
  });

  it('falls back to a fixed period when no term is set', () => {
    // A school that has not built its calendar must still be able to subscribe.
    const p = periodFor(at('2026-09-01T00:00:00Z'), null);
    expect(p.end.getTime()).toBeGreaterThan(p.start.getTime());
  });

  it('ignores a term end that is already past', () => {
    const p = periodFor(at('2026-09-01T00:00:00Z'), at('2026-01-01T00:00:00Z'));
    expect(p.end.getTime()).toBeGreaterThan(p.start.getTime());
  });
});

describe('isEntitled', () => {
  const base = { status: 'ACTIVE', periodEnd: at('2026-12-20T00:00:00Z'), tier: 'MEDIUM' as const };

  it('is entitled inside the period', () => {
    expect(isEntitled(base, at('2026-11-01T00:00:00Z'))).toBe(true);
  });

  it('keeps working through the grace period after the period ends', () => {
    // Losing the register mid-term because a MoMo payment is a day late is indefensible.
    expect(isEntitled({ ...base, status: 'PAST_DUE' }, at('2026-12-27T00:00:00Z'))).toBe(true);
  });

  it('finally lapses well after grace', () => {
    expect(isEntitled({ ...base, status: 'PAST_DUE' }, at('2027-02-01T00:00:00Z'))).toBe(false);
  });

  it('treats Basic as always entitled', () => {
    // Nothing to lapse from: the free tier has no period to run out.
    expect(
      isEntitled({ ...base, tier: 'BASIC', status: 'CANCELLED' }, at('2030-01-01T00:00:00Z')),
    ).toBe(true);
  });

  it('is not entitled once cancelled outright', () => {
    expect(isEntitled({ ...base, status: 'CANCELLED' }, at('2026-11-01T00:00:00Z'))).toBe(false);
  });
});

describe('graceCutoff', () => {
  // The downgrade sweep selects rows with `periodEnd <= graceCutoff(now)`. If that disagreed
  // with `isEntitled` in either direction the product would contradict itself: schools losing
  // features the billing page still calls entitled, or the reverse.
  const tier = 'MEDIUM' as const;

  it('agrees with isEntitled on the day a subscription lapses', () => {
    const now = at('2027-02-01T00:00:00Z');
    const cutoff = graceCutoff(now);

    // The sweep selects `periodEnd < cutoff`, strictly. The boundary itself is still entitled,
    // because `isEntitled` compares inclusively — hence the strict `lt` in `applyLapses`.
    expect(isEntitled({ status: 'PAST_DUE', periodEnd: cutoff, tier }, now)).toBe(true);

    // A minute either side settles which way each falls.
    const lapsed = new Date(cutoff.getTime() - 60_000);
    expect(isEntitled({ status: 'PAST_DUE', periodEnd: lapsed, tier }, now)).toBe(false);
    const inGrace = new Date(cutoff.getTime() + 60_000);
    expect(isEntitled({ status: 'PAST_DUE', periodEnd: inGrace, tier }, now)).toBe(true);
  });

  it('is the grace period behind now', () => {
    const now = at('2027-02-01T00:00:00Z');
    const days = (now.getTime() - graceCutoff(now).getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(GRACE_DAYS);
  });
});
