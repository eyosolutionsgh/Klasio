/**
 * Vendor-signed licence files (docs/03 §3.5).
 *
 * Every school runs on its own server, so there is no vendor console to set a tier and no
 * subscription to settle. What a school has paid for is stated in a file the vendor signs and the
 * school installs. The box can check it offline, forever, with no call home — which is the whole
 * point for a school on an intermittent line or a LAN with no internet at all.
 *
 * ## Format
 *
 * `<base64url(payload JSON)>.<base64url(Ed25519 signature)>` — JWS-shaped, deliberately not JWS.
 * There is one algorithm and no negotiation, so there is no header to lie about and no
 * alg-confusion attack to get wrong.
 *
 * Ed25519 comes from `node:crypto` (`sign`/`verify` with a null algorithm). A dependency for four
 * lines of built-in would be a dependency to keep patched for the life of the product.
 *
 * ## Why the signature covers the received bytes
 *
 * `verify` decodes the payload segment and checks the signature over *exactly those bytes*, never
 * over a re-serialisation. So there is no canonical-JSON problem: key order, whitespace and
 * number formatting cannot drift between signing and checking, because the same bytes are used
 * for both. This is the single easiest thing to get wrong in a scheme like this.
 */
import {
  createPublicKey,
  createPrivateKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'crypto';
import type { Tier } from '@prisma/client';
import { STUDENT_CAPS } from '../common/entitlements';

export interface LicencePayload {
  /** Format version. Bump only for a breaking change to the fields below. */
  v: number;
  /** Vendor's own reference, so support can say "read me the id on your licence". */
  licenceId: string;
  /** Shown at install so a school can confirm the licence is theirs before applying it. */
  schoolName: string;
  /**
   * What the licence is bound to.
   *
   * The slug rather than the school id: the vendor mints this at purchase, before the box exists,
   * so it cannot know a cuid. The slug is what the school tells the vendor, and it is unique.
   */
  schoolSlug: string;
  tier: Tier;
  /** Enrolment ceiling. `null` is unlimited, and overrides the tier's default cap. */
  studentCap: number | null;
  /** Individual entitlement codes granted on top of the tier, without cutting a release. */
  extraEntitlements: string[];
  issuedAt: string;
  expiresAt: string;
  /** Days past expiry the full tier still applies. See `evaluateLicence`. */
  graceDays: number;
}

export type LicenceState =
  /** Signed, in date, and bound to this school. */
  | 'VALID'
  /** Past `expiresAt` but inside `graceDays` — everything still works, loudly. */
  | 'GRACE'
  /** Past grace. Falls back to BASIC. */
  | 'EXPIRED'
  /** No licence installed at all. */
  | 'MISSING'
  /** Present but unusable: bad signature, malformed, wrong school, or unknown version. */
  | 'INVALID';

export interface LicenceStatus {
  state: LicenceState;
  /** The tier actually in force, which is BASIC whenever the licence is not carrying one. */
  tier: Tier;
  /**
   * The cap actually in force. `null` means uncapped.
   *
   * Note this is the *effective* cap, not the payload's field. When no licence applies the school
   * falls back to BASIC and gets BASIC's cap — emphatically not `null`, which would hand a lapsed
   * school unlimited enrolment and make expiry an upgrade.
   */
  studentCap: number | null;
  extraEntitlements: string[];
  payload?: LicencePayload;
  /** Negative once expired. Present whenever a payload parsed. */
  daysRemaining?: number;
  /** Why it is unusable. Present for INVALID, and for MISSING. */
  reason?: string;
}

export class LicenceError extends Error {}

const TIERS: Tier[] = ['BASIC', 'MEDIUM', 'ADVANCED'];
const SUPPORTED_VERSION = 1;
const MS_PER_DAY = 86_400_000;

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/** Serialise the payload once, so signing and verifying can never disagree about the bytes. */
function encodePayload(payload: LicencePayload): Buffer {
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

/**
 * Mint a licence. Used by the vendor's mint script and by the tests.
 *
 * It lives beside `verifyLicence` rather than in a separate tool on purpose: the two must agree
 * byte for byte about the encoding, and the cheapest way to guarantee that is one function
 * producing the bytes both use.
 */
export function signLicence(payload: LicencePayload, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  const body = encodePayload(payload);
  const signature = cryptoSign(null, body, key);
  return `${b64url(body)}.${b64url(signature)}`;
}

function assertShape(raw: unknown): LicencePayload {
  if (typeof raw !== 'object' || raw === null)
    throw new LicenceError('Licence payload is not an object');
  const p = raw as Record<string, unknown>;

  if (p.v !== SUPPORTED_VERSION) {
    // A newer licence against an older build. Say which way round it is — "invalid licence" would
    // send a school to support when the answer is to update the software.
    throw new LicenceError(
      `Licence format v${String(p.v)} is not supported by this version (expected v${SUPPORTED_VERSION}) — update Klasio`,
    );
  }
  for (const field of ['licenceId', 'schoolName', 'schoolSlug', 'issuedAt', 'expiresAt'] as const) {
    if (typeof p[field] !== 'string' || !p[field])
      throw new LicenceError(`Licence is missing "${field}"`);
  }
  if (!TIERS.includes(p.tier as Tier))
    throw new LicenceError(`Licence has an unknown tier "${String(p.tier)}"`);
  if (p.studentCap !== null && (typeof p.studentCap !== 'number' || p.studentCap < 0)) {
    throw new LicenceError('Licence studentCap must be a non-negative number or null');
  }
  if (
    !Array.isArray(p.extraEntitlements) ||
    p.extraEntitlements.some((e) => typeof e !== 'string')
  ) {
    throw new LicenceError('Licence extraEntitlements must be an array of codes');
  }
  if (typeof p.graceDays !== 'number' || p.graceDays < 0) {
    throw new LicenceError('Licence graceDays must be a non-negative number');
  }
  if (Number.isNaN(Date.parse(p.expiresAt as string)))
    throw new LicenceError('Licence expiresAt is not a date');

  return p as unknown as LicencePayload;
}

/**
 * Check the signature and the shape. Throws `LicenceError` with something a human can act on.
 *
 * Does NOT check expiry or which school this is — those are policy, and `evaluateLicence` owns
 * them, so an expired licence can still be parsed and shown to the person renewing it.
 */
export function verifyLicence(licence: string, publicKeyPem: string): LicencePayload {
  const trimmed = licence.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new LicenceError('Licence is malformed — expected "<payload>.<signature>"');
  }

  const body = Buffer.from(parts[0], 'base64url');
  const signature = Buffer.from(parts[1], 'base64url');
  if (!body.length || !signature.length)
    throw new LicenceError('Licence is malformed — empty segment');

  let key;
  try {
    key = createPublicKey(publicKeyPem);
  } catch {
    throw new LicenceError('Licence public key is not readable — check LICENCE_PUBLIC_KEY');
  }

  // Verified over the received bytes, never a re-serialisation. See the header.
  if (!cryptoVerify(null, body, key, signature)) {
    throw new LicenceError(
      'Licence signature does not match — it was altered, or signed by someone else',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw new LicenceError('Licence payload is not valid JSON');
  }
  return assertShape(parsed);
}

/**
 * Turn a verified payload into what the product should actually do today.
 *
 * **Expiry falls back to BASIC, not to read-only.** docs/03 §3.5 originally said read-only; this
 * deviates deliberately. BASIC is a genuinely usable product — roll, attendance, terminal reports,
 * manual fees, SMS — and a school whose licence lapsed over a holiday should still be able to mark
 * this morning's register. Locking the record of children out of the hands of the people
 * responsible for them, to collect a renewal, is exactly the data-hostage behaviour the same
 * paragraph rejects two lines later. Export is never blocked in any state.
 */
/**
 * What the product falls back to when no licence applies: BASIC, with BASIC's own cap.
 *
 * Written once because the cap is the easy thing to get wrong — `studentCap: null` reads as a
 * sensible default and means "unlimited", so a lapsed licence would quietly become an upgrade.
 */
function basicFallback(): LicenceStatus {
  return { state: 'MISSING', tier: 'BASIC', studentCap: STUDENT_CAPS.BASIC, extraEntitlements: [] };
}

export function evaluateLicence(
  payload: LicencePayload | null,
  opts: { schoolSlug?: string; now?: Date; reason?: string } = {},
): LicenceStatus {
  const now = opts.now ?? new Date();

  if (!payload) {
    return {
      ...basicFallback(),
      state: opts.reason ? 'INVALID' : 'MISSING',
      reason: opts.reason ?? 'No licence installed',
    };
  }

  // Binding is checked here rather than in `verifyLicence` so a school that installs the wrong
  // file is told whose licence it is, instead of just "invalid".
  if (opts.schoolSlug && payload.schoolSlug !== opts.schoolSlug) {
    return {
      ...basicFallback(),
      state: 'INVALID',
      payload,
      reason: `This licence is for "${payload.schoolName}" (${payload.schoolSlug}), not this school (${opts.schoolSlug})`,
    };
  }

  const expiresAt = new Date(payload.expiresAt).getTime();
  // Ceil so "expires at midnight tonight" reads as 1 day left, not 0. A school reading "0 days"
  // on a licence that still works would call support.
  const daysRemaining = Math.ceil((expiresAt - now.getTime()) / MS_PER_DAY);
  const graceEndsAt = expiresAt + payload.graceDays * MS_PER_DAY;

  if (now.getTime() <= expiresAt) {
    return {
      state: 'VALID',
      tier: payload.tier,
      studentCap: payload.studentCap,
      extraEntitlements: payload.extraEntitlements,
      payload,
      daysRemaining,
    };
  }

  if (now.getTime() <= graceEndsAt) {
    return {
      state: 'GRACE',
      tier: payload.tier,
      studentCap: payload.studentCap,
      extraEntitlements: payload.extraEntitlements,
      payload,
      daysRemaining,
      reason: `Licence expired ${-daysRemaining} day(s) ago — renew within the grace period`,
    };
  }

  return {
    ...basicFallback(),
    state: 'EXPIRED',
    payload,
    daysRemaining,
    reason: `Licence expired ${-daysRemaining} day(s) ago and the grace period has passed`,
  };
}
