import { describe, expect, it } from 'vitest';
import { isStaleReplay, parseRecordedAt } from './replay';

const at = (hhmm: string) => new Date(`2026-07-19T${hhmm}:00.000Z`);

describe('isStaleReplay', () => {
  it('refuses a replay older than the correction it would undo', () => {
    // The scenario this exists for: teacher marks offline at 09:00, office corrects at 10:00,
    // the device reconnects at 11:00. The correction must stand.
    expect(isStaleReplay(at('09:00'), at('10:00'))).toBe(true);
  });

  it('applies a replay newer than what the server holds', () => {
    expect(isStaleReplay(at('11:00'), at('10:00'))).toBe(false);
  });

  it('applies a write when nothing is stored yet', () => {
    expect(isStaleReplay(at('09:00'), null)).toBe(false);
    expect(isStaleReplay(at('09:00'), undefined)).toBe(false);
  });

  it('applies a write that carries no timestamp', () => {
    // An online write is happening now; a client too old to stamp must keep working rather than
    // being silently dropped.
    expect(isStaleReplay(null, at('10:00'))).toBe(false);
    expect(isStaleReplay(undefined, at('10:00'))).toBe(false);
  });

  it('treats the same instant as applicable, not stale', () => {
    // Replaying the identical write is harmless, and a re-sync must not turn on millisecond luck.
    expect(isStaleReplay(at('10:00'), at('10:00'))).toBe(false);
  });

  it('lets the later of two offline devices win', () => {
    // Device A marked at 08:00 and synced; device B marked at 09:00 and syncs after. B is newer.
    expect(isStaleReplay(at('09:00'), at('08:00'))).toBe(false);
    // And the reverse: A syncing late must not overwrite B.
    expect(isStaleReplay(at('08:00'), at('09:00'))).toBe(true);
  });
});

describe('parseRecordedAt', () => {
  it('reads an ISO timestamp', () => {
    expect(parseRecordedAt('2026-07-19T09:00:00.000Z')?.toISOString()).toBe(
      '2026-07-19T09:00:00.000Z',
    );
  });

  it('returns null for nothing, rather than inventing a time', () => {
    expect(parseRecordedAt(undefined)).toBeNull();
    expect(parseRecordedAt(null)).toBeNull();
    expect(parseRecordedAt('')).toBeNull();
  });

  it('returns null for a value it cannot read', () => {
    // Falling back to "now" would make an unreadable stamp beat every correction on record.
    expect(parseRecordedAt('last Tuesday')).toBeNull();
  });
});
