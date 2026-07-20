import { describe, expect, it } from 'vitest';
import { ENTITLEMENT_CATALOGUE } from '../../../../packages/shared/src/entitlements-catalogue';
import { ENTITLEMENT_LABELS, ENTITLEMENTS } from '../common/entitlements';

/**
 * The vendor portal offers a list of features to tick; this application decides what those codes
 * mean. They are separate programs, so the list can drift — and the failure is quiet and expensive:
 * a school pays for a feature the product then ignores, and nobody finds out until they ask where
 * it is.
 *
 * If this fails, reconcile deliberately. A code added here needs a label in the catalogue; a code
 * removed from the catalogue is a feature the portal can no longer sell.
 *
 * The labels are held together for a different reason: both ends show them to people. A school
 * reading its own licence screen and a salesperson reading the invoice that produced it should see
 * the same words for the same thing, or a support call starts with working out whether they are
 * talking about the same feature.
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

  it('calls each feature the same thing the portal called it', () => {
    for (const entry of ENTITLEMENT_CATALOGUE) {
      expect(
        ENTITLEMENT_LABELS[entry.code],
        `${entry.code} is sold as "${entry.label}" and shown to the school as "${ENTITLEMENT_LABELS[entry.code] ?? '(nothing)'}"`,
      ).toBe(entry.label);
    }
  });

  /**
   * The other direction. A label left behind after its code was retired is dead weight that reads
   * as a supported feature.
   */
  it('names nothing the catalogue has dropped', () => {
    const stale = Object.keys(ENTITLEMENT_LABELS).filter((c) => !catalogue.has(c));
    expect(stale, 'These have a label here and no entry in the catalogue').toEqual([]);
  });
});
