import { describe, expect, it } from 'vitest';
import { PackageError, validatePackage } from './packages';

const base = { name: 'Starter', tier: 'BASIC' as const, entitlements: ['sis.core'] };

describe('building a package', () => {
  /**
   * The freedom packages exist for: a package is a set of codes, not a tier with additions, so it
   * may leave out something the tier it is labelled with normally carries.
   */
  it('accepts any combination, including one a tier would not describe', () => {
    // Labelled BASIC, but carrying an ADVANCED feature and missing most of Basic.
    expect(
      validatePackage({ ...base, tier: 'BASIC', entitlements: ['sis.core', 'ai.remarks'] }),
    ).toEqual(['sis.core', 'ai.remarks']);
  });

  it('refuses a code this build would not honour', () => {
    expect(() => validatePackage({ ...base, entitlements: ['sis.core', 'not.a.feature'] })).toThrow(
      /does not know these features: not\.a\.feature/,
    );
  });

  /** An empty package is a product that grants nothing, which is a mistake rather than an offer. */
  it('refuses a package with no features', () => {
    expect(() => validatePackage({ ...base, entitlements: [] })).toThrow(PackageError);
    expect(() => validatePackage({ ...base, entitlements: ['  '] })).toThrow(/at least one/);
  });

  it('refuses a package with no usable name', () => {
    expect(() => validatePackage({ ...base, name: ' ' })).toThrow(/name/);
  });

  /** A double-submitted checkbox must not make a licence claim the same feature twice. */
  it('collapses duplicates and trims', () => {
    expect(
      validatePackage({ ...base, entitlements: [' sis.core ', 'sis.core', 'fees.manual'] }),
    ).toEqual(['sis.core', 'fees.manual']);
  });
});
