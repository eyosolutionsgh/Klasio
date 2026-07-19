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
 */
import { createPrivateKey, createPublicKey } from 'crypto';
import { readFileSync } from 'fs';

export class MissingVendorKeyError extends Error {
  constructor() {
    super(
      'No signing key configured. Set VENDOR_SIGNING_KEY (PEM or base64) or ' +
        'VENDOR_SIGNING_KEY_PATH. Without it this portal can track licences but not issue them.',
    );
  }
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

/** Whether this portal can issue licences at all. Drives the UI rather than throwing at it. */
export function canIssue(): boolean {
  return read(process.env.VENDOR_SIGNING_KEY, process.env.VENDOR_SIGNING_KEY_PATH) !== null;
}

export function vendorSigningKey(): string {
  const key = read(process.env.VENDOR_SIGNING_KEY, process.env.VENDOR_SIGNING_KEY_PATH);
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
  const priv = read(process.env.VENDOR_SIGNING_KEY, process.env.VENDOR_SIGNING_KEY_PATH);
  if (!priv) return null;
  return createPublicKey(createPrivateKey(priv)).export({ type: 'spki', format: 'pem' }).toString();
}
