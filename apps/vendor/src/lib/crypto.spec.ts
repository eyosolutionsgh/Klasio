import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto';

describe('secrets at rest', () => {
  it('round-trips', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  /** A fresh IV each time, or two staff with the same secret would be visibly identical rows. */
  it('never produces the same ciphertext twice', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  /**
   * GCM's whole point. A row edited in the database fails to open rather than decrypting to
   * something plausible that then silently fails to match any code the person's phone shows.
   */
  it('refuses a ciphertext that has been tampered with', () => {
    const stored = encryptSecret('JBSWY3DPEHPK3PXP');
    const [iv, tag, body] = stored.split('.');
    const flipped = Buffer.from(body, 'base64');
    flipped[0] ^= 0xff;
    expect(() => decryptSecret([iv, tag, flipped.toString('base64')].join('.'))).toThrow();
  });

  it('refuses a stored value that is not the right shape', () => {
    expect(() => decryptSecret('nonsense')).toThrow(/malformed/);
  });
});
