import { describe, expect, it } from 'vitest';
import { assertSecrets, InsecureDeploymentError, secretProblems } from './boot';

const GOOD_KEY = 'a'.repeat(64); // 32 bytes as hex
const PROD = {
  NODE_ENV: 'production',
  VENDOR_ENCRYPTION_KEY: GOOD_KEY,
  VENDOR_SESSION_SECRET: 'x'.repeat(64),
  VENDOR_DATABASE_URL: 'postgresql://u:p@h:5432/d',
};

describe('what a production deployment must be given', () => {
  it('is satisfied when everything is set', () => {
    expect(secretProblems(PROD)).toEqual([]);
    expect(() => assertSecrets(PROD)).not.toThrow();
  });

  /**
   * The case this whole file exists for. Unset in production means falling back to a key published
   * in the repository, which would make every staff authenticator secret readable by anyone with a
   * checkout.
   */
  it('refuses to start without an encryption key', () => {
    const problems = secretProblems({ ...PROD, VENDOR_ENCRYPTION_KEY: undefined });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/VENDOR_ENCRYPTION_KEY is not set/);
    expect(() => assertSecrets({ ...PROD, VENDOR_ENCRYPTION_KEY: undefined })).toThrow(
      InsecureDeploymentError,
    );
  });

  /**
   * More dangerous than absent, because a presence check waves it through: the server starts, and
   * fails the first time somebody enrols.
   */
  it('refuses a key that is present but the wrong size', () => {
    for (const bad of ['too-short', 'a'.repeat(62), Buffer.alloc(16).toString('base64')]) {
      const problems = secretProblems({ ...PROD, VENDOR_ENCRYPTION_KEY: bad });
      expect(problems, `should reject ${bad.slice(0, 12)}…`).toHaveLength(1);
      expect(problems[0]).toMatch(/not 32 bytes/);
    }
  });

  it('accepts base64 as well as hex', () => {
    const b64 = Buffer.alloc(32, 7).toString('base64');
    expect(secretProblems({ ...PROD, VENDOR_ENCRYPTION_KEY: b64 })).toEqual([]);
  });

  /** An unset variable arrives from compose and CI as "", which must not read as configured. */
  it('treats an empty variable as unset', () => {
    expect(secretProblems({ ...PROD, VENDOR_ENCRYPTION_KEY: '' })[0]).toMatch(/is not set/);
    expect(secretProblems({ ...PROD, VENDOR_SESSION_SECRET: '' })[0]).toMatch(/SESSION_SECRET/);
  });

  /** Everything wrong at once, so bringing a server up is not a sequence of restarts. */
  it('reports every problem together', () => {
    const problems = secretProblems({ NODE_ENV: 'production' });
    expect(problems).toHaveLength(3);
    expect(() => assertSecrets({ NODE_ENV: 'production' })).toThrow(/ENCRYPTION_KEY[\s\S]*SESSION/);
  });

  /**
   * A signing key is deliberately not required: tracking licences without issuing them is a
   * supported way to run, and the UI already says so plainly.
   */
  it('does not require a signing key', () => {
    expect(secretProblems({ ...PROD, VENDOR_SIGNING_KEY: undefined } as never)).toEqual([]);
  });

  /** Every one of these has a documented development fallback; a portal nobody can start is worse. */
  it('requires nothing outside production', () => {
    expect(secretProblems({})).toEqual([]);
    expect(secretProblems({ NODE_ENV: 'development' })).toEqual([]);
    expect(() => assertSecrets({ NODE_ENV: 'test' })).not.toThrow();
  });
});
