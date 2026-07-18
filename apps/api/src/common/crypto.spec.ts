import { beforeEach, describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  MissingEncryptionKeyError,
  publicToken,
  safeEqual,
} from './crypto';

const KEY = 'a'.repeat(64); // 32 bytes hex

describe('secret encryption', () => {
  beforeEach(() => {
    process.env.PAYMENTS_ENCRYPTION_KEY = KEY;
  });

  it('round-trips a gateway secret', () => {
    const enc = encryptSecret('sk_live_supersecret');
    expect(enc).not.toContain('supersecret');
    expect(enc.startsWith('v1:')).toBe(true);
    expect(decryptSecret(enc)).toBe('sk_live_supersecret');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('rejects tampered ciphertext via the GCM auth tag', () => {
    const enc = encryptSecret('sk_live_x');
    const [v, iv, tag, data] = enc.split(':');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 0xff;
    const tampered = [v, iv, tag, flipped.toString('base64')].join(':');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('refuses to encrypt LIVE credentials without a real key', () => {
    delete process.env.PAYMENTS_ENCRYPTION_KEY;
    expect(() => encryptSecret('sk_live_x', true)).toThrow(MissingEncryptionKeyError);
    // ...but dev/TEST still works so the stack boots.
    expect(decryptSecret(encryptSecret('sk_test_x', false))).toBe('sk_test_x');
  });
});

describe('helpers', () => {
  it('safeEqual compares correctly', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('publicToken is url-safe and unguessable-length', () => {
    const t = publicToken(24);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThanOrEqual(32);
    expect(publicToken()).not.toBe(publicToken());
  });
});
