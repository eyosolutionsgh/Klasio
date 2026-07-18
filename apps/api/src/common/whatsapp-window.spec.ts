import { describe, expect, it } from 'vitest';
import { canReply, minutesLeft, windowFromInbound, WINDOW_HOURS } from './whatsapp-window';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-07-18T12:00:00Z');

describe('canReply', () => {
  it('refuses when the family has never written', () => {
    // The whole point: the school cannot open a WhatsApp conversation.
    const r = canReply({ windowExpiresAt: null }, NOW);
    expect(r.allowed).toBe(false);
    expect(r.allowed === false && r.reason).toContain('cannot start');
  });

  it('tells the user to use SMS instead of just failing', () => {
    const r = canReply({ windowExpiresAt: null }, NOW);
    expect(r.allowed === false && r.reason).toMatch(/SMS/);
  });

  it('allows a reply inside the window', () => {
    const r = canReply({ windowExpiresAt: at('2026-07-18T18:00:00Z') }, NOW);
    expect(r.allowed).toBe(true);
  });

  it('refuses once the window has closed', () => {
    const r = canReply({ windowExpiresAt: at('2026-07-18T11:59:59Z') }, NOW);
    expect(r.allowed).toBe(false);
    expect(r.allowed === false && r.reason).toContain('24 hours');
  });

  it('treats the exact expiry instant as closed', () => {
    // Boundary goes to the safe side: a message a millisecond late would be rejected by
    // WhatsApp anyway, and reporting it as sent would be a lie.
    expect(canReply({ windowExpiresAt: NOW }, NOW).allowed).toBe(false);
  });

  it('allows a reply one millisecond before expiry', () => {
    expect(canReply({ windowExpiresAt: new Date(NOW.getTime() + 1) }, NOW).allowed).toBe(true);
  });
});

describe('windowFromInbound', () => {
  it('opens exactly 24 hours from the inbound message', () => {
    expect(windowFromInbound(NOW).toISOString()).toBe('2026-07-19T12:00:00.000Z');
    expect(WINDOW_HOURS).toBe(24);
  });

  it('reopens the full window on a later inbound message', () => {
    // A second message from the parent extends the window; it does not stack on the old one.
    const first = windowFromInbound(at('2026-07-18T09:00:00Z'));
    const second = windowFromInbound(at('2026-07-18T20:00:00Z'));
    expect(second.getTime() - first.getTime()).toBe(11 * 60 * 60 * 1000);
  });
});

describe('minutesLeft', () => {
  it('counts down inside the window', () => {
    expect(minutesLeft({ windowExpiresAt: at('2026-07-18T13:30:00Z') }, NOW)).toBe(90);
  });

  it('is zero when never opened or already closed', () => {
    expect(minutesLeft({ windowExpiresAt: null }, NOW)).toBe(0);
    expect(minutesLeft({ windowExpiresAt: at('2026-07-18T10:00:00Z') }, NOW)).toBe(0);
  });
});
