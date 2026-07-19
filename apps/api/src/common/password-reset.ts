/**
 * When a staff password-reset link may be redeemed.
 *
 * Pure, and separate from the auth module, because "is this link still good?" is the whole
 * security of the flow and every one of its four answers is a way in if it is decided wrongly.
 */
import { createHash } from 'crypto';

/** How long a reset link stays usable. Short: it arrives instantly and is used immediately. */
export const RESET_TTL_MINUTES = 30;

/**
 * SHA-256 of the emailed token, which is what the table stores.
 *
 * Not bcrypt, deliberately: the token is 32 bytes of CSPRNG output, so there is no dictionary to
 * slow down, and redemption looks the row up *by* the hash — a per-row salt would make that
 * lookup a table scan. The same reasoning `SchoolInvitation` already follows.
 */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * A code, not a link, because it has to travel by SMS.
 *
 * Six digits keeps it to one message and one credit — a reset URL is about a hundred characters,
 * which splits across several segments, costs several credits, and is the shape of message
 * networks most like to filter. It is also what a parent on this platform already types to sign
 * in, so it is the familiar thing rather than the novel one.
 */
export const RESET_CODE_DIGITS = 6;

/**
 * How many wrong codes a single request tolerates before it is dead.
 *
 * A million possibilities is nothing at network speed; the ceiling is what makes six digits safe
 * at all. Burning the request rather than locking the account means a wrong guess cannot be used
 * to keep the real person out — they simply ask for another code.
 */
export const RESET_MAX_CODE_ATTEMPTS = 5;

/** How many reset requests one account may make in an hour, by any channel. */
export const RESET_MAX_PER_HOUR = 5;

/** How long to wait between requests, so a held-down button cannot spend a school's SMS credits. */
export const RESET_RESEND_COOLDOWN_SECONDS = 60;

/**
 * Hash of an SMS code, salted per row.
 *
 * The salt is not a secret and is never sent; it does two jobs. It keeps `tokenHash` unique when
 * the same person asks twice and happens to draw the same six digits — a collision on that
 * constraint would turn a reset request into a 500. And it means a leaked table cannot be read
 * with a precomputed million-entry table, which is all an unsalted six-digit hash is worth.
 */
export function hashResetCode(salt: string, code: string): string {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

/**
 * Whether another reset request may be made now.
 *
 * Unthrottled, this endpoint is a way to spend someone else's money: it takes no authentication,
 * and every SMS it sends is a credit off the school's balance. It is also a way to bury the one
 * real reset mail in fifty others. Both are answered by the same two limits.
 */
export function resetRequestAllowed(
  recent: { count: number; lastRequestedAt: Date | null },
  now: Date,
): boolean {
  if (recent.count >= RESET_MAX_PER_HOUR) return false;
  if (
    recent.lastRequestedAt &&
    now.getTime() - recent.lastRequestedAt.getTime() < RESET_RESEND_COOLDOWN_SECONDS * 1000
  ) {
    return false;
  }
  return true;
}

export interface ResetRow {
  expiresAt: Date;
  consumedAt: Date | null;
  supersededAt: Date | null;
  /** Absent on link rows, which cannot be guessed and so carry no counter. */
  attempts?: number;
}

export type ResetState = 'valid' | 'expired' | 'consumed' | 'superseded' | 'exhausted';

/**
 * Order matters here.
 *
 * `consumed` is checked before `expired` so that a link someone already used reports being used
 * rather than merely old — the two call for different actions, and "expired" would send a person
 * who has already reset their password back around the loop for no reason.
 *
 * `exhausted` comes before `expired` for the same reason, and sits after the two terminal states
 * because a request that was already spent is spent whatever its attempt count says.
 */
export function resetState(row: ResetRow, now: Date): ResetState {
  if (row.consumedAt) return 'consumed';
  if (row.supersededAt) return 'superseded';
  if ((row.attempts ?? 0) >= RESET_MAX_CODE_ATTEMPTS) return 'exhausted';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'valid';
}

/** What the person on the reset page is told. Never distinguishes an unknown token from a bad one. */
export function resetStateMessage(state: Exclude<ResetState, 'valid'>): string {
  switch (state) {
    case 'consumed':
      return 'That reset link has already been used. Sign in, or ask for a new link.';
    case 'superseded':
      return 'A newer reset link was sent. Use the most recent email, or ask for a new link.';
    case 'exhausted':
      return 'Too many wrong codes were entered. Ask for a new code.';
    case 'expired':
      return `That reset link has expired — they last ${RESET_TTL_MINUTES} minutes. Ask for a new one.`;
  }
}
