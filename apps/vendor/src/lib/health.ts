/**
 * How a client looks on the dashboard.
 *
 * Pure, and in its own file so it can be tested without a database: this is the judgement the
 * whole portal exists to make, and it is exactly the kind of ranked-priority logic that goes
 * subtly wrong — a school flagged for the less useful of two true facts is worse than one not
 * flagged at all, because it trains people to skim the column.
 *
 * Computed only from what the vendor knows — the licence it issued, and the reports it has been
 * sent. The portal has no route into a school's server and should not grow one.
 */
import type { LicenceTier } from '@eyo/shared';

export type ClientHealth = 'OK' | 'EXPIRING' | 'EXPIRED' | 'SILENT' | 'UNLICENSED' | 'ATTENTION';

export interface ClientRow {
  id: string;
  name: string;
  slug: string;
  tier: LicenceTier | null;
  expiresAt: Date | null;
  daysRemaining: number | null;
  lastSeen: Date | null;
  students: number | null;
  verifiedWith: string | null;
  tierInForce: string | null;
  health: ClientHealth;
  /** Why it is flagged, in words a person can act on. */
  note: string | null;
}

const DAY = 86_400_000;
/** A box that has not reported in this long is worth a look — three missed daily reports. */
export const SILENT_AFTER_DAYS = 3;
const WARN_WITHIN_DAYS = 30;

export function assessClient(input: {
  licence: { tier: LicenceTier; expiresAt: Date } | null;
  /**
   * Whether this client has ever had a licence, withdrawn ones included.
   *
   * Only changes the wording, and the wording is the point: "no licence has been issued" is a
   * false thing to say about a school whose licence was withdrawn this morning, and it is the one
   * sentence someone reads before ringing them.
   */
  everIssued?: boolean;
  lastBeat: {
    receivedAt: Date;
    verifiedWith: string | null;
    tierInForce: string | null;
    students: number | null;
  } | null;
  now?: Date;
}): { health: ClientHealth; note: string | null; daysRemaining: number | null } {
  const now = input.now ?? new Date();
  const { licence, lastBeat } = input;

  if (!licence) {
    return {
      health: 'UNLICENSED',
      note: input.everIssued
        ? 'Every licence issued to this client has been withdrawn'
        : 'No licence has been issued to this client',
      daysRemaining: null,
    };
  }

  const daysRemaining = Math.ceil((licence.expiresAt.getTime() - now.getTime()) / DAY);

  /*
    Tampering outranks everything, including expiry.

    A box verifying against the development key — whose private half is public — can mint itself
    anything, so what its licence says has stopped being evidence of what it is running. That is a
    phone call, not a renewal reminder.
  */
  if (lastBeat?.verifiedWith && lastBeat.verifiedWith !== 'vendor') {
    return {
      health: 'ATTENTION',
      note:
        lastBeat.verifiedWith === 'development'
          ? 'Verifying licences with the development key — this server can issue itself any package'
          : 'Running without a vendor key, so its licences go unverified',
      daysRemaining,
    };
  }

  /*
    Running a package other than the one on the licence.

    Ranked directly below tampering, and above expiry, because the two have the same shape: what
    the licence says has stopped describing what the box is doing. It is usually innocent — a
    renewal issued this morning that the school has yet to install — but "usually innocent" is a
    thing to confirm on a call, and the row said ACTIVE while showing the mismatch in red before
    this existed, which is the dashboard disagreeing with itself.
  */
  if (lastBeat?.tierInForce && lastBeat.tierInForce !== licence.tier) {
    return {
      health: 'ATTENTION',
      note: `Running ${lastBeat.tierInForce} on a ${licence.tier} licence — either the new licence is yet to be installed, or it was never issued`,
      daysRemaining,
    };
  }

  if (daysRemaining < 0) {
    return { health: 'EXPIRED', note: `Licence expired ${-daysRemaining} days ago`, daysRemaining };
  }

  /*
    Silence is checked after expiry, not before.

    A box that lapsed and went quiet is an expiry — the more useful of the two facts, and the one
    with an obvious next step. Silence only leads when the licence is otherwise fine, where it is
    the only thing worth saying.
  */
  if (lastBeat) {
    const daysQuiet = Math.floor((now.getTime() - lastBeat.receivedAt.getTime()) / DAY);
    if (daysQuiet >= SILENT_AFTER_DAYS) {
      return {
        health: 'SILENT',
        note: `No report for ${daysQuiet} days`,
        daysRemaining,
      };
    }
  }

  if (daysRemaining <= WARN_WITHIN_DAYS) {
    return { health: 'EXPIRING', note: `Expires in ${daysRemaining} days`, daysRemaining };
  }

  return { health: 'OK', note: null, daysRemaining };
}
