import { describe, expect, it } from 'vitest';
import {
  emailOtpExpiry,
  emailOtpUsable,
  isEnrolled,
  isLockedOut,
  lockoutRemainingSeconds,
  MFA_LOCKOUT_SECONDS,
  MFA_MAX_ATTEMPTS,
  registerFailure,
  resendWaitSeconds,
} from './mfa-policy';

const NOW = new Date('2026-07-20T09:00:00.000Z');
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

describe('being enrolled', () => {
  /**
   * A secret that exists is not enrolment. Between generating one and typing a code from it, a
   * person has proved nothing — and accepting that state at sign-in would let somebody who never
   * finished setup through on a factor nobody holds.
   */
  it('means a code was accepted, not that a secret exists', () => {
    expect(isEnrolled({ totpConfirmedAt: null })).toBe(false);
    expect(isEnrolled({ totpConfirmedAt: NOW })).toBe(true);
  });
});

describe('lockout', () => {
  it('holds until the moment it expires, and not after', () => {
    const locked = { mfaLockedUntil: at(60) };
    expect(isLockedOut(locked, NOW)).toBe(true);
    expect(isLockedOut(locked, at(59))).toBe(true);
    expect(isLockedOut(locked, at(60))).toBe(false);
    expect(isLockedOut({ mfaLockedUntil: null }, NOW)).toBe(false);
  });

  it('counts down in whole seconds, and never below zero', () => {
    expect(lockoutRemainingSeconds({ mfaLockedUntil: at(90) }, NOW)).toBe(90);
    expect(lockoutRemainingSeconds({ mfaLockedUntil: at(-5) }, NOW)).toBe(0);
    expect(lockoutRemainingSeconds({ mfaLockedUntil: null }, NOW)).toBe(0);
  });

  it('locks on the nth wrong code and not before', () => {
    for (let attempts = 0; attempts < MFA_MAX_ATTEMPTS - 1; attempts++) {
      expect(registerFailure({ mfaFailedAttempts: attempts }, NOW).lockedUntil).toBeNull();
    }
    const final = registerFailure({ mfaFailedAttempts: MFA_MAX_ATTEMPTS - 1 }, NOW);
    expect(final.attempts).toBe(MFA_MAX_ATTEMPTS);
    expect(final.lockedUntil).toEqual(at(MFA_LOCKOUT_SECONDS));
  });

  /**
   * The counter keeps climbing past the threshold. An account being hammered must not quietly
   * reset itself to "one more free guess" every time the window rolls over.
   */
  it('keeps extending the lock while attempts continue', () => {
    const beyond = registerFailure({ mfaFailedAttempts: MFA_MAX_ATTEMPTS + 3 }, NOW);
    expect(beyond.attempts).toBe(MFA_MAX_ATTEMPTS + 4);
    expect(beyond.lockedUntil).toEqual(at(MFA_LOCKOUT_SECONDS));
  });
});

describe('emailed codes', () => {
  it('is usable up to and including its final second', () => {
    const expires = emailOtpExpiry(NOW);
    expect(emailOtpUsable({ emailOtpExpiresAt: expires }, NOW)).toBe(true);
    expect(emailOtpUsable({ emailOtpExpiresAt: expires }, expires)).toBe(true);
    expect(emailOtpUsable({ emailOtpExpiresAt: expires }, at(601))).toBe(false);
  });

  it('is unusable when there is none', () => {
    expect(emailOtpUsable({ emailOtpExpiresAt: null }, NOW)).toBe(false);
  });

  /** The resend button must not become a way to post mail at somebody. */
  it('makes the next send wait out the cooldown', () => {
    expect(resendWaitSeconds({ emailOtpSentAt: NOW }, NOW)).toBe(60);
    expect(resendWaitSeconds({ emailOtpSentAt: NOW }, at(30))).toBe(30);
    expect(resendWaitSeconds({ emailOtpSentAt: NOW }, at(60))).toBe(0);
    expect(resendWaitSeconds({ emailOtpSentAt: NOW }, at(999))).toBe(0);
    // Nothing sent yet is not a cooldown.
    expect(resendWaitSeconds({ emailOtpSentAt: null }, NOW)).toBe(0);
  });
});
