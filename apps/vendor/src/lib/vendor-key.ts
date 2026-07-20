/**
 * The vendor's signing key — the single most sensitive thing in this product.
 *
 * Whoever holds it can mint a licence for any school, for any package, forever. It is read from
 * `VENDOR_SIGNING_KEY` (the PEM, or base64 of it) or `VENDOR_SIGNING_KEY_PATH`, and it is never
 * written to the database, never logged, and never returned by any route in this application.
 *
 * There is deliberately no way to view it through the portal. A member of staff who needs it has
 * to go to the server, which is a meaningfully higher bar than being signed in — and the portal is
 * the thing most likely to be exposed to the internet.
 *
 * ## The development fallback
 *
 * With neither variable set, a non-production portal falls back to the committed development key
 * at `ops/licence/dev-signing-key.pem` — the same key `licence:mint` uses, and the one a school
 * running from a checkout verifies against. Without it a fresh clone could track licences and not
 * issue one, so the portal's main job was unreachable until you had read this file and guessed
 * what to point at.
 *
 * It is a fallback and never a default: `isProduction()` refuses it outright, because that private
 * half is committed and anyone with the repository can mint against it. Signing real licences with
 * it would mean every customer could issue themselves anything. A deployed portal must be given a
 * real key, and until it is it can watch but not sell.
 */
import { createPrivateKey, createPublicKey } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

export class MissingVendorKeyError extends Error {
  constructor() {
    super(
      'No signing key configured. Set VENDOR_SIGNING_KEY (PEM or base64) or ' +
        'VENDOR_SIGNING_KEY_PATH. Without it this portal can track licences but not issue them.',
    );
  }
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * `process.cwd()` rather than `__dirname`: Next bundles server code, so `__dirname` points into
 * `.next` and moves between dev and a build. The dev server and `next start` both run from the
 * package directory, which makes this stable in a way the bundle output is not.
 */
function devKeyPath(): string {
  // `||`, not `??`: an unset variable arrives from compose and CI as the empty string, and `??`
  // would accept "" as a path — reading nothing, then reporting no development key on a machine
  // that has one.
  return (
    process.env.VENDOR_DEV_KEY_PATH ||
    join(process.cwd(), '..', '..', 'ops', 'licence', 'dev-signing-key.pem')
  );
}

function extractPem(text: string, kind: 'PRIVATE' | 'PUBLIC'): string | null {
  const re = new RegExp(
    `-----BEGIN [A-Z ]*${kind} KEY-----[\\s\\S]*?-----END [A-Z ]*${kind} KEY-----`,
  );
  return re.exec(text)?.[0] ?? null;
}

function read(envValue: string | undefined, pathValue: string | undefined): string | null {
  // `||` not `??` throughout: an unset variable arrives from compose and CI as the empty string.
  const inline = envValue || undefined;
  if (inline) {
    const text = inline.includes('BEGIN') ? inline : Buffer.from(inline, 'base64').toString('utf8');
    return extractPem(text, 'PRIVATE');
  }
  const path = pathValue || undefined;
  if (!path) return null;
  try {
    return extractPem(readFileSync(path, 'utf8'), 'PRIVATE');
  } catch {
    return null;
  }
}

/** What the operator configured, ignoring the development fallback entirely. */
function configuredKey(): string | null {
  return read(process.env.VENDOR_SIGNING_KEY, process.env.VENDOR_SIGNING_KEY_PATH);
}

/**
 * The development key, or null on a machine that does not carry it.
 *
 * Read every time rather than cached: this is a handful of syscalls on an internal tool used by a
 * few people, and caching would mean a portal that had to be restarted to notice a key.
 */
function devKey(): string | null {
  if (isProduction()) return null;
  return read(undefined, devKeyPath());
}

function signingKey(): string | null {
  return configuredKey() ?? devKey();
}

/** Whether this portal can issue licences at all. Drives the UI rather than throwing at it. */
export function canIssue(): boolean {
  return signingKey() !== null;
}

/**
 * True when licences would be signed with the committed development key.
 *
 * Drives the warning beside the issue form. Unlike the equivalent on a school's server — which is
 * addressed to someone who cannot act on it and was removed — this one is read by exactly the
 * person who configures the key, and it changes what the licence they are about to mint is worth.
 */
export function usingDevSigningKey(): boolean {
  return configuredKey() === null && devKey() !== null;
}

export function vendorSigningKey(): string {
  const key = signingKey();
  if (!key) throw new MissingVendorKeyError();
  return key;
}

/**
 * The matching public key, for showing staff what to put on a school's server.
 *
 * Derived from the private key rather than configured separately: two variables that must agree is
 * two variables that can disagree, and the failure — licences that verify nowhere — would show up
 * at a customer rather than here.
 */
export function vendorPublicKey(): string | null {
  const priv = signingKey();
  if (!priv) return null;
  return createPublicKey(createPrivateKey(priv)).export({ type: 'spki', format: 'pem' }).toString();
}
