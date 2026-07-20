/**
 * Vendor staff sessions.
 *
 * A signed cookie holding a user id, and nothing else. Deliberately not JWT-with-claims: this is
 * an internal tool for a handful of people, the user row is read on every request anyway, and a
 * token that carries authority is a token that outlives a revocation.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from './db';

const COOKIE = 'eyo_vendor';
const MAX_AGE_S = 60 * 60 * 8;

/**
 * The cookie that says who is *claiming* to sign in, and nothing more.
 *
 * A separate cookie rather than a flag inside the session one, so there is no shape of bug where a
 * half-authenticated token is mistaken for a finished one. `currentUser` reads only the real
 * cookie and cannot be talked into accepting this; the pending name is never checked anywhere that
 * grants access.
 *
 * It carries the **email as typed**, not a user id, and that is deliberate. Sign-in is passwordless
 * — the first step is only a claim — so minting this has to succeed for an address with no account
 * behind it, or the login page would answer "who has an account here?" by how it behaves.
 */
const PENDING_COOKIE = 'eyo_vendor_pending';

/** Ten minutes to produce a code. Long enough to find a phone or an inbox, short enough to matter. */
const PENDING_MAX_AGE_S = 10 * 60;

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

function mint(name: string, userId: string, maxAge: number) {
  const issued = `${userId}.${Date.now()}`;
  return { name, value: `${issued}.${sign(issued)}`, maxAge };
}

export function mintSession(userId: string) {
  return mint(COOKIE, userId, MAX_AGE_S);
}

/**
 * Issued the moment an address is typed, and exchanged for a real session by a code.
 *
 * Minted whether or not that address has an account. Refusing here — or minting only for real
 * accounts — would make the next screen's existence the answer to "is this person staff?".
 */
export function mintPendingSession(email: string) {
  return mint(PENDING_COOKIE, email, PENDING_MAX_AGE_S);
}

function verify(raw: string | undefined, maxAgeS: number): string | null {
  if (!raw) return null;
  const idx = raw.lastIndexOf('.');
  if (idx === -1) return null;
  const body = raw.slice(0, idx);
  const mac = raw.slice(idx + 1);
  const expected = sign(body);
  // Constant-time: a byte-by-byte comparison leaks how much of a forged MAC was right.
  if (mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;

  // `subject` is a user id in a session cookie and an email address in a pending one. Split from
  // the right, because an email may contain no dots but the timestamp separator always exists.
  const cut = body.lastIndexOf('.');
  if (cut === -1) return null;
  const subject = body.slice(0, cut);
  const issuedAt = body.slice(cut + 1);
  if (!subject || !issuedAt) return null;
  if (Date.now() - Number(issuedAt) > maxAgeS * 1000) return null;
  return subject;
}

/** The signed-in member of staff, or null. Reads the row every time, so deactivating one bites. */
export async function currentUser() {
  const jar = await cookies();
  const userId = verify(jar.get(COOKIE)?.value, MAX_AGE_S);
  if (!userId) return null;
  const user = await db.vendorUser.findUnique({ where: { id: userId } });
  return user?.active ? user : null;
}

/**
 * The address somebody typed on the sign-in page, if that claim is still live.
 *
 * A string rather than a row, because there may be no row — and the screen that renders from this
 * has to look identical either way.
 */
export async function pendingIdentity(): Promise<string | null> {
  const jar = await cookies();
  return verify(jar.get(PENDING_COOKIE)?.value, PENDING_MAX_AGE_S);
}

/**
 * The account behind that claim, or null if there is none.
 *
 * Deliberately a different function from `currentUser`, because the two answer different questions
 * and the only safe way to keep them apart is for no caller to be able to confuse them. Nothing
 * that renders a page or runs an action may use this one to grant anything.
 */
export async function pendingUser() {
  const email = await pendingIdentity();
  if (!email) return null;
  const user = await db.vendorUser.findUnique({ where: { email } });
  return user?.active ? user : null;
}

/**
 * The signed-in member of staff, or a redirect to wherever they actually are in signing in.
 *
 * Enforcement does not depend on this — `currentUser` reads only the real cookie and a pending one
 * can never satisfy it, whatever any page forgets to call. This exists so that refreshing during a
 * code screen does not send somebody back to retype their address.
 */
export async function requireUser() {
  const user = await currentUser();
  if (user) return user;
  // Part-way through signing in goes back to the code screen rather than to the start.
  redirect((await pendingIdentity()) ? '/verify' : '/login');
}

export const SESSION_COOKIE = COOKIE;
export const PENDING_SESSION_COOKIE = PENDING_COOKIE;
