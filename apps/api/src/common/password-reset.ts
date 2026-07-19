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

export interface ResetRow {
  expiresAt: Date;
  consumedAt: Date | null;
  supersededAt: Date | null;
}

export type ResetState = 'valid' | 'expired' | 'consumed' | 'superseded';

/**
 * Order matters here.
 *
 * `consumed` is checked before `expired` so that a link someone already used reports being used
 * rather than merely old — the two call for different actions, and "expired" would send a person
 * who has already reset their password back around the loop for no reason.
 */
export function resetState(row: ResetRow, now: Date): ResetState {
  if (row.consumedAt) return 'consumed';
  if (row.supersededAt) return 'superseded';
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
    case 'expired':
      return `That reset link has expired — they last ${RESET_TTL_MINUTES} minutes. Ask for a new one.`;
  }
}
