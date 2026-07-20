/**
 * The rules a second factor obeys, separated from the database so they can be argued with.
 *
 * Everything here is pure. Lockout arithmetic, expiry boundaries and resend cooldowns are exactly
 * the things that are tedious to test through a login form and easy to get subtly wrong — an
 * off-by-one on a window is a code that stops working a minute early, or one that keeps working
 * after it should not.
 */
export const EMAIL_OTP_DIGITS = 6;

/**
 * Ten minutes. Long enough to find the mail in a spam folder on a slow connection, short enough
 * that a code left in an open inbox stops being a key by lunchtime.
 */
export const EMAIL_OTP_TTL_SECONDS = 10 * 60;

/** A minute between sends, so the button cannot be used to post mail at somebody. */
export const EMAIL_OTP_RESEND_COOLDOWN_SECONDS = 60;

/**
 * Wrong codes before the account stops accepting them for a while.
 *
 * Five, then fifteen minutes. A six-digit code is one in a million per guess, so this is not
 * really about exhaustion — it is about making an automated attempt visible and slow rather than
 * free, without locking out somebody whose phone clock has drifted and who is trying again.
 */
export const MFA_MAX_ATTEMPTS = 5;
export const MFA_LOCKOUT_SECONDS = 15 * 60;

/** How many one-use codes to hand out at enrolment. */
export const RECOVERY_CODE_COUNT = 10;

export interface MfaState {
  totpConfirmedAt: Date | null;
  mfaFailedAttempts: number;
  mfaLockedUntil: Date | null;
  emailOtpExpiresAt: Date | null;
  emailOtpSentAt: Date | null;
}

/** Enrolled means a code from the secret was accepted once — not merely that a secret exists. */
export function isEnrolled(state: Pick<MfaState, 'totpConfirmedAt'>): boolean {
  return state.totpConfirmedAt !== null;
}

export function isLockedOut(state: Pick<MfaState, 'mfaLockedUntil'>, now = new Date()): boolean {
  return state.mfaLockedUntil !== null && state.mfaLockedUntil.getTime() > now.getTime();
}

/** Seconds until the account will accept codes again. Zero when it already does. */
export function lockoutRemainingSeconds(
  state: Pick<MfaState, 'mfaLockedUntil'>,
  now = new Date(),
): number {
  if (!state.mfaLockedUntil) return 0;
  return Math.max(0, Math.ceil((state.mfaLockedUntil.getTime() - now.getTime()) / 1000));
}

/**
 * What a wrong code costs.
 *
 * Returns the next counter and, once the limit is reached, when the account may try again. The
 * counter keeps climbing past the threshold on purpose: a locked account that keeps being hammered
 * should not quietly reset itself the moment the window passes.
 */
export function registerFailure(
  state: Pick<MfaState, 'mfaFailedAttempts'>,
  now = new Date(),
): { attempts: number; lockedUntil: Date | null } {
  const attempts = state.mfaFailedAttempts + 1;
  if (attempts < MFA_MAX_ATTEMPTS) return { attempts, lockedUntil: null };
  return { attempts, lockedUntil: new Date(now.getTime() + MFA_LOCKOUT_SECONDS * 1000) };
}

/** An emailed code is usable while it has not expired. Expiry is inclusive of the final second. */
export function emailOtpUsable(
  state: Pick<MfaState, 'emailOtpExpiresAt'>,
  now = new Date(),
): boolean {
  return state.emailOtpExpiresAt !== null && state.emailOtpExpiresAt.getTime() >= now.getTime();
}

/** Seconds before another code may be sent. Zero when one may be sent now. */
export function resendWaitSeconds(
  state: Pick<MfaState, 'emailOtpSentAt'>,
  now = new Date(),
): number {
  if (!state.emailOtpSentAt) return 0;
  const elapsed = (now.getTime() - state.emailOtpSentAt.getTime()) / 1000;
  return Math.max(0, Math.ceil(EMAIL_OTP_RESEND_COOLDOWN_SECONDS - elapsed));
}

export function emailOtpExpiry(now = new Date()): Date {
  return new Date(now.getTime() + EMAIL_OTP_TTL_SECONDS * 1000);
}
