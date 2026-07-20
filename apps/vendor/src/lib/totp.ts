/**
 * Time-based one-time passwords (RFC 6238), by hand.
 *
 * Written out rather than pulled in, for the same reason the licence signing is: this is forty
 * lines of well-specified arithmetic, it is exactly testable against the RFC's own vectors, and a
 * dependency in the authentication path is a dependency that can be replaced under you.
 *
 * SHA-1, six digits, thirty-second steps — not because they are the strongest choices available
 * but because they are what every authenticator app assumes when it scans a QR code. A portal that
 * insisted on SHA-256 would be a portal whose codes silently never match.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const TOTP_DIGITS = 6;
export const TOTP_STEP_SECONDS = 30;

/**
 * How far out of step a code may be and still pass, in either direction.
 *
 * One step — thirty seconds each way. Phone clocks drift, and a code typed at the moment it rolls
 * over is a real thing that happens to real people; rejecting it teaches them the app is broken.
 * Wider than this starts meaningfully lengthening the window an intercepted code stays usable.
 */
export const TOTP_DRIFT_STEPS = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, unpadded — what every authenticator app expects a secret to look like. */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  // Tolerant of how a secret is actually shown to people: spaced into groups, lower case, padded.
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) throw new Error('Secret is not valid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh secret. 20 bytes is the RFC 4226 recommendation and what SHA-1 HMAC keys on. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The code for one counter value — HOTP, RFC 4226 §5.3. */
function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  // Big-endian 64-bit. Written as two 32-bit halves because a JS number cannot hold 64 bits
  // exactly, and the high half is zero until the year 10 000 or so.
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac('sha1', secret).update(message).digest();
  // Dynamic truncation: the low nibble of the last byte picks where to read the code from, so an
  // attacker cannot know in advance which four bytes of the digest matter.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** The code an authenticator app is showing right now. Exported so a test can predict one. */
export function totpAt(secretBase32: string, at: Date, stepOffset = 0): string {
  const counter = Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS) + stepOffset;
  return hotp(base32Decode(secretBase32), counter);
}

/**
 * Does this code match, allowing for a clock a little out of step?
 *
 * Compared in constant time. The comparison leaks nothing useful on its own — the codes are short
 * and short-lived — but a timing-variable compare in an authentication path is the kind of thing
 * that gets copied somewhere it does matter.
 */
export function verifyTotp(secretBase32: string, code: string, at: Date = new Date()): boolean {
  const candidate = code.replace(/\s+/g, '');
  if (!/^\d+$/.test(candidate) || candidate.length !== TOTP_DIGITS) return false;

  const given = Buffer.from(candidate);
  let ok = false;
  for (let offset = -TOTP_DRIFT_STEPS; offset <= TOTP_DRIFT_STEPS; offset++) {
    const expected = Buffer.from(totpAt(secretBase32, at, offset));
    // Deliberately not short-circuiting: every step is checked whatever the first one said, so the
    // time taken says nothing about which one matched.
    if (given.length === expected.length && timingSafeEqual(given, expected)) ok = true;
  }
  return ok;
}

/**
 * The `otpauth://` URI an authenticator app reads from a QR code.
 *
 * The issuer appears twice on purpose — once as a label prefix and once as a parameter. Older apps
 * read only the prefix, newer ones only the parameter, and a portal that picked one shows up in
 * somebody's app as an unlabelled six-digit code among fifteen others.
 */
export function otpauthUri(secretBase32: string, account: string, issuer = 'Klasio Licensing') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Grouped into fours, for someone typing it in because their camera will not focus. */
export function readableSecret(secretBase32: string): string {
  return secretBase32.replace(/(.{4})/g, '$1 ').trim();
}
