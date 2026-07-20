/**
 * Secrets at rest in the vendor database.
 *
 * Only one thing needs this today — a member of staff's TOTP secret, which must be recoverable to
 * verify a code and so cannot be hashed. Anyone holding it can generate that person's codes
 * forever, which makes it the one value in this database worth more than a password hash.
 *
 * AES-256-GCM, so a tampered ciphertext fails to open rather than decrypting to rubbish.
 *
 * `VENDOR_ENCRYPTION_KEY` must be set in production. In development an unset key falls back to a
 * fixed one, deliberately and loudly: a portal nobody can sign into is a portal nobody develops.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const DEV_KEY = Buffer.alloc(32, 'klasio-vendor-development-key!!!');

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super('VENDOR_ENCRYPTION_KEY must be set (32 bytes, hex or base64) to store staff secrets.');
  }
}

/**
 * A configured key, or null if it is absent or the wrong size.
 *
 * Exported so the boot check and the encryption path agree about what "valid" means. Two opinions
 * about that is how a server starts cleanly and then fails the first time somebody enrols.
 */
export function parseEncryptionKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return buf.length === 32 ? buf : null;
}

function key(): Buffer {
  const parsed = parseEncryptionKey(process.env.VENDOR_ENCRYPTION_KEY || undefined);
  if (parsed) return parsed;
  // Unset in development is the documented fallback; unset in production never reaches here,
  // because `instrumentation.ts` refuses to start the server.
  if (process.env.VENDOR_ENCRYPTION_KEY || process.env.NODE_ENV === 'production') {
    throw new MissingEncryptionKeyError();
  }
  return DEV_KEY;
}

/** True when a real key is configured — what the settings screen reports rather than guesses. */
export function hasRealEncryptionKey(): boolean {
  return Boolean(process.env.VENDOR_ENCRYPTION_KEY);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  // iv.tag.ciphertext — self-describing, so rotating the format later is possible without guessing.
  return [
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    body.toString('base64'),
  ].join('.');
}

export function decryptSecret(stored: string): string {
  const [iv, tag, body] = stored.split('.');
  if (!iv || !tag || !body) throw new Error('Stored secret is malformed');
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}
