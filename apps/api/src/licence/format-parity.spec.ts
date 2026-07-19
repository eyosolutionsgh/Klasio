import { generateKeyPairSync } from 'crypto';
import { describe, expect, it } from 'vitest';
import * as shared from '../../../../packages/shared/src/licence-format';
import { signLicence, verifyLicence, type LicencePayload } from './licence';

/**
 * The vendor's portal mints licences this application verifies, and they are separate programs —
 * deployed separately, upgraded separately. `packages/shared` holds the canonical wire format and
 * the portal uses it directly; this app still carries its own copy.
 *
 * That duplication is deliberate for now. Making the API depend on the shared package at runtime
 * needs a compile step for `packages/shared`, a Dockerfile that copies it, and build ordering — a
 * build-system change, not a licence change. Until that is worth doing, this test is what stops
 * the two drifting: it signs with one and verifies with the other, in both directions, and pins
 * the bytes.
 *
 * If this fails, do not "fix" it by editing one side. The two implementations have diverged, and
 * the consequence in the field is a licence the vendor mints cleanly and a school cannot install.
 */
function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

const payload = (): LicencePayload => ({
  v: 1,
  licenceId: 'lic_2026_0142',
  schoolName: 'Kwahu Ridge Academy',
  schoolSlug: 'kwahu-ridge-academy',
  tier: 'MEDIUM',
  studentCap: 400,
  extraEntitlements: ['ai.remarks'],
  issuedAt: '2026-07-01T00:00:00.000Z',
  expiresAt: '2027-07-01T00:00:00.000Z',
  graceDays: 30,
});

describe('the school and the vendor agree about the licence format', () => {
  const keys = keypair();

  it('produces byte-identical output from the same payload', () => {
    expect(signLicence(payload(), keys.privatePem)).toBe(
      shared.signLicence(payload() as shared.LicencePayload, keys.privatePem),
    );
  });

  it('verifies what the vendor mints', () => {
    const minted = shared.signLicence(payload() as shared.LicencePayload, keys.privatePem);
    expect(verifyLicence(minted, keys.publicPem)).toMatchObject({
      licenceId: 'lic_2026_0142',
      tier: 'MEDIUM',
      studentCap: 400,
    });
  });

  it('the vendor can read back what a school would accept', () => {
    const minted = signLicence(payload(), keys.privatePem);
    expect(shared.verifyLicence(minted, keys.publicPem).schoolSlug).toBe('kwahu-ridge-academy');
  });

  it('rejects the same tampering on both sides', () => {
    const minted = signLicence(payload(), keys.privatePem);
    const [body, sig] = minted.split('.');
    const edited = JSON.parse(Buffer.from(body, 'base64url').toString());
    edited.tier = 'ADVANCED';
    const forged = `${Buffer.from(JSON.stringify(edited)).toString('base64url')}.${sig}`;

    expect(() => verifyLicence(forged, keys.publicPem)).toThrow();
    expect(() => shared.verifyLicence(forged, keys.publicPem)).toThrow();
  });
});
