/**
 * The licence wire format — the one thing the vendor's portal and a school's server must agree
 * about exactly.
 *
 * This package exists for that agreement. The vendor mints; the school verifies; they are separate
 * applications, deployed separately, upgraded separately. Two implementations of a byte layout
 * drift, and the failure mode is a licence that mints cleanly and refuses to verify — with nothing
 * to point at, because both halves look correct on their own.
 *
 * ## What lives here, and what does not
 *
 * **Format only.** The payload shape, signing, and verification. No product policy: grace periods,
 * what an expired licence falls back to, and what a tier is worth are the school application's
 * business and change on its own schedule. Putting them here would drag the vendor portal into
 * decisions it has no stake in.
 *
 * ## The rule that matters
 *
 * `verifyLicence` checks the signature over the **received bytes**, never over a re-serialisation.
 * That is what makes key order, whitespace and number formatting irrelevant, and it only holds
 * because `signLicence` and `verifyLicence` share `encodePayload` below. Do not add a second
 * encoder.
 */
import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'crypto';

export type LicenceTier = 'BASIC' | 'MEDIUM' | 'ADVANCED';

export const LICENCE_TIERS: LicenceTier[] = ['BASIC', 'MEDIUM', 'ADVANCED'];
export const LICENCE_FORMAT_VERSION = 1;

export interface LicencePayload {
  /** Format version. Bump only for a breaking change to the fields below. */
  v: number;
  /** The vendor's own reference, so support can say "read me the id on your licence". */
  licenceId: string;
  /** Shown at install so a school can confirm the licence is theirs before applying it. */
  schoolName: string;
  /**
   * What the licence is bound to.
   *
   * The slug rather than a database id: the vendor mints this at purchase, before the school's
   * server exists, so it cannot know an id the school has not generated yet.
   */
  schoolSlug: string;
  tier: LicenceTier;
  /**
   * Legacy enrolment ceiling, retained for older servers and no longer honoured.
   *
   * Packages differ by what they can do, not by how many children a school may enrol — a cap's
   * only real effect on a school's own box was to refuse a child mid-term. Nothing reads this.
   *
   * It is still *emitted* as `null` rather than dropped: a build that predates this change
   * rejects a payload without the field, but reads `null` as "unlimited", which is exactly the
   * behaviour we now want everywhere. Keeping it is what lets a new licence install on an old
   * server. Remove it once no such server remains.
   */
  studentCap?: number | null;
  /** Individual entitlement codes granted on top of the tier, without cutting a release. */
  extraEntitlements: string[];
  /**
   * Exactly what this licence grants, when the vendor sold a package.
   *
   * Authoritative when present: the school honours this list and does not consult the tier bundle
   * at all. That is what lets a package be any combination of features, including one that leaves
   * out something the named tier carries.
   *
   * Absent on every licence issued before packages existed, and on anything cut from the CLI, and
   * those still resolve the old way — tier bundle plus `extraEntitlements`. A build that predates
   * this field ignores it and falls back to the same path, which is why `tier` is still sent.
   */
  entitlements?: string[];
  issuedAt: string;
  expiresAt: string;
  /** Days past expiry the full tier still applies. */
  graceDays: number;
}

export class LicenceFormatError extends Error {}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/** Serialise once, so signing and verifying can never disagree about the bytes. */
function encodePayload(payload: LicencePayload): Buffer {
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

/** Mint a licence. The private key never leaves the vendor. */
export function signLicence(payload: LicencePayload, privateKeyPem: string): string {
  const body = encodePayload(payload);
  const signature = cryptoSign(null, body, createPrivateKey(privateKeyPem));
  return `${b64url(body)}.${b64url(signature)}`;
}

function assertShape(raw: unknown): LicencePayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new LicenceFormatError('Licence payload is not an object');
  }
  const p = raw as Record<string, unknown>;

  if (p.v !== LICENCE_FORMAT_VERSION) {
    // A newer licence against an older build. Say which way round it is — "invalid licence" would
    // send a school to support when the answer is to update the software.
    throw new LicenceFormatError(
      `Licence format v${String(p.v)} is not supported by this version (expected v${LICENCE_FORMAT_VERSION}) — update Klasio`,
    );
  }
  for (const field of ['licenceId', 'schoolName', 'schoolSlug', 'issuedAt', 'expiresAt'] as const) {
    if (typeof p[field] !== 'string' || !p[field]) {
      throw new LicenceFormatError(`Licence is missing "${field}"`);
    }
  }
  if (!LICENCE_TIERS.includes(p.tier as LicenceTier)) {
    throw new LicenceFormatError(`Licence has an unknown tier "${String(p.tier)}"`);
  }
  // Accepted in any of its three shapes — number, null, absent — and acted on in none of them.
  // A licence minted before caps were dropped must still install.
  if (
    p.studentCap !== null &&
    p.studentCap !== undefined &&
    (typeof p.studentCap !== 'number' || p.studentCap < 0)
  ) {
    throw new LicenceFormatError('Licence studentCap must be a non-negative number or null');
  }
  if (
    !Array.isArray(p.extraEntitlements) ||
    p.extraEntitlements.some((e) => typeof e !== 'string')
  ) {
    throw new LicenceFormatError('Licence extraEntitlements must be an array of codes');
  }
  // Optional, and authoritative when present. Validated the same as `extraEntitlements` because a
  // malformed grant is worse than an absent one: it would silently reduce what a school paid for.
  if (
    p.entitlements !== undefined &&
    (!Array.isArray(p.entitlements) || p.entitlements.some((e) => typeof e !== 'string'))
  ) {
    throw new LicenceFormatError('Licence entitlements must be an array of codes');
  }
  if (typeof p.graceDays !== 'number' || p.graceDays < 0) {
    throw new LicenceFormatError('Licence graceDays must be a non-negative number');
  }
  if (Number.isNaN(Date.parse(p.expiresAt as string))) {
    throw new LicenceFormatError('Licence expiresAt is not a date');
  }
  return p as unknown as LicencePayload;
}

/**
 * Check the signature and the shape. Throws `LicenceFormatError` with something a human can act on.
 *
 * Does **not** check expiry or which school this is: those are policy, and the caller owns them —
 * so an expired licence still parses, which is what lets a renewal screen show what it replaced.
 */
export function verifyLicence(licence: string, publicKeyPem: string): LicencePayload {
  const parts = licence.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new LicenceFormatError('Licence is malformed — expected "<payload>.<signature>"');
  }

  const body = Buffer.from(parts[0], 'base64url');
  const signature = Buffer.from(parts[1], 'base64url');
  if (!body.length || !signature.length) {
    throw new LicenceFormatError('Licence is malformed — empty segment');
  }

  let key;
  try {
    key = createPublicKey(publicKeyPem);
  } catch {
    throw new LicenceFormatError('Licence public key is not readable');
  }

  // Over the received bytes, never a re-serialisation. See the header.
  if (!cryptoVerify(null, body, key, signature)) {
    throw new LicenceFormatError(
      'Licence signature does not match — it was altered, or signed by someone else',
    );
  }

  try {
    return assertShape(JSON.parse(body.toString('utf8')));
  } catch (e) {
    if (e instanceof LicenceFormatError) throw e;
    throw new LicenceFormatError('Licence payload is not valid JSON');
  }
}

/** Read a payload without checking the signature — for showing a licence the vendor just made. */
export function decodeLicenceUnverified(licence: string): LicencePayload {
  const [body] = licence.trim().split('.');
  if (!body) throw new LicenceFormatError('Licence is malformed');
  return assertShape(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
}
