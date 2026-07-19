import { describe, expect, it } from 'vitest';
import { ENTITLEMENT_CATALOGUE } from '../../../../packages/shared/src/entitlements-catalogue';
import { ENTITLEMENTS } from '../common/entitlements';

/**
 * The vendor portal offers a list of features to tick; this application decides what those codes
 * mean. They are separate programs, so the list can drift — and the failure is quiet and expensive:
 * a school pays for a feature the product then ignores, and nobody finds out until they ask where
 * it is.
 *
 * If this fails, reconcile deliberately. A code added here needs a label in the catalogue; a code
 * removed from the catalogue is a feature the portal can no longer sell.
 */
describe('the portal offers exactly what this product recognises', () => {
  const product = new Set([
    ...ENTITLEMENTS.BASIC,
    ...ENTITLEMENTS.MEDIUM,
    ...ENTITLEMENTS.ADVANCED,
  ] as string[]);
  const catalogue = new Set(ENTITLEMENT_CATALOGUE.map((e) => e.code));

  it('offers nothing this product would ignore', () => {
    const unknown = [...catalogue].filter((c) => !product.has(c));
    expect(unknown, 'The portal can sell these, and this product does nothing with them').toEqual(
      [],
    );
  });

  it('offers every code this product understands', () => {
    const unsellable = [...product].filter((c) => !catalogue.has(c));
    expect(unsellable, 'This product supports these, and the portal cannot sell them').toEqual([]);
  });

  it('files each code under the package it ships with', () => {
    for (const entry of ENTITLEMENT_CATALOGUE) {
      const actual = (ENTITLEMENTS.BASIC as readonly string[]).includes(entry.code)
        ? 'BASIC'
        : (ENTITLEMENTS.MEDIUM as readonly string[]).includes(entry.code)
          ? 'MEDIUM'
          : 'ADVANCED';
      expect(entry.tier, `${entry.code} is sold as ${entry.tier} and ships with ${actual}`).toBe(
        actual,
      );
    }
  });
});
