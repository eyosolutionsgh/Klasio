import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canIssue, usingDevSigningKey, vendorPublicKey, vendorSigningKey } from './vendor-key';

/**
 * The rule this file exists to hold: a portal may fall back to the committed development key so a
 * fresh clone can actually issue something, and it may never do so in production.
 *
 * The private half of that key is in the repository. A deployed portal signing with it would mean
 * every customer holding a checkout could mint themselves any package, for any school, forever.
 */
const ENV = ['NODE_ENV', 'VENDOR_SIGNING_KEY', 'VENDOR_SIGNING_KEY_PATH', 'VENDOR_DEV_KEY_PATH'];

/**
 * Next types `NODE_ENV` as read-only, which is right for application code and useless here: the
 * production refusal is the point of this file, so the test has to be able to claim production.
 */
const env = process.env as Record<string, string | undefined>;
const setEnv = (key: string, value: string | undefined) => {
  if (value === undefined) delete env[key];
  else env[key] = value;
};

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, env[k]]));
  for (const k of ENV) setEnv(k, undefined);
});

afterEach(() => {
  for (const k of ENV) setEnv(k, saved[k]);
});

describe('the development fallback', () => {
  /**
   * The whole point. Vitest runs from the package directory exactly as `next dev` does, so a
   * failure here means the shipped default path is wrong rather than the test being fussy.
   */
  it('lets a fresh checkout issue without configuring anything', () => {
    expect(canIssue()).toBe(true);
    expect(usingDevSigningKey()).toBe(true);
    expect(vendorSigningKey()).toContain('BEGIN');
  });

  it('refuses the development key in production, and says it cannot issue', () => {
    setEnv('NODE_ENV', 'production');
    expect(canIssue()).toBe(false);
    expect(usingDevSigningKey()).toBe(false);
    expect(() => vendorSigningKey()).toThrow(/VENDOR_SIGNING_KEY/);
  });

  it('reports no development key on a machine that does not carry the file', () => {
    setEnv('VENDOR_DEV_KEY_PATH', '/nowhere/dev-signing-key.pem');
    expect(canIssue()).toBe(false);
    expect(usingDevSigningKey()).toBe(false);
  });

  /** An unset variable arrives from compose and CI as "", which must not read as a path. */
  it('treats an empty variable as unset rather than as a path', () => {
    setEnv('VENDOR_SIGNING_KEY', '');
    setEnv('VENDOR_SIGNING_KEY_PATH', '');
    expect(canIssue()).toBe(true);
    expect(usingDevSigningKey()).toBe(true);
  });
});

describe('a configured key', () => {
  // Generated once and pasted: the point is that a real key wins, not that we can make one.
  const REAL = [
    '-----BEGIN PRIVATE KEY-----',
    'MC4CAQAwBQYDK2VwBCIEIEqCkoBBBPeq7T1D1zVfVJfyaWDDNbtBWY0DhLcvGmqe',
    '-----END PRIVATE KEY-----',
  ].join('\n');

  it('wins over the development key, and stops calling itself a development portal', () => {
    setEnv('VENDOR_SIGNING_KEY', REAL);
    expect(canIssue()).toBe(true);
    expect(usingDevSigningKey()).toBe(false);
    expect(vendorSigningKey()).toBe(REAL);
  });

  it('is honoured in production, where the fallback is refused', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('VENDOR_SIGNING_KEY', REAL);
    expect(canIssue()).toBe(true);
    expect(usingDevSigningKey()).toBe(false);
  });

  it('accepts base64 as well as a raw PEM', () => {
    setEnv('VENDOR_SIGNING_KEY', Buffer.from(REAL, 'utf8').toString('base64'));
    expect(vendorSigningKey()).toBe(REAL);
  });

  /**
   * Derived rather than configured, so the two halves cannot disagree — a mismatch would only
   * surface as licences that verify nowhere, at a customer.
   */
  it('derives the public half staff have to install on a school server', () => {
    setEnv('VENDOR_SIGNING_KEY', REAL);
    expect(vendorPublicKey()).toContain('BEGIN PUBLIC KEY');
  });
});
