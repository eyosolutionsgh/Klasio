import { describe, expect, it } from 'vitest';
import { DEFAULT_TERM, LICENCE_TERMS, monthsForTerm, termByCode, termLabel } from './terms';

describe('what a school can buy', () => {
  /**
   * The decision this file exists to record. "Bi-annual" means both "twice a year" and "every two
   * years" in ordinary English, and getting it wrong sells a school two years for the price of six
   * months or the reverse. Pinned so nobody re-reads the word and quietly changes it.
   */
  it('sells bi-annually as every two years, and says so in the label', () => {
    expect(monthsForTerm('BIENNIAL')).toBe(24);
    expect(termByCode('BIENNIAL')?.label).toMatch(/2 years/);
  });

  it('offers exactly the four terms with a price', () => {
    expect(LICENCE_TERMS.map((t) => t.months)).toEqual([1, 3, 12, 24]);
  });

  /** Every label states its duration, so the name is never the only thing carrying the meaning. */
  it('spells the duration out on every option', () => {
    for (const term of LICENCE_TERMS) expect(term.label).toMatch(/month|year/);
  });

  it('falls back to a year rather than to nothing', () => {
    expect(monthsForTerm(undefined)).toBe(12);
    expect(monthsForTerm('NOT_A_TERM')).toBe(12);
    expect(termByCode(DEFAULT_TERM)?.months).toBe(12);
  });
});

describe('how a term reads in the history', () => {
  it('names a term that was sold', () => {
    expect(termLabel(1)).toBe('Monthly');
    expect(termLabel(3)).toBe('Quarterly');
    expect(termLabel(12)).toBe('Annually');
    expect(termLabel(24)).toBe('Bi-annually');
  });

  /**
   * A licence cut from the CLI has a duration but no product, and a licence issued before terms
   * existed has neither. Both are true things to say; a blank is not.
   */
  it('reports a bespoke duration as itself, and an unrecorded one as custom', () => {
    expect(termLabel(18)).toBe('18 months');
    expect(termLabel(null)).toBe('Custom term');
    expect(termLabel(undefined)).toBe('Custom term');
  });
});
