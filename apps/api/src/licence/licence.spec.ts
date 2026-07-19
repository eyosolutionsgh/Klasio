import { generateKeyPairSync } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  evaluateLicence,
  LicenceError,
  LicencePayload,
  signLicence,
  verifyLicence,
} from './licence';
import { DEV_LICENCE_PUBLIC_KEY } from './licence-key';

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

const VENDOR = keypair();

function payload(over: Partial<LicencePayload> = {}): LicencePayload {
  return {
    v: 1,
    licenceId: 'lic_2026_0142',
    schoolName: 'Brighton Academy',
    schoolSlug: 'brighton-academy',
    tier: 'MEDIUM',
    studentCap: 1000,
    extraEntitlements: [],
    issuedAt: '2026-07-01T00:00:00.000Z',
    expiresAt: '2027-07-01T00:00:00.000Z',
    graceDays: 30,
    ...over,
  };
}

const EXPIRY = new Date('2027-07-01T00:00:00.000Z');
const day = (n: number) => new Date(EXPIRY.getTime() + n * 86_400_000);

describe('licence signature', () => {
  it('round-trips a licence the vendor signed', () => {
    const licence = signLicence(payload(), VENDOR.privatePem);
    expect(verifyLicence(licence, VENDOR.publicPem)).toMatchObject({
      licenceId: 'lic_2026_0142',
      tier: 'MEDIUM',
      schoolSlug: 'brighton-academy',
    });
  });

  it('rejects a licence signed by somebody else', () => {
    const impostor = keypair();
    const licence = signLicence(payload({ tier: 'ADVANCED' }), impostor.privatePem);
    expect(() => verifyLicence(licence, VENDOR.publicPem)).toThrow(LicenceError);
  });

  /**
   * The attack the whole scheme exists to stop: a school editing BASIC to ADVANCED in a text
   * editor. The payload is base64url, not encrypted, so it is trivially readable and editable —
   * only the signature makes it useless.
   */
  it('rejects a payload edited to upgrade the tier', () => {
    const licence = signLicence(payload({ tier: 'BASIC' }), VENDOR.privatePem);
    const [body, sig] = licence.split('.');
    const edited = JSON.parse(Buffer.from(body, 'base64url').toString());
    edited.tier = 'ADVANCED';
    const forged = `${Buffer.from(JSON.stringify(edited)).toString('base64url')}.${sig}`;

    expect(() => verifyLicence(forged, VENDOR.publicPem)).toThrow(/signature does not match/);
  });

  it('rejects a malformed licence without throwing something unreadable', () => {
    expect(() => verifyLicence('not-a-licence', VENDOR.publicPem)).toThrow(/malformed/);
    expect(() => verifyLicence('', VENDOR.publicPem)).toThrow(/malformed/);
  });

  it('names the version mismatch rather than calling a future licence invalid', () => {
    const licence = signLicence(payload({ v: 2 }), VENDOR.privatePem);
    expect(() => verifyLicence(licence, VENDOR.publicPem)).toThrow(/update Klasio/);
  });

  it('rejects a licence whose tier is not a tier', () => {
    const licence = signLicence(payload({ tier: 'PLATINUM' as never }), VENDOR.privatePem);
    expect(() => verifyLicence(licence, VENDOR.publicPem)).toThrow(/unknown tier/);
  });

  it('the committed dev key verifies what the committed dev private key signs', () => {
    // Guards the pair in licence-key.ts and ops/licence/ against drifting apart, which would
    // break every fresh checkout and every E2E run with a confusing signature error.
    const devPrivate = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIMIS4rmzH4AnjFScgdimAZRaTLwp9bRcSF/3vuwayt0X
-----END PRIVATE KEY-----`;
    const licence = signLicence(payload(), devPrivate);
    expect(verifyLicence(licence, DEV_LICENCE_PUBLIC_KEY).tier).toBe('MEDIUM');
  });
});

describe('licence evaluation', () => {
  it('is VALID before expiry and carries the licence tier and cap', () => {
    const s = evaluateLicence(payload(), { now: day(-1), schoolSlug: 'brighton-academy' });
    expect(s.state).toBe('VALID');
    expect(s.tier).toBe('MEDIUM');
    expect(s.studentCap).toBe(1000);
  });

  it('keeps the full tier through the grace period', () => {
    const s = evaluateLicence(payload(), { now: day(29) });
    expect(s.state).toBe('GRACE');
    expect(s.tier).toBe('MEDIUM');
    expect(s.reason).toMatch(/renew/);
  });

  it('drops to BASIC once grace has passed', () => {
    const s = evaluateLicence(payload(), { now: day(31) });
    expect(s.state).toBe('EXPIRED');
    expect(s.tier).toBe('BASIC');
  });

  /**
   * The boundary is where a lapse actually bites a school, so it is pinned exactly rather than
   * left to "roughly a month". Grace ends AT expiry + graceDays, inclusive.
   */
  it('treats the last day of grace as grace and the next as expired', () => {
    expect(evaluateLicence(payload(), { now: day(30) }).state).toBe('GRACE');
    expect(evaluateLicence(payload(), { now: day(30.001) }).state).toBe('EXPIRED');
  });

  /**
   * The trap: `studentCap: null` means "unlimited" in a payload, so reusing null as the fallback
   * would make an expired ADVANCED licence *better* than a valid one — a school past grace would
   * get unlimited enrolment. Expiry must never be an upgrade.
   */
  it('falls back to the BASIC cap, not to unlimited, when a licence lapses', () => {
    const uncapped = payload({ tier: 'ADVANCED', studentCap: null });
    expect(evaluateLicence(uncapped, { now: day(-1) }).studentCap).toBeNull();

    const lapsed = evaluateLicence(uncapped, { now: day(400) });
    expect(lapsed.tier).toBe('BASIC');
    expect(lapsed.studentCap).toBe(150);
  });

  it("falls back to BASIC with BASIC's cap when no licence is installed", () => {
    const s = evaluateLicence(null);
    expect(s.state).toBe('MISSING');
    expect(s.tier).toBe('BASIC');
    expect(s.studentCap).toBe(150);
  });

  it('reports INVALID rather than MISSING when there was a reason', () => {
    const s = evaluateLicence(null, { reason: 'Licence signature does not match' });
    expect(s.state).toBe('INVALID');
    expect(s.tier).toBe('BASIC');
  });

  it('refuses a licence issued to a different school, and says whose it is', () => {
    const s = evaluateLicence(payload(), { schoolSlug: 'accra-high', now: day(-1) });
    expect(s.state).toBe('INVALID');
    expect(s.tier).toBe('BASIC');
    expect(s.reason).toMatch(/Brighton Academy/);
  });

  it('grants extra entitlements on top of the tier', () => {
    const s = evaluateLicence(payload({ extraEntitlements: ['ai.remarks'] }), { now: day(-1) });
    expect(s.extraEntitlements).toEqual(['ai.remarks']);
  });

  it('counts days remaining so a renewal notice can be honest', () => {
    expect(evaluateLicence(payload(), { now: day(-10) }).daysRemaining).toBe(10);
    expect(evaluateLicence(payload(), { now: day(5) }).daysRemaining).toBe(-5);
  });
});
