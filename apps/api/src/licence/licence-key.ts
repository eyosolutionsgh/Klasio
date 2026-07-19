/**
 * The key licences are checked against.
 *
 * A public key is meant to be public — committing it is the point. What ships below is a
 * DEVELOPMENT key whose private half is also in this repository (`ops/licence/dev-signing-key.pem`),
 * exactly like the deterministic dev key in `common/crypto.ts` and for the same reason: the stack,
 * the seed and the E2E suite have to work on a fresh checkout with no secrets handed round.
 *
 * Which means: **anyone holding this repository can mint a licence signed by the dev key.** That is
 * fine in development and unacceptable in production, so `licencePublicKey()` refuses the dev key
 * when NODE_ENV is production. A real deployment sets LICENCE_PUBLIC_KEY to the vendor's own key,
 * whose private half never leaves the vendor.
 *
 * Rotation: set LICENCE_PUBLIC_KEY. Nothing else reads the key, and licences are re-checked
 * hourly, so a rotation takes effect within the hour without a restart.
 */

/** Development only. The matching private key is committed at ops/licence/dev-signing-key.pem. */
export const DEV_LICENCE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA0odlEiChzxQPZHktyhOEAu2upMta2y73YAZrOlDY/9s=
-----END PUBLIC KEY-----`;

export class InsecureLicenceKeyError extends Error {
  constructor() {
    super(
      'LICENCE_PUBLIC_KEY is not set. Refusing to validate licences against the development key ' +
        'in production — its private half is public in the Klasio repository, so any licence ' +
        'could be forged. Set LICENCE_PUBLIC_KEY to the vendor key.',
    );
  }
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** True when we are falling back to the committed dev key rather than a configured one. */
export function usingDevLicenceKey(): boolean {
  return !process.env.LICENCE_PUBLIC_KEY;
}

/**
 * Throws `InsecureLicenceKeyError` in production when unconfigured. The caller catches it and
 * drops the school to BASIC with the message on screen — a box that cannot tell a real licence
 * from a forged one must not act on either, but it must still open in the morning.
 */
export function licencePublicKey(): string {
  const configured = process.env.LICENCE_PUBLIC_KEY;
  if (configured)
    return configured.includes('BEGIN')
      ? configured
      : Buffer.from(configured, 'base64').toString('utf8');
  if (isProduction()) throw new InsecureLicenceKeyError();
  return DEV_LICENCE_PUBLIC_KEY;
}
