import { CustodyFlag } from '@prisma/client';

/**
 * Who may collect a child, and on what terms.
 *
 * This is the most consequential decision in the product: releasing a child to the wrong adult
 * is not a bug report, it is a safeguarding incident. The rules live here as pure functions so
 * they can be tested exhaustively and cannot drift between the scanner, the front desk and any
 * future gate app.
 */

export type CollectorKind = 'GUARDIAN' | 'DELEGATE';

export interface Collector {
  kind: CollectorKind;
  /** Guardians carry a custody flag; delegates do not. */
  custodyFlag?: CustodyFlag;
  /** Whether this person is on the child's authorised list. */
  authorised: boolean;
  /** Delegates can be time-limited (a driver for one term, an aunt for one week). */
  expiresAt?: Date | null;
}

export type Verdict =
  | { allowed: true; requiresOverride: false }
  | {
      allowed: true;
      requiresOverride: true;
      reasonCode: 'NOT_AUTHORISED' | 'RESTRICTED' | 'EXPIRED';
    }
  | { allowed: false; reasonCode: 'BLOCKED'; message: string };

/**
 * Decide whether this person may take this child.
 *
 * Three outcomes, not two. A flat allow/deny would force staff to either turn away a legitimate
 * grandmother who is not on the list, or to have no record when they let her through anyway —
 * and in practice they let her through. So the middle case is explicit: permitted, but only by a
 * named member of staff giving a reason, which lands in the release log.
 *
 * BLOCKED is the exception with no middle ground. A custody block is a legal instruction, and
 * no amount of front-desk discretion should override it.
 */
export function assessCollector(c: Collector, now: Date): Verdict {
  if (c.kind === 'GUARDIAN' && c.custodyFlag === 'BLOCKED') {
    return {
      allowed: false,
      reasonCode: 'BLOCKED',
      message: 'This person is blocked from collecting this child. Refer to the head immediately.',
    };
  }
  if (c.kind === 'GUARDIAN' && c.custodyFlag === 'RESTRICTED') {
    return { allowed: true, requiresOverride: true, reasonCode: 'RESTRICTED' };
  }
  if (!c.authorised) {
    return { allowed: true, requiresOverride: true, reasonCode: 'NOT_AUTHORISED' };
  }
  if (c.expiresAt && c.expiresAt.getTime() < now.getTime()) {
    return { allowed: true, requiresOverride: true, reasonCode: 'EXPIRED' };
  }
  return { allowed: true, requiresOverride: false };
}

/** Wording the front desk sees. Plain, and specific about what to do. */
export function verdictMessage(v: Verdict): string {
  if (!v.allowed) return v.message;
  if (!v.requiresOverride) return 'Authorised to collect.';
  switch (v.reasonCode) {
    case 'RESTRICTED':
      return 'Custody is restricted for this guardian. Check with the head before releasing.';
    case 'EXPIRED':
      return 'This person’s authorisation has expired. Confirm with the family before releasing.';
    case 'NOT_AUTHORISED':
      return 'Not on this child’s authorised list. Confirm with the family before releasing.';
  }
}

/** An override without a real reason is just a rubber stamp, so require something substantive. */
export function overrideReasonValid(reason: string | undefined | null): boolean {
  return !!reason && reason.trim().length >= 6;
}

/**
 * A child already sent home today must not be released again — a second release means either a
 * duplicate scan or something badly wrong, and both should stop at the desk.
 */
export function alreadyReleased(todaysReleases: { studentId: string }[], studentId: string) {
  return todaysReleases.some((r) => r.studentId === studentId);
}
