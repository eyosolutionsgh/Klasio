/**
 * What a school can buy, and for how long.
 *
 * Four products rather than a free-text number of months: these are the things with a price, and a
 * form that invites any number invites a licence nobody quoted for. Bespoke durations still exist
 * for trials and bridges — `licence:mint --days 20` — which is the right place for them, because
 * they are an exception someone should have to reach for.
 *
 * "Bi-annually" is 24 months here. The word means both "twice a year" and "every two years"
 * depending on who is saying it, so it is never shown on its own: the label spells the duration
 * out, and nobody has to know which reading was intended.
 */
export interface LicenceTerm {
  code: string;
  /** Says the duration, so the name can never be the only thing carrying the meaning. */
  label: string;
  months: number;
}

export const LICENCE_TERMS: LicenceTerm[] = [
  { code: 'MONTHLY', label: 'Monthly — 1 month', months: 1 },
  { code: 'QUARTERLY', label: 'Quarterly — 3 months', months: 3 },
  { code: 'ANNUAL', label: 'Annually — 12 months', months: 12 },
  { code: 'BIENNIAL', label: 'Bi-annually — every 2 years', months: 24 },
];

/** The default on the issue form: what most schools buy, and what a renewal usually is. */
export const DEFAULT_TERM = 'ANNUAL';

export function termByCode(code: string | undefined | null): LicenceTerm | null {
  return LICENCE_TERMS.find((t) => t.code === code) ?? null;
}

/** Months for a code, falling back to a year rather than to nothing. */
export function monthsForTerm(code: string | undefined | null): number {
  return termByCode(code)?.months ?? termByCode(DEFAULT_TERM)!.months;
}

/**
 * How a licence's term reads in its history.
 *
 * Takes months rather than a code because that is what is stored, and because a licence cut from
 * the CLI has a duration but no product. An unrecognised number is reported as itself — "18
 * months" is a true thing to say about a bespoke licence, where a blank is not.
 */
export function termLabel(months: number | null | undefined): string {
  if (months === null || months === undefined) return 'Custom term';
  const known = LICENCE_TERMS.find((t) => t.months === months);
  if (known) return known.label.split(' — ')[0];
  return months === 1 ? '1 month' : `${months} months`;
}
