/**
 * Authenticated encryption for secrets held per tenant — currently payment-gateway
 * credentials (docs/03 §3.3 "per-tenant encryption of sensitive columns").
 *
 * AES-256-GCM. Ciphertext is stored as `v1:<iv>:<authTag>:<ciphertext>` (base64 parts) so the
 * format is self-describing and can be rotated later without guessing.
 *
 * The key comes from PAYMENTS_ENCRYPTION_KEY (32 bytes, hex or base64). In dev, when it is
 * unset, a fixed development key is used so the stack boots — but storing LIVE gateway
 * credentials without a real key is refused.
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

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super('PAYMENTS_ENCRYPTION_KEY must be set (32 bytes, hex or base64) to store live secrets');
  }
}

function parseKey(raw: string): Buffer | null {
  const hex = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : null;
  if (hex) return hex;
  const b64 = Buffer.from(raw, 'base64');
  return b64.length === 32 ? b64 : null;
}

/** Resolve the encryption key. `requireReal` refuses the dev fallback (used for LIVE mode). */
export function encryptionKey(requireReal = false): Buffer {
  const raw = process.env.PAYMENTS_ENCRYPTION_KEY;
  if (!raw) {
    if (requireReal) throw new MissingEncryptionKeyError();
    return DEV_KEY;
  }
  const key = parseKey(raw);
  if (!key) throw new Error('PAYMENTS_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)');
  return key;
}

export function hasRealEncryptionKey(): boolean {
  return !!process.env.PAYMENTS_ENCRYPTION_KEY;
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
