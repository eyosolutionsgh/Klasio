/**
 * Vendor staff sessions.
 *
 * A signed cookie holding a user id, and nothing else. Deliberately not JWT-with-claims: this is
 * an internal tool for a handful of people, the user row is read on every request anyway, and a
 * token that carries authority is a token that outlives a revocation.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { db } from './db';

const COOKIE = 'eyo_vendor';
const MAX_AGE_S = 60 * 60 * 8;

function secret(): string {
  const s = process.env.VENDOR_SESSION_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('VENDOR_SESSION_SECRET must be set — it signs vendor staff sessions.');
    }
    return 'development-only-vendor-secret';
  }
  return s;
}

function sign(value: string): string {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

export function mintSession(userId: string): { name: string; value: string; maxAge: number } {
  const issued = `${userId}.${Date.now()}`;
  return { name: COOKIE, value: `${issued}.${sign(issued)}`, maxAge: MAX_AGE_S };
}

function verify(raw: string | undefined): string | null {
  if (!raw) return null;
  const idx = raw.lastIndexOf('.');
  if (idx === -1) return null;
  const body = raw.slice(0, idx);
  const mac = raw.slice(idx + 1);
  const expected = sign(body);
  // Constant-time: a byte-by-byte comparison leaks how much of a forged MAC was right.
  if (mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;

  const [userId, issuedAt] = body.split('.');
  if (!userId || !issuedAt) return null;
  if (Date.now() - Number(issuedAt) > MAX_AGE_S * 1000) return null;
  return userId;
}

/** The signed-in member of staff, or null. Reads the row every time, so deactivating one bites. */
export async function currentUser() {
  const jar = await cookies();
  const userId = verify(jar.get(COOKIE)?.value);
  if (!userId) return null;
  const user = await db.vendorUser.findUnique({ where: { id: userId } });
  return user?.active ? user : null;
}

export const SESSION_COOKIE = COOKIE;
