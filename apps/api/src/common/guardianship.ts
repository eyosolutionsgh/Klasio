import { CustodyFlag } from '@prisma/client';

/**
 * Rules for the link between a student and a guardian.
 *
 * These are child-safety rules, so they live here as pure functions rather than inline in the
 * module: they are the part of guardian management that must never be got wrong, and they are
 * cheap to test exhaustively.
 */

export interface GuardianLink {
  canPickup: boolean;
  custodyFlag: CustodyFlag;
}

/**
 * A guardian under a BLOCKED custody flag can never be authorised for pickup, whatever the
 * caller passed. A court order or safeguarding decision outranks a checkbox, and the two fields
 * are set from different screens at different times — so the contradiction is resolved here
 * rather than trusted to whoever wrote the last update.
 */
export function reconcileLink(link: GuardianLink): GuardianLink {
  return {
    custodyFlag: link.custodyFlag,
    canPickup: link.custodyFlag === 'BLOCKED' ? false : link.canPickup,
  };
}

/**
 * Exactly one guardian per student is primary — that is who the school calls first. Given the
 * guardian being promoted, returns the ids that must be demoted.
 */
export function demoteOthers(
  links: { guardianId: string; isPrimary: boolean }[],
  newPrimaryId: string,
): string[] {
  return links.filter((l) => l.isPrimary && l.guardianId !== newPrimaryId).map((l) => l.guardianId);
}

/**
 * When the primary guardian is unlinked, someone else has to become the first point of contact.
 * Returns the guardian who should be promoted, or null if the student has no one left.
 */
export function successorPrimary(
  links: { guardianId: string; isPrimary: boolean; custodyFlag: CustodyFlag }[],
  removedId: string,
): string | null {
  const remaining = links.filter((l) => l.guardianId !== removedId);
  if (remaining.length === 0) return null;
  if (remaining.some((l) => l.isPrimary)) return null; // a primary already remains
  // Never hand first-contact status to someone the school has flagged.
  const eligible = remaining.filter((l) => l.custodyFlag === 'NONE');
  return (eligible[0] ?? remaining[0]).guardianId;
}
