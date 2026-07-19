/**
 * Authenticated encryption for secrets held per school (docs/03 §3.3 "per-tenant encryption of
 * sensitive columns") — payment-gateway credentials, and social account access tokens.
 *
 * AES-256-GCM. Ciphertext is stored as `v1:<iv>:<authTag>:<ciphertext>` (base64 parts) so the
 * format is self-describing and can be rotated later without guessing.
 *
 * The key comes from APP_ENCRYPTION_KEY (32 bytes, hex or base64). In dev, when it is unset, a
 * fixed development key is used so the stack boots — but storing LIVE gateway credentials
 * without a real key is refused.
 *
 * It was PAYMENTS_ENCRYPTION_KEY, which was already a poor name for a general secret store and
 * became plainly wrong once it started holding social tokens. The old name is still read so an
 * existing deployment keeps booting — and it must be, because the two names decrypt the same
 * ciphertext and renaming the variable without reading it would make every stored secret
 * undecryptable.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'crypto';

const VERSION = 'v1';
const DEV_KEY = Buffer.alloc(32, 7); // deterministic, obviously-not-secret dev key

/**
 * Work factor for every password this product hashes.
 *
 * Defined once: registration, staff invitation and password reset must not drift apart, or a
 * password's resistance to cracking would depend on which screen created it.
 */
export const BCRYPT_ROUNDS = 10;

/**
 * A readable one-time password an office can dictate down a phone line.
 *
 * Lives here rather than in the module that first needed it, because two very different callers
 * now issue one — a head resetting a member of staff, and the vendor console handing a locked-out
 * proprietor their school back — and a second copy would be a second alphabet to keep in step.
 *
 * The alphabet omits look-alikes (no O/0, no I/1/l) for exactly the reason the function exists:
 * these get read aloud, written on paper, and typed by someone who is already having a bad day.
 */
export function tempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  const body = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  // Prefixed with the product name so a password found on a sticky note is at least identifiable.
  // `Eyo-` until the rename; nothing keys off the value, so it moves with the product.
  return `Klasio-${body}`;
}

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super('APP_ENCRYPTION_KEY must be set (32 bytes, hex or base64) to store live secrets');
  }
}

/**
 * The configured key material, under either name.
 *
 * Warns once rather than per call: this is read on every encrypt, and a warning per gateway
 * write would bury the boot log it is trying to be noticed in.
 */
let warnedLegacyKeyName = false;

function rawEncryptionKey(): string | undefined {
  const current = process.env.APP_ENCRYPTION_KEY;
  if (current) return current;
  const legacy = process.env.PAYMENTS_ENCRYPTION_KEY;
  if (legacy && !warnedLegacyKeyName) {
    warnedLegacyKeyName = true;
    console.warn(
      '[crypto] PAYMENTS_ENCRYPTION_KEY is deprecated — rename it to APP_ENCRYPTION_KEY. It now ' +
        'protects social account tokens as well as gateway credentials. Keep the same value: ' +
        'a different key cannot decrypt what the old one stored.',
    );
  }
  return legacy;
}

function parseKey(raw: string): Buffer | null {
  const hex = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : null;
  if (hex) return hex;
  const b64 = Buffer.from(raw, 'base64');
  return b64.length === 32 ? b64 : null;
}

/** Resolve the encryption key. `requireReal` refuses the dev fallback (used for LIVE mode). */
export function encryptionKey(requireReal = false): Buffer {
  const raw = rawEncryptionKey();
  if (!raw) {
    if (requireReal) throw new MissingEncryptionKeyError();
    return DEV_KEY;
  }
  const key = parseKey(raw);
  if (!key) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)');
  return key;
}

export function hasRealEncryptionKey(): boolean {
  return !!rawEncryptionKey();
}

export function encryptSecret(plaintext: string, requireReal = false): string {
  const key = encryptionKey(requireReal);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(':');
  if (version !== VERSION) throw new Error(`Unsupported ciphertext version "${version}"`);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Constant-time string compare for signature verification. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Opaque, URL-safe token for public pay links. */
export function publicToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}
