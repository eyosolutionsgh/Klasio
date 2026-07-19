import { describe, expect, it } from 'vitest';
import {
  LOGIN_LOCK_MINUTES,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MINUTES,
  lockRemainingMs,
  lockWaitMinutes,
  nextFailure,
} from './login-throttle';

const T0 = new Date('2026-07-19T09:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

/** Walk `count` consecutive failures, all at the same instant unless `every` says otherwise. */
function failures(count: number, every = 0) {
  let state = null as ReturnType<typeof nextFailure> | null;
  for (let i = 0; i < count; i++) state = nextFailure(state, at(i * every));
  return state!;
}

describe('login throttle', () => {
  it('does not lock below the ceiling', () => {
    const state = failures(LOGIN_MAX_FAILURES - 1);
    expect(state.failedCount).toBe(LOGIN_MAX_FAILURES - 1);
    expect(state.lockedUntil).toBeNull();
    expect(lockRemainingMs(state, T0)).toBe(0);
  });

  it('locks on the failure that reaches the ceiling', () => {
    const state = failures(LOGIN_MAX_FAILURES);
    expect(state.lockedUntil).toEqual(at(LOGIN_LOCK_MINUTES));
    expect(lockRemainingMs(state, T0)).toBe(LOGIN_LOCK_MINUTES * 60_000);
  });

  it('frees the address once the lock expires', () => {
    const state = failures(LOGIN_MAX_FAILURES);
    expect(lockRemainingMs(state, at(LOGIN_LOCK_MINUTES + 1))).toBe(0);
  });

  it('starts a fresh window rather than carrying stale failures forward', () => {
    // Four failures, then a long quiet spell. The fifth must not be the one that locks.
    const stale = failures(LOGIN_MAX_FAILURES - 1);
    const afterGap = nextFailure(stale, at(LOGIN_WINDOW_MINUTES + 1));
    expect(afterGap.failedCount).toBe(1);
    expect(afterGap.lockedUntil).toBeNull();
  });

  it('gives a full set of attempts again after a lock expires, not an instant re-lock', () => {
    const locked = failures(LOGIN_MAX_FAILURES);
    const afterLock = nextFailure(locked, at(LOGIN_LOCK_MINUTES + 1));
    expect(afterLock.failedCount).toBe(1);
    expect(afterLock.lockedUntil).toBeNull();
  });

  it('still locks when attempts are spread across the window', () => {
    // Five tries at three-minute intervals is 12 minutes — inside the window, so it locks.
    const state = failures(LOGIN_MAX_FAILURES, 3);
    expect(state.failedCount).toBe(LOGIN_MAX_FAILURES);
    expect(state.lockedUntil).not.toBeNull();
  });

  it('never tells someone to wait zero minutes', () => {
    expect(lockWaitMinutes(1)).toBe(1);
    expect(lockWaitMinutes(60_000)).toBe(1);
    expect(lockWaitMinutes(61_000)).toBe(2);
  });

  it('treats an address with no history as free', () => {
    expect(lockRemainingMs(null, T0)).toBe(0);
    expect(nextFailure(null, T0).failedCount).toBe(1);
  });
});
