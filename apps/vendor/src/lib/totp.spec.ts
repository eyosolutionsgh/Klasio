import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  readableSecret,
  totpAt,
  TOTP_STEP_SECONDS,
  verifyTotp,
} from './totp';

/**
 * The RFC's own secret: the ASCII string "12345678901234567890".
 *
 * Ground truth matters more here than anywhere else in this codebase. A hand-written TOTP that
 * agrees with itself is worth nothing — the only question is whether it agrees with Google
 * Authenticator, and the published vectors are the closest thing to asking it.
 */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('RFC 6238 test vectors', () => {
  /**
   * Appendix B, SHA-1 rows. The RFC prints eight digits; six-digit codes are the last six of each,
   * because both truncate the same integer — mod 10^6 against mod 10^8.
   */
  const VECTORS: [seconds: number, code: string][] = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ];

  for (const [seconds, expected] of VECTORS) {
    it(`matches the published code at t=${seconds}`, () => {
      expect(totpAt(RFC_SECRET, new Date(seconds * 1000))).toBe(expected);
    });
  }
});

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    for (const text of ['', 'a', 'ab', 'abc', 'abcd', 'abcde', '12345678901234567890']) {
      const buf = Buffer.from(text, 'ascii');
      expect(base32Decode(base32Encode(buf))).toEqual(buf);
    }
  });

  /** A secret is read off a screen and typed back in, so it arrives spaced, cased and padded. */
  it('accepts a secret the way a person would type it', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
    const typed = readableSecret(secret).toLowerCase();
    expect(base32Decode(typed)).toEqual(base32Decode(secret));
    expect(base32Decode(`${secret}======`)).toEqual(base32Decode(secret));
  });

  it('refuses something that is not base32 rather than decoding nonsense', () => {
    expect(() => base32Decode('not-base-32!')).toThrow(/base32/);
  });
});

describe('verifying a code', () => {
  const NOW = new Date('2026-07-20T09:00:00.000Z');
  const secret = generateTotpSecret();

  it('accepts the code showing right now', () => {
    expect(verifyTotp(secret, totpAt(secret, NOW), NOW)).toBe(true);
  });

  /**
   * A phone clock is never exactly right, and a code typed as it rolls over arrives one step late.
   * Rejecting either teaches people the portal is broken when their phone is merely a phone.
   */
  it('forgives one step of drift in each direction', () => {
    const before = new Date(NOW.getTime() - TOTP_STEP_SECONDS * 1000);
    const after = new Date(NOW.getTime() + TOTP_STEP_SECONDS * 1000);
    expect(verifyTotp(secret, totpAt(secret, before), NOW)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, after), NOW)).toBe(true);
  });

  it('refuses a code two steps out', () => {
    const stale = new Date(NOW.getTime() - 2 * TOTP_STEP_SECONDS * 1000);
    expect(verifyTotp(secret, totpAt(secret, stale), NOW)).toBe(false);
  });

  it('refuses another secret’s code', () => {
    expect(verifyTotp(secret, totpAt(generateTotpSecret(), NOW), NOW)).toBe(false);
  });

  /** Nothing that is not six digits may ever pass, whatever it looks like. */
  it('refuses malformed input without throwing', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56 78', '000000 ']) {
      expect(verifyTotp(secret, bad, NOW)).toBe(false);
    }
  });

  it('accepts a code typed with a space in the middle', () => {
    const code = totpAt(secret, NOW);
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, NOW)).toBe(true);
  });
});

describe('the enrolment URI', () => {
  /**
   * Both spellings of the issuer. Older apps read the label prefix, newer ones the parameter, and
   * an app that finds neither lists the account as an unlabelled six-digit code among fifteen.
   */
  it('names the issuer twice, and the account once', () => {
    const uri = otpauthUri('ABCDEFGH', 'vendor@klasio.test');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(decodeURIComponent(uri)).toContain('Klasio Licensing:vendor@klasio.test');
    expect(uri).toContain('issuer=Klasio+Licensing');
    expect(uri).toContain('secret=ABCDEFGH');
  });

  /** Spelled out rather than left to defaults, because apps disagree about what the defaults are. */
  it('states the algorithm, digits and period', () => {
    const uri = otpauthUri('ABCDEFGH', 'a@b.test');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});
