/**
 * "No fees, no report card" — the rule almost every Ghanaian private school runs at the end of
 * term, expressed as one decision so the family portal, the pupil portal and the WhatsApp
 * assistant cannot answer it three different ways.
 *
 * Two things keep it from being cruel, and both are deliberate:
 *
 * - It is **off by default**. Withholding a child's results is a policy a school chooses; a
 *   product that assumed it would be making that choice on their behalf.
 * - It is **overridable per child, with a reason**. A family on an agreed payment plan, a
 *   scholarship still being processed, a bereavement — the exceptions are what make a blunt policy
 *   workable, and an override without a stated reason is a favour rather than a decision.
 *
 * It withholds from *families*. Staff always see every report: the gate is about release, not
 * about the record.
 */

export interface ClearanceInput {
  /** Has the school switched the policy on at all? */
  policyOn: boolean;
  /** What the family owes, cumulative — never a single term's slice. See fees-cumulative-balance. */
  balance: number;
  /** A bursar's explicit override for this child and term. */
  cleared: boolean;
}

export interface ClearanceVerdict {
  /** May the family read the report? */
  allowed: boolean;
  /** Why not, in words a parent should read — empty when allowed. */
  reason: string;
}

/**
 * Rounded to the pesewa before comparing, because a balance is money and a floating-point
 * remainder of 0.000001 is not a debt. Anything at or below zero — including credit — is clear.
 */
export function clearanceVerdict(input: ClearanceInput): ClearanceVerdict {
  if (!input.policyOn) return { allowed: true, reason: '' };
  if (input.cleared) return { allowed: true, reason: '' };
  if (Math.round(input.balance * 100) / 100 <= 0) return { allowed: true, reason: '' };
  /*
    Says what to do about it. "Access denied" tells a parent nothing they can act on, and the
    front desk then spends the afternoon explaining it one telephone call at a time.
  */
  return {
    allowed: false,
    reason:
      'This report is held until the outstanding fees are settled. Please contact the school office to clear the balance or arrange a payment plan.',
  };
}
