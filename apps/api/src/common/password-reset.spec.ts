import { describe, expect, it } from 'vitest';
import { RESET_TTL_MINUTES, hashResetToken, resetState, resetStateMessage } from './password-reset';

const NOW = new Date('2026-07-19T12:00:00Z');
const later = (mins: number) => new Date(NOW.getTime() + mins * 60_000);

const row = (over: Partial<Parameters<typeof resetState>[0]> = {}) => ({
  expiresAt: later(10),
  consumedAt: null,
  supersededAt: null,
  ...over,
});

describe('hashResetToken', () => {
  it('is deterministic, so a token can be looked up by its hash', () => {
    expect(hashResetToken('abc')).toBe(hashResetToken('abc'));
  });

  it('produces a different hash for a different token', () => {
    expect(hashResetToken('abc')).not.toBe(hashResetToken('abd'));
  });

  it('never returns the token itself', () => {
    expect(hashResetToken('abc')).not.toContain('abc');
  });
});

describe('resetState', () => {
  it('accepts a fresh, unused link', () => {
    expect(resetState(row(), NOW)).toBe('valid');
  });

  it('rejects a link past its expiry', () => {
    expect(resetState(row({ expiresAt: later(-1) }), NOW)).toBe('expired');
  });

  /**
   * The boundary is the one an off-by-one gets wrong, and getting it wrong the other way keeps a
   * link alive past the window the email promised.
   */
  it('treats the exact expiry instant as expired', () => {
    expect(resetState(row({ expiresAt: NOW }), NOW)).toBe('expired');
  });

  it('accepts a link one millisecond before expiry', () => {
    expect(resetState(row({ expiresAt: new Date(NOW.getTime() + 1) }), NOW)).toBe('valid');
  });

  it('rejects a link that has already been redeemed', () => {
    expect(resetState(row({ consumedAt: later(-5) }), NOW)).toBe('consumed');
  });

  it('rejects a link a newer request replaced', () => {
    expect(resetState(row({ supersededAt: later(-5) }), NOW)).toBe('superseded');
  });

  /**
   * A consumed link that has also expired reports being used, not being old — the two send the
   * person to different places, and "expired" would loop someone who has already reset.
   */
  it('reports consumption ahead of expiry when both are true', () => {
    expect(resetState(row({ consumedAt: later(-5), expiresAt: later(-1) }), NOW)).toBe('consumed');
  });

  it('reports consumption ahead of supersession when both are true', () => {
    expect(resetState(row({ consumedAt: later(-5), supersededAt: later(-2) }), NOW)).toBe(
      'consumed',
    );
  });
});

describe('resetStateMessage', () => {
  it('quotes the real window rather than a hardcoded number', () => {
    expect(resetStateMessage('expired')).toContain(String(RESET_TTL_MINUTES));
  });

  it('points a superseded link at the most recent email', () => {
    expect(resetStateMessage('superseded')).toContain('most recent');
  });

  it('never reveals whether the address has an account', () => {
    for (const state of ['consumed', 'superseded', 'expired'] as const) {
      expect(resetStateMessage(state).toLowerCase()).not.toContain('no such');
      expect(resetStateMessage(state).toLowerCase()).not.toContain('not found');
    }
  });
});
