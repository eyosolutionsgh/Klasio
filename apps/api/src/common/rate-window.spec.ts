import { describe, expect, it } from 'vitest';
import { isOverLimit, pruneWindows, recordHit, RateWindow } from './rate-window';

const WINDOW = 10 * 60_000;
const MAX = 10;

describe('recordHit', () => {
  it('opens a window on the first request', () => {
    expect(recordHit(null, 1_000, WINDOW)).toEqual({ hits: 1, startedAt: 1_000 });
  });

  it('counts up inside the window without moving its start', () => {
    const first = recordHit(null, 1_000, WINDOW);
    const second = recordHit(first, 5_000, WINDOW);
    expect(second).toEqual({ hits: 2, startedAt: 1_000 });
  });

  it('starts a fresh window once the old one has run out', () => {
    const first: RateWindow = { hits: 99, startedAt: 1_000 };
    expect(recordHit(first, 1_000 + WINDOW, WINDOW)).toEqual({
      hits: 1,
      startedAt: 1_000 + WINDOW,
    });
  });
});

describe('isOverLimit', () => {
  it('is false for a caller that has never been seen', () => {
    expect(isOverLimit(null, 1_000, WINDOW, MAX)).toBe(false);
  });

  it('allows exactly max disclosures in a window', () => {
    expect(isOverLimit({ hits: MAX, startedAt: 1_000 }, 2_000, WINDOW, MAX)).toBe(false);
    expect(isOverLimit({ hits: MAX + 1, startedAt: 1_000 }, 2_000, WINDOW, MAX)).toBe(true);
  });

  it('forgives a spent window once it has elapsed', () => {
    const spent: RateWindow = { hits: 500, startedAt: 1_000 };
    expect(isOverLimit(spent, 1_000 + WINDOW - 1, WINDOW, MAX)).toBe(true);
    expect(isOverLimit(spent, 1_000 + WINDOW, WINDOW, MAX)).toBe(false);
  });

  it('counts the request being served, so a lone caller is never over on its first ask', () => {
    const state = recordHit(null, 1_000, WINDOW);
    expect(isOverLimit(state, 1_000, WINDOW, MAX)).toBe(false);
  });

  it('trips on the request after the allowance is spent', () => {
    let state: RateWindow | null = null;
    for (let i = 0; i < MAX; i++) state = recordHit(state, 1_000, WINDOW);
    expect(isOverLimit(state, 1_000, WINDOW, MAX)).toBe(false);

    state = recordHit(state, 1_000, WINDOW);
    expect(isOverLimit(state, 1_000, WINDOW, MAX)).toBe(true);
  });
});

describe('pruneWindows', () => {
  it('drops elapsed windows and keeps live ones', () => {
    const windows = new Map<string, RateWindow>([
      ['live', { hits: 3, startedAt: 1_000 }],
      ['stale', { hits: 3, startedAt: 0 }],
    ]);
    pruneWindows(windows, WINDOW, WINDOW);
    expect([...windows.keys()]).toEqual(['live']);
  });

  it('leaves an empty map alone', () => {
    const windows = new Map<string, RateWindow>();
    pruneWindows(windows, 1_000, WINDOW);
    expect(windows.size).toBe(0);
  });
});
