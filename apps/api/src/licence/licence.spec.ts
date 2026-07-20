import { generateKeyPairSync } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  evaluateLicence,
  LicenceError,
  LicencePayload,
  signLicence,
  verifyLicence,
} from './licence';
import { forgetDevLicenceKey, licencePublicKey } from './licence-key';

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

  /*
    Both sides of the enrolment-cap removal, in one place.

    The vendor kept minting `studentCap` after it stopped meaning anything, so that a school server
    predating the change still accepts a licence issued today. Both shapes therefore have to parse,
    and the factory above deliberately still carries the field so every other test in this file
    exercises the old one.
  */
  it('accepts a licence with or without the retired studentCap field', () => {
    const withCap = signLicence(payload({ studentCap: 150 }), VENDOR.privatePem);
    expect(verifyLicence(withCap, VENDOR.publicPem).tier).toBe('MEDIUM');

    const bare = payload();
    delete bare.studentCap;
    const withoutCap = signLicence(bare, VENDOR.privatePem);
    expect(verifyLicence(withoutCap, VENDOR.publicPem).tier).toBe('MEDIUM');
  });

  it('the committed dev key pair still matches itself', () => {
    /*
      Guards the two halves in ops/licence/ against drifting apart, which would break every fresh
      checkout and every E2E run with a confusing signature error.

      Both are read from disk rather than written here: a PEM pasted into source compiles into
      dist and ships, which is the whole reason the dev key stopped being a constant.
    */
    delete process.env.LICENCE_PUBLIC_KEY;
    delete process.env.NODE_ENV;
    forgetDevLicenceKey();

    const opsDir = join(__dirname, '..', '..', '..', '..', 'ops', 'licence');
    const devPrivate = readFileSync(join(opsDir, 'dev-signing-key.pem'), 'utf8');
    const licence = signLicence(payload(), devPrivate);
    expect(verifyLicence(licence, licencePublicKey()).tier).toBe('MEDIUM');
  });
});

describe('licence evaluation', () => {
  it('is VALID before expiry and carries the licence tier', () => {
    const s = evaluateLicence(payload(), { now: day(-1), schoolSlug: 'brighton-academy' });
    expect(s.state).toBe('VALID');
    expect(s.tier).toBe('MEDIUM');
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
   * Expiry must never be an upgrade. The old trap was the enrolment cap — `null` meant unlimited,
   * so a lapsed ADVANCED licence handed a school more than a valid one. Caps are gone, but the
   * shape of the mistake is not, so the direction stays pinned: lapsing only ever loses features.
   */
  it('never grants more on lapse than the licence itself did', () => {
    const advanced = payload({ tier: 'ADVANCED', extraEntitlements: ['ai.remarks'] });
    expect(evaluateLicence(advanced, { now: day(-1) }).tier).toBe('ADVANCED');

    const lapsed = evaluateLicence(advanced, { now: day(400) });
    expect(lapsed.tier).toBe('BASIC');
    expect(lapsed.extraEntitlements).toEqual([]);
  });

  it('falls back to BASIC when no licence is installed', () => {
    const s = evaluateLicence(null);
    expect(s.state).toBe('MISSING');
    expect(s.tier).toBe('BASIC');
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

/**
 * Packages: a licence that names its own grant is the whole product, not a tier with additions.
 *
 * `evaluateLicence` only carries the list through; `LicenceService.entitlements()` is what applies
 * it. These pin the carrying, because getting it wrong is silent — a school keeps working, with
 * the wrong features, and nobody finds out until they ask where something went.
 */
describe('a licence that names its own entitlements', () => {
  it('carries the list through, distinct from an absent one', () => {
    const packaged = evaluateLicence(payload({ entitlements: ['sis.core', 'ai.remarks'] }), {
      now: day(-1),
    });
    expect(packaged.entitlements).toEqual(['sis.core', 'ai.remarks']);

    // Absent is not the same as empty: absent means "use the tier bundle".
    expect(evaluateLicence(payload(), { now: day(-1) }).entitlements).toBeNull();
  });

  /**
   * An empty grant is a real answer, however odd a product it is. Collapsing it into "no list, use
   * the bundle" would hand a school every Medium feature it deliberately was not sold.
   */
  it('keeps an empty grant as an empty grant', () => {
    expect(evaluateLicence(payload({ entitlements: [] }), { now: day(-1) }).entitlements).toEqual(
      [],
    );
  });

  it('drops the grant once the licence has lapsed past grace', () => {
    const lapsed = evaluateLicence(payload({ entitlements: ['ai.remarks'] }), { now: day(400) });
    expect(lapsed.tier).toBe('BASIC');
    // Falls back to the Basic bundle rather than to a package the school stopped paying for.
    expect(lapsed.entitlements).toBeNull();
  });

  it('refuses a grant that is not a list of codes', () => {
    const licence = signLicence(
      payload({ entitlements: [1, 2] as unknown as string[] }),
      VENDOR.privatePem,
    );
    expect(() => verifyLicence(licence, VENDOR.publicPem)).toThrow(/entitlements must be an array/);
  });
});
