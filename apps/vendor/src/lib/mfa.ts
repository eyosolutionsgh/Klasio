/**
 * Second factors, against the database.
 *
 * The rules live in `mfa-policy.ts`, pure and tested. This file is the part that reads and writes
 * rows, and its one job is to make sure every path through it either fails or clears the failure
 * counter — a check that can be retried for free is not a check.
 */
import { randomBytes, randomInt } from 'crypto';
import bcrypt from 'bcryptjs';
import { encryptSecret, decryptSecret } from './crypto';
import { db } from './db';
import { canSendEmail, sendMail } from './mail';
import {
  EMAIL_OTP_DIGITS,
  emailOtpExpiry,
  emailOtpUsable,
  isLockedOut,
  lockoutRemainingSeconds,
  MFA_MAX_ATTEMPTS,
  RECOVERY_CODE_COUNT,
  registerFailure,
  resendWaitSeconds,
} from './mfa-policy';
import { generateTotpSecret, otpauthUri, readableSecret, verifyTotp } from './totp';

export type MfaFactor = 'totp' | 'email' | 'recovery';

export interface VerifyResult {
  ok: boolean;
  /** Present on failure, and phrased for the person typing rather than for a log. */
  error?: string;
}

/**
 * Begin enrolment: a secret to scan, not yet trusted for signing in.
 *
 * Reuses an unconfirmed secret rather than minting a new one on every visit. Generating afresh
 * each render means refreshing the page — or a browser prefetch — silently invalidates the QR
 * somebody has already scanned, and their app then shows codes that will never be accepted.
 *
 * A *confirmed* secret is never reissued from here; re-enrolling has to go through a factor the
 * person already holds, or a password alone would be enough to replace the second factor.
 */
export async function beginEnrolment(userId: string, email: string) {
  const user = await db.vendorUser.findUnique({ where: { id: userId } });
  if (!user) throw new Error('No such user');
  if (user.totpConfirmedAt) throw new Error('Already enrolled');

  const secret = user.totpSecretEnc ? decryptSecret(user.totpSecretEnc) : generateTotpSecret();
  if (!user.totpSecretEnc) {
    await db.vendorUser.update({
      where: { id: userId },
      data: { totpSecretEnc: encryptSecret(secret), totpConfirmedAt: null },
    });
  }
  return { secret, uri: otpauthUri(secret, email), readable: readableSecret(secret) };
}

/**
 * Finish enrolment by proving the secret was actually stored somewhere.
 *
 * Recovery codes are generated here and returned once. They are stored hashed, so this is the only
 * moment they can ever be shown — which is worth being explicit about on screen, because the
 * alternative is somebody closing the page and quietly having no way back in.
 */
export async function confirmEnrolment(
  userId: string,
  code: string,
): Promise<VerifyResult & { recoveryCodes?: string[] }> {
  const user = await db.vendorUser.findUnique({ where: { id: userId } });
  if (!user?.totpSecretEnc) return { ok: false, error: 'Start again — that setup has expired.' };

  if (!verifyTotp(decryptSecret(user.totpSecretEnc), code)) {
    return { ok: false, error: 'That code did not match. Check the clock on your phone.' };
  }

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    randomBytes(5)
      .toString('hex')
      .toUpperCase()
      .replace(/(.{5})/, '$1-'),
  );
  await db.vendorUser.update({
    where: { id: userId },
    data: {
      totpConfirmedAt: new Date(),
      recoveryCodeHashes: await Promise.all(codes.map((c) => bcrypt.hash(c, 10))),
      mfaFailedAttempts: 0,
      mfaLockedUntil: null,
    },
  });
  return { ok: true, recoveryCodes: codes };
}

/** Whether an emailed code can be offered at all — the address exists, and mail is configured. */
export function emailFactorAvailable(): boolean {
  return canSendEmail();
}

/**
 * Send a sign-in code to the address on the account.
 *
 * The address is never taken from the request. Letting a form choose where a code goes turns a
 * second factor into a way of mailing yourself somebody else's.
 */
export async function sendEmailCode(userId: string): Promise<VerifyResult> {
  const user = await db.vendorUser.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: 'Sign in again.' };
  if (!canSendEmail()) return { ok: false, error: 'This server cannot send email.' };

  const wait = resendWaitSeconds(user);
  if (wait > 0) return { ok: false, error: `Wait ${wait} more seconds before asking for another.` };

  // randomInt, not Math.random: this is a credential for the next ten minutes.
  const code = String(randomInt(0, 10 ** EMAIL_OTP_DIGITS)).padStart(EMAIL_OTP_DIGITS, '0');
  const now = new Date();
  await db.vendorUser.update({
    where: { id: userId },
    data: {
      emailOtpHash: await bcrypt.hash(code, 10),
      emailOtpExpiresAt: emailOtpExpiry(now),
      emailOtpSentAt: now,
    },
  });

  const sent = await sendMail(
    user.email,
    'Your Klasio Licensing sign-in code',
    `Your sign-in code is ${code}. It works for the next 10 minutes.\n\n` +
      'If you did not just try to sign in, somebody else knows your password — change it.',
  );
  return sent.ok ? { ok: true } : { ok: false, error: sent.detail };
}

/**
 * Check a second factor and, on success, clear everything that was counting against the account.
 *
 * One entry point for all three kinds because they share the thing that matters: a wrong answer
 * has to cost something, whichever kind it was. Splitting them was how one path ended up free to
 * retry in every codebase that has done it.
 */
export async function verifySecondFactor(
  userId: string,
  factor: MfaFactor,
  code: string,
): Promise<VerifyResult> {
  const user = await db.vendorUser.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: 'Sign in again.' };

  if (isLockedOut(user)) {
    const minutes = Math.ceil(lockoutRemainingSeconds(user) / 60);
    return { ok: false, error: `Too many wrong codes. Try again in ${minutes} minutes.` };
  }

  const passed = await checkFactor(user, factor, code.trim());

  if (!passed) {
    const { attempts, lockedUntil } = registerFailure(user);
    await db.vendorUser.update({
      where: { id: userId },
      data: { mfaFailedAttempts: attempts, mfaLockedUntil: lockedUntil },
    });
    if (lockedUntil) {
      return { ok: false, error: 'Too many wrong codes. This account is locked for 15 minutes.' };
    }
    const left = MFA_MAX_ATTEMPTS - attempts;
    return { ok: false, error: `That code did not match. ${left} attempts left.` };
  }

  await db.vendorUser.update({
    where: { id: userId },
    data: {
      mfaFailedAttempts: 0,
      mfaLockedUntil: null,
      // A used email code is spent whether or not it was the factor that succeeded.
      emailOtpHash: null,
      emailOtpExpiresAt: null,
      lastLoginAt: new Date(),
    },
  });
  return { ok: true };
}

async function checkFactor(
  user: {
    id: string;
    totpSecretEnc: string | null;
    totpConfirmedAt: Date | null;
    emailOtpHash: string | null;
    emailOtpExpiresAt: Date | null;
    recoveryCodeHashes: string[];
  },
  factor: MfaFactor,
  code: string,
): Promise<boolean> {
  if (factor === 'totp') {
    // Unconfirmed means nobody has proved they hold the secret, so it cannot authorise anything.
    if (!user.totpSecretEnc || !user.totpConfirmedAt) return false;
    return verifyTotp(decryptSecret(user.totpSecretEnc), code);
  }

  if (factor === 'email') {
    if (!user.emailOtpHash || !emailOtpUsable(user)) return false;
    return bcrypt.compare(code, user.emailOtpHash);
  }

  // Recovery: single use. The matched code is removed in the same statement that accepts it, so a
  // code cannot be spent twice by two requests arriving together.
  const normalised = code.toUpperCase();
  for (const hash of user.recoveryCodeHashes) {
    if (await bcrypt.compare(normalised, hash)) {
      await db.vendorUser.update({
        where: { id: user.id },
        data: { recoveryCodeHashes: user.recoveryCodeHashes.filter((h) => h !== hash) },
      });
      return true;
    }
  }
  return false;
}
