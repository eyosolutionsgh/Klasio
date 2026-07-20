import { ENTITLEMENT_CATALOGUE, type LicenceTier } from '@eyo/shared';
import { db } from './db';

/**
 * Packages — the things a school actually buys.
 *
 * A package is a name and a set of feature codes. It is not built on a tier and cannot be
 * described as one plus extras: the whole point is that a vendor can sell any combination, so a
 * package may deliberately leave out something a built-in tier carries.
 *
 * `tier` on a package is a **label**, not a rule. It decides the word a school sees on its own
 * screens and nothing else — every gate in the product checks an entitlement code, which is what
 * keeps that word from quietly becoming authority again.
 */
export interface PackageInput {
  name: string;
  description?: string;
  tier: LicenceTier;
  entitlements: string[];
}

export class PackageError extends Error {}

const KNOWN = new Set(ENTITLEMENT_CATALOGUE.map((e) => e.code));

/**
 * Refuse a package the product would not understand.
 *
 * A code with a typo in it is not a feature a school gets and quietly fails to receive — it is a
 * feature nobody notices is missing until the school asks. The catalogue is the authority, and
 * `entitlements-parity.spec.ts` holds the catalogue and the product in step.
 */
export function validatePackage(input: PackageInput): string[] {
  const name = input.name.trim();
  if (name.length < 2) throw new PackageError('Give the package a name.');

  const codes = [...new Set(input.entitlements.map((c) => c.trim()).filter(Boolean))];
  if (codes.length === 0) throw new PackageError('Choose at least one feature for this package.');

  const unknown = codes.filter((c) => !KNOWN.has(c));
  if (unknown.length > 0) {
    throw new PackageError(`This build does not know these features: ${unknown.join(', ')}`);
  }
  return codes;
}

export async function createPackage(input: PackageInput) {
  const entitlements = validatePackage(input);
  return db.package.create({
    data: {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      tier: input.tier,
      entitlements,
    },
  });
}

/**
 * Edit a package.
 *
 * Changes nothing about a licence already issued. Those froze their own copy of the feature list
 * at the moment they were signed, which is the only way "what did this school pay for" stays
 * answerable after a product is repriced.
 */
export async function updatePackage(id: string, input: PackageInput) {
  const entitlements = validatePackage(input);
  return db.package.update({
    where: { id },
    data: {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      tier: input.tier,
      entitlements,
    },
  });
}

/** Withdraw from sale without deleting. Licences point at it, and history has to stay readable. */
export async function archivePackage(id: string, archived: boolean) {
  return db.package.update({ where: { id }, data: { archived } });
}

/** What can be sold today. Archived packages stay visible on the licences that used them. */
export function sellablePackages() {
  return db.package.findMany({ where: { archived: false }, orderBy: { name: 'asc' } });
}
