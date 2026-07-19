import type { Tier } from '@prisma/client';

/**
 * What a school pays EYO, and when a tier change takes effect.
 *
 * docs/02 §2.12 sets the shape — per-student per-term, published in GHS, undercutting SAFSIMS —
 * and marks the actual numbers ✱ "indicative, finalized during pricing design". So the numbers
 * below are defaults, overridable by env, and the *rules* are what this module is really for:
 * upgrades take effect when money arrives, downgrades never take effect early.
 */

export interface TierPrice {
  tier: Tier;
  /** Per student, per term. */
  perStudent: number;
  /** Charged when per-student comes to less than this — covers the cost of a very small school. */
  floor: number;
  /** Nobody pays more than this in a term, however large they grow. */
  cap: number | null;
}

/**
 * Defaults in GHS per term.
 *
 * Anchored against the research in docs/01: SAFSIMS runs GHS 6k–12k a term, so a 300-pupil
 * school on Medium lands near GHS 1,800 — materially cheaper — while a 60-pupil school pays the
 * floor rather than an amount too small to support.
 */
export const TIER_PRICES: Record<Tier, TierPrice> = {
  BASIC: { tier: 'BASIC', perStudent: 0, floor: 0, cap: 0 },
  MEDIUM: { tier: 'MEDIUM', perStudent: 6, floor: 350, cap: 4000 },
  ADVANCED: { tier: 'ADVANCED', perStudent: 12, floor: 900, cap: 9000 },
};

export interface Quote {
  tier: Tier;
  studentCount: number;
  /** Before floor and cap — shown so a school can see how the number was reached. */
  subtotal: number;
  amount: number;
  currency: string;
  /** Which bound applied, if any. Drives the explanatory line in the UI. */
  applied: 'floor' | 'cap' | null;
}

export function quoteFor(tier: Tier, studentCount: number, currency = 'GHS'): Quote {
  const price = TIER_PRICES[tier];
  const count = Math.max(0, Math.floor(studentCount));
  const subtotal = round2(price.perStudent * count);

  let amount = subtotal;
  let applied: 'floor' | 'cap' | null = null;

  // Basic is free at any size; a floor would turn the free tier into a paid one.
  if (tier !== 'BASIC') {
    if (price.cap !== null && subtotal > price.cap) {
      amount = price.cap;
      applied = 'cap';
    } else if (subtotal < price.floor) {
      amount = price.floor;
      applied = 'floor';
    }
  }

  return { tier, studentCount: count, subtotal, amount: round2(amount), currency, applied };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const RANK: Record<Tier, number> = { BASIC: 0, MEDIUM: 1, ADVANCED: 2 };

export function isUpgrade(from: Tier, to: Tier): boolean {
  return RANK[to] > RANK[from];
}

export type ChangeEffect =
  | { kind: 'upgrade'; immediate: true }
  | { kind: 'downgrade'; immediate: false; effectiveAt: Date }
  | { kind: 'none' };

/**
 * When does moving between tiers actually happen?
 *
 * **Upgrades apply the moment money is confirmed** — never at checkout, only on a settled
 * payment. **Downgrades apply at the end of the paid period**, never immediately: the school has
 * already paid for the term and taking features away mid-term would be taking back something
 * sold. A downgrade is therefore recorded as an intention (`pendingTier`) and applied by the
 * renewal sweep.
 */
export function changeEffect(from: Tier, to: Tier, periodEnd: Date): ChangeEffect {
  if (from === to) return { kind: 'none' };
  if (isUpgrade(from, to)) return { kind: 'upgrade', immediate: true };
  return { kind: 'downgrade', immediate: false, effectiveAt: periodEnd };
}

/**
 * A term is the billing period, matching how Ghanaian schools budget — three a year.
 *
 * Falls back to a fixed ~4 months when no term dates are known, so a school that has not set up
 * its calendar can still subscribe rather than being blocked by unrelated configuration.
 */
export const DEFAULT_PERIOD_DAYS = 122;

export function periodFor(start: Date, termEnd?: Date | null): { start: Date; end: Date } {
  if (termEnd && termEnd.getTime() > start.getTime()) return { start, end: termEnd };
  const end = new Date(start.getTime() + DEFAULT_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Is this subscription still entitled to its tier?
 *
 * Deliberately generous past the end date. A school whose renewal has not cleared keeps working
 * — losing the register mid-term because a MoMo payment is a day late would be indefensible, and
 * docs/03 §3.5 already says an over-cap school is blocked from new enrolments only, never from
 * its own data. `PAST_DUE` is a billing state, not a lockout.
 */
export const GRACE_DAYS = 14;

/** The moment a period that ended at `periodEnd` stops being entitled to its tier. */
export function graceEndsAt(periodEnd: Date, graceDays = GRACE_DAYS): Date {
  return new Date(periodEnd.getTime() + graceDays * 24 * 60 * 60 * 1000);
}

/**
 * The newest `periodEnd` that is already out of grace at `now`.
 *
 * The same rule as `isEntitled`, turned around so a query can express it: `isEntitled` answers
 * for one subscription in hand, this one selects the lapsed rows without loading every row.
 */
export function graceCutoff(now: Date = new Date(), graceDays = GRACE_DAYS): Date {
  return new Date(now.getTime() - graceDays * 24 * 60 * 60 * 1000);
}

export function isEntitled(
  sub: { status: string; periodEnd: Date; tier: Tier },
  now: Date = new Date(),
  graceDays = GRACE_DAYS,
): boolean {
  if (sub.tier === 'BASIC') return true;
  if (sub.status === 'CANCELLED') return false;
  return now.getTime() <= graceEndsAt(sub.periodEnd, graceDays).getTime();
}
