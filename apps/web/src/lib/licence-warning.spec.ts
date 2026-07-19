import { describe, expect, it } from 'vitest';
import { licenceWarning, WARN_WITHIN_DAYS, type LicenceStatus } from './licence-warning';

const status = (over: Partial<LicenceStatus>): LicenceStatus => ({
  state: 'VALID',
  daysRemaining: 365,
  ...over,
});

describe('licence warning', () => {
  it('says nothing while the licence is comfortably in date', () => {
    expect(licenceWarning(status({ daysRemaining: 365 }))).toBeNull();
    expect(licenceWarning(status({ daysRemaining: WARN_WITHIN_DAYS + 1 }))).toBeNull();
  });

  /**
   * The threshold is the whole point of the feature: a school that is told on the day it expires
   * has not been given time to do anything about it.
   */
  it('starts warning exactly at the threshold, and not a day earlier', () => {
    expect(licenceWarning(status({ daysRemaining: WARN_WITHIN_DAYS }))?.tone).toBe('warn');
    expect(licenceWarning(status({ daysRemaining: WARN_WITHIN_DAYS + 1 }))).toBeNull();
  });

  it('counts down in readable English, including the singular', () => {
    expect(licenceWarning(status({ daysRemaining: 20 }))?.headline).toBe(
      'Your licence expires in 20 days.',
    );
    expect(licenceWarning(status({ daysRemaining: 1 }))?.headline).toBe(
      'Your licence expires in 1 day.',
    );
    expect(licenceWarning(status({ daysRemaining: 0 }))?.headline).toBe(
      'Your licence expires today.',
    );
  });

  it('stays amber through the grace period, because nothing has actually stopped', () => {
    const w = licenceWarning(status({ state: 'GRACE', daysRemaining: -5 }));
    expect(w?.tone).toBe('warn');
    expect(w?.detail).toMatch(/still works/);
  });

  it('turns red once grace has passed', () => {
    expect(licenceWarning(status({ state: 'EXPIRED', daysRemaining: -91 }))?.tone).toBe('danger');
    expect(licenceWarning(status({ state: 'INVALID', daysRemaining: null }))?.tone).toBe('danger');
  });

  /**
   * The reassurance is load-bearing, not padding. A school watching half the product vanish will
   * assume the worst about its records unless it is told otherwise in the same breath.
   */
  it('tells an expired school its records and export are intact', () => {
    const w = licenceWarning(status({ state: 'EXPIRED', daysRemaining: -91 }));
    expect(w?.detail).toMatch(/records are all still here/);
    expect(w?.detail).toMatch(/exported/);
  });

  /**
   * A school on the free package has chosen it. Nagging daily about a steady state is how a
   * banner becomes wallpaper — and then the one that matters goes unread too.
   */
  it('says nothing at all when no licence is installed', () => {
    expect(licenceWarning(status({ state: 'MISSING', daysRemaining: null }))).toBeNull();
  });

  it('says nothing when the portal has no licence information to go on', () => {
    expect(licenceWarning(null)).toBeNull();
  });
});
