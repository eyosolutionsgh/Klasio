/**
 * The key licences are checked against.
 *
 * A real deployment sets `LICENCE_PUBLIC_KEY` to the vendor's own key, whose private half never
 * leaves the vendor. Everything below is about the development fallback, and about making sure a
 * shipped build cannot use it.
 *
 * ## Why the dev key is read from a file rather than written here
 *
 * The dev key's private half is committed (`ops/licence/dev-signing-key.pem`), exactly like the
 * deterministic dev key in `common/crypto.ts` and for the same reason: a fresh checkout, the seed
 * and the E2E suite all have to work with no secrets handed round. So anyone holding this
 * repository can mint a licence the dev key will verify.
 *
 * As a string constant that was fine in development and quietly dangerous in production, because
 * `tsc` compiled it straight into `dist/licence/licence-key.js` and it shipped inside the image.
 * The only thing standing between that image and free Advanced was `NODE_ENV !== 'production'` —
 * and `NODE_ENV` is set by whoever runs the container. `docker run -e NODE_ENV=development` was
 * the entire attack, and it needed no expertise at all.
 *
 * Now it is a file under `ops/`, which `apps/api/Dockerfile` never copies. A production image does
 * not contain the dev key and cannot be talked into accepting one: the guard is a property of the
 * artifact rather than of its configuration. `NODE_ENV` is kept as a second line, for a developer
 * checkout that is somehow serving production.
 *
 * Rotation: set `LICENCE_PUBLIC_KEY`. Nothing else reads the key, and licences are re-checked
 * hourly, so a rotation takes effect within the hour without a restart.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * `__dirname` rather than `process.cwd()`: this resolves the same from `src/licence` under
 * ts-node and from `dist/licence` in a build, and does not care where the process was started.
 *
 * `LICENCE_DEV_KEY_PATH` overrides it, which the tests use to simulate a shipped image. It grants
 * nothing that `LICENCE_PUBLIC_KEY` does not already grant — anyone who can set one can set the
 * other — so it is a testing seam rather than a second way in.
 */
function devKeyPath(): string {
  // `||`, not `??`: an unset variable arrives from docker-compose and CI as the empty string, and
  // `??` would happily accept "" as a path — reading nothing, and reporting a build with no
  // development key on a machine that has one.
  return (
    process.env.LICENCE_DEV_KEY_PATH ||
    join(__dirname, '..', '..', '..', '..', 'ops', 'licence', 'dev-public.pem')
  );
}

/** The PEM block, ignoring the explanatory prose the file carries above it. */
function extractPem(text: string): string | null {
  const match = /-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/.exec(text);
  return match ? match[0] : null;
}

/**
 * Read once. A miss is cached too — on a production image the file is absent by design, and
 * retrying a failed read on every licence check would be pointless syscalls.
 */
let devKeyCache: { value: string | null } | undefined;

function devLicenceKey(): string | null {
  if (!devKeyCache) {
    try {
      devKeyCache = { value: extractPem(readFileSync(devKeyPath(), 'utf8')) };
    } catch {
      devKeyCache = { value: null };
    }
  }
  return devKeyCache.value;
}

/** Tests only — the cache would otherwise outlive a fixture that moves the file. */
export function forgetDevLicenceKey() {
  devKeyCache = undefined;
}

export class InsecureLicenceKeyError extends Error {
  constructor(reason: 'production' | 'absent') {
    super(
      reason === 'absent'
        ? 'LICENCE_PUBLIC_KEY is not set and this build carries no development key. Set ' +
            'LICENCE_PUBLIC_KEY to the vendor key — a server that cannot tell a real licence from ' +
            'a forged one must not act on either.'
        : 'LICENCE_PUBLIC_KEY is not set. Refusing to validate licences against the development ' +
            'key in production — its private half is public in the Klasio repository, so any ' +
            'licence could be forged. Set LICENCE_PUBLIC_KEY to the vendor key.',
    );
  }
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * True when the development key is what licences are actually being checked against — which is
 * what the amber banner on the licence screen reports.
 *
 * Deliberately not just "LICENCE_PUBLIC_KEY is unset": on a build with no dev key that is a
 * refusal, not a fallback, and saying "checking against the development key" would be a lie.
 */
export function usingDevLicenceKey(): boolean {
  if (process.env.LICENCE_PUBLIC_KEY) return false;
  return !isProduction() && devLicenceKey() !== null;
}

/**
 * Throws `InsecureLicenceKeyError` when there is no key it may legitimately use. The caller
 * catches it and drops the school to BASIC with the message on screen — a box that cannot verify
 * a licence must not act on one, but it must still open in the morning.
 */
export function licencePublicKey(): string {
  const configured = process.env.LICENCE_PUBLIC_KEY;
  if (configured) {
    return configured.includes('BEGIN')
      ? configured
      : Buffer.from(configured, 'base64').toString('utf8');
  }

  const dev = devLicenceKey();
  // Absence first: on a shipped image this is the real guard, and it does not depend on NODE_ENV
  // being what the vendor set rather than what the operator passed.
  if (!dev) throw new InsecureLicenceKeyError('absent');
  if (isProduction()) throw new InsecureLicenceKeyError('production');
  return dev;
}
