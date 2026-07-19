import { describe, expect, it } from 'vitest';
import { assessClient } from './health';

const NOW = new Date('2026-07-20T12:00:00.000Z');
const daysFromNow = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const licence = (
  over: Partial<{
    tier: 'BASIC' | 'MEDIUM' | 'ADVANCED';
    expiresAt: Date;
    studentCap: number | null;
  }> = {},
) => ({
  tier: 'ADVANCED' as const,
  expiresAt: daysFromNow(200),
  studentCap: null,
  ...over,
});

const beat = (
  over: Partial<{
    receivedAt: Date;
    verifiedWith: string | null;
    tierInForce: string | null;
    students: number | null;
  }> = {},
) => ({
  receivedAt: daysFromNow(0),
  verifiedWith: 'vendor',
  tierInForce: 'ADVANCED',
  students: 100,
  ...over,
});

describe('how a client is judged', () => {
  it('is quiet when everything is in order', () => {
    const r = assessClient({ licence: licence(), lastBeat: beat(), now: NOW });
    expect(r.health).toBe('OK');
    expect(r.note).toBeNull();
  });

  it('flags a client nothing has been sold to', () => {
    expect(assessClient({ licence: null, lastBeat: null, now: NOW }).health).toBe('UNLICENSED');
  });

  it('warns a month out, and not before', () => {
    expect(
      assessClient({ licence: licence({ expiresAt: daysFromNow(30) }), lastBeat: beat(), now: NOW })
        .health,
    ).toBe('EXPIRING');
    expect(
      assessClient({ licence: licence({ expiresAt: daysFromNow(31) }), lastBeat: beat(), now: NOW })
        .health,
    ).toBe('OK');
  });

  it('notices a server that has gone quiet', () => {
    const r = assessClient({
      licence: licence(),
      lastBeat: beat({ receivedAt: daysFromNow(-4) }),
      now: NOW,
    });
    expect(r.health).toBe('SILENT');
    expect(r.note).toMatch(/4 days/);
  });

  it('does not call a school silent for one missed day', () => {
    expect(
      assessClient({
        licence: licence(),
        lastBeat: beat({ receivedAt: daysFromNow(-1) }),
        now: NOW,
      }).health,
    ).toBe('OK');
  });

  it('says nothing about silence when the school has never reported', () => {
    // Reporting is opt-in on the school's side, so "no reports at all" is a supported state and
    // not the same fact as "reports stopped".
    expect(assessClient({ licence: licence(), lastBeat: null, now: NOW }).health).toBe('OK');
  });

  /**
   * The ranking is the point of this function.
   *
   * A box verifying with the development key can mint itself anything, so what its licence says
   * has stopped being evidence. Reporting that as "expired" would be true and useless — the next
   * step is a phone call, not a renewal.
   */
  it('puts tampering above expiry', () => {
    const r = assessClient({
      licence: licence({ expiresAt: daysFromNow(-90) }),
      lastBeat: beat({ verifiedWith: 'development' }),
      now: NOW,
    });
    expect(r.health).toBe('ATTENTION');
    expect(r.note).toMatch(/development key/);
  });

  it('flags a server with no verification key at all', () => {
    const r = assessClient({
      licence: licence(),
      lastBeat: beat({ verifiedWith: 'none' }),
      now: NOW,
    });
    expect(r.health).toBe('ATTENTION');
  });

  it('flags a roll over the cap that was sold', () => {
    const r = assessClient({
      licence: licence({ studentCap: 150 }),
      lastBeat: beat({ students: 412 }),
      now: NOW,
    });
    expect(r.health).toBe('ATTENTION');
    expect(r.note).toMatch(/412 against a cap of 150/);
  });

  it('does not flag a roll inside an uncapped licence', () => {
    expect(
      assessClient({
        licence: licence({ studentCap: null }),
        lastBeat: beat({ students: 9000 }),
        now: NOW,
      }).health,
    ).toBe('OK');
  });

  /**
   * Expiry above silence: a school that lapsed and went quiet is an expiry, which is the more
   * useful of the two facts and the one with an obvious next step.
   */
  it('reports expiry rather than silence when both are true', () => {
    const r = assessClient({
      licence: licence({ expiresAt: daysFromNow(-10) }),
      lastBeat: beat({ receivedAt: daysFromNow(-30) }),
      now: NOW,
    });
    expect(r.health).toBe('EXPIRED');
    expect(r.note).toMatch(/expired 10 days ago/);
  });
});
