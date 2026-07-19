/**
 * How many wrong passwords an address may produce before it is shut for a while.
 *
 * Sign-in was the one credential check in the product with no limit at all: guardian OTPs count
 * attempts and expire, student PINs lock the pupil out, but a staff password — the credential
 * that reaches fees, reports and every child's address — could be guessed as fast as the network
 * allowed. Five tries per quarter of an hour puts a ceiling of a few hundred guesses a day on an
 * attacker while barely inconveniencing a bursar who has forgotten which of two passwords it was.
 */
export const LOGIN_MAX_FAILURES = 5;

/** Failures stop accumulating once this much time has passed since the window opened. */
export const LOGIN_WINDOW_MINUTES = 15;

/** How long the address stays shut once the ceiling is hit. */
export const LOGIN_LOCK_MINUTES = 15;

export interface ThrottleState {
  failedCount: number;
  firstFailedAt: Date;
  lockedUntil: Date | null;
}

/**
 * Milliseconds left on the lock, or 0 if the address is free to try.
 *
 * Callers must consult this *before* verifying the password: the whole point is to avoid doing
 * the expensive bcrypt comparison on behalf of somebody working through a word list.
 */
export function lockRemainingMs(state: ThrottleState | null, now: Date): number {
  if (!state?.lockedUntil) return 0;
  return Math.max(0, state.lockedUntil.getTime() - now.getTime());
}

/** The lock expressed the way a person waiting on it would say it. Always at least a minute. */
export function lockWaitMinutes(remainingMs: number): number {
  return Math.max(1, Math.ceil(remainingMs / 60_000));
}

/**
 * The state to store after one more failed attempt.
 *
 * A window that has run out starts over rather than carrying old failures forward, so the two
 * typos a teacher makes in September do not combine with three in November to lock them out. A
 * lock that has just expired is also past its window by construction — the lock is never shorter
 * than the window — so the count resets and the caller gets a clean five attempts rather than
 * being re-locked by their first mistake.
 */
export function nextFailure(state: ThrottleState | null, now: Date): ThrottleState {
  const windowOpen =
    state !== null && now.getTime() - state.firstFailedAt.getTime() < LOGIN_WINDOW_MINUTES * 60_000;

  const failedCount = windowOpen ? state!.failedCount + 1 : 1;
  const firstFailedAt = windowOpen ? state!.firstFailedAt : now;
  const lockedUntil =
    failedCount >= LOGIN_MAX_FAILURES
      ? new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60_000)
      : null;

  return { failedCount, firstFailedAt, lockedUntil };
}
