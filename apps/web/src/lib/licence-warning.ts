/**
 * What, if anything, the portal should say about the licence.
 *
 * Separated from the banner component so the decisions can be tested without rendering anything —
 * and they are decisions, not formatting: when to stay silent, when amber becomes red, and what a
 * school is told it has *not* lost.
 */
export type LicenceState = 'VALID' | 'GRACE' | 'EXPIRED' | 'MISSING' | 'INVALID';

export interface LicenceStatus {
  state: LicenceState;
  daysRemaining: number | null;
}

export interface LicenceWarning {
  tone: 'warn' | 'danger';
  headline: string;
  detail: string;
}

/** Inside this many days of expiry, start saying so. */
export const WARN_WITHIN_DAYS = 30;

export function licenceWarning(status: LicenceStatus | null): LicenceWarning | null {
  if (!status) return null;
  const days = status.daysRemaining;

  switch (status.state) {
    case 'GRACE':
      return {
        tone: 'warn',
        headline: 'Your licence has expired.',
        detail:
          'Everything still works for now, during the grace period. Install a renewal before it ends to avoid losing features.',
      };

    case 'EXPIRED':
      return {
        tone: 'danger',
        headline: 'Your licence has expired and the grace period has passed.',
        // Says what was lost and what was not, in that order. A school watching features
        // disappear needs to know its records are untouched before it needs to know how to fix it.
        detail:
          'This school is now on the free package. Your records are all still here and can still be exported — install a renewal to restore the rest.',
      };

    case 'INVALID':
      return {
        tone: 'danger',
        headline: 'Your licence could not be verified.',
        detail:
          'This school is running on the free package until a valid licence is installed. Check with your supplier.',
      };

    case 'VALID':
      if (days === null || days > WARN_WITHIN_DAYS) return null;
      return {
        tone: 'warn',
        headline:
          days <= 0
            ? 'Your licence expires today.'
            : `Your licence expires in ${days} day${days === 1 ? '' : 's'}.`,
        detail: 'Ask your supplier for a renewal and install it here — nothing is interrupted.',
      };

    /**
     * MISSING says nothing, deliberately.
     *
     * A school on the free package has made a valid choice and does not need reminding of it every
     * morning. This warns about what is *changing* — an expiry approaching, a grace period
     * running, a file that stopped verifying — and stays quiet about a steady state, because a
     * banner that is always there is one nobody reads.
     */
    case 'MISSING':
    default:
      return null;
  }
}
