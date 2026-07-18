import { describe, it, expect } from 'vitest';
import {
  assessCollector,
  overrideReasonValid,
  alreadyReleased,
  verdictMessage,
  type Collector,
} from './pickup';

const NOW = new Date('2026-07-20T14:00:00Z');
const guardian = (over: Partial<Collector> = {}): Collector => ({
  kind: 'GUARDIAN',
  custodyFlag: 'NONE',
  authorised: true,
  ...over,
});
const delegate = (over: Partial<Collector> = {}): Collector => ({
  kind: 'DELEGATE',
  authorised: true,
  ...over,
});

describe('assessCollector', () => {
  it('lets an authorised guardian through cleanly', () => {
    expect(assessCollector(guardian(), NOW)).toEqual({ allowed: true, requiresOverride: false });
  });

  it('refuses a BLOCKED guardian outright — no override, no discretion', () => {
    const v = assessCollector(guardian({ custodyFlag: 'BLOCKED' }), NOW);
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reasonCode).toBe('BLOCKED');
  });

  it('refuses a BLOCKED guardian even when they are on the authorised list', () => {
    // The two flags disagree; the block has to win.
    const v = assessCollector(guardian({ custodyFlag: 'BLOCKED', authorised: true }), NOW);
    expect(v.allowed).toBe(false);
  });

  it('allows a RESTRICTED guardian only with an override', () => {
    const v = assessCollector(guardian({ custodyFlag: 'RESTRICTED' }), NOW);
    expect(v).toEqual({ allowed: true, requiresOverride: true, reasonCode: 'RESTRICTED' });
  });

  it('allows an unlisted person only with an override', () => {
    const v = assessCollector(delegate({ authorised: false }), NOW);
    expect(v).toEqual({ allowed: true, requiresOverride: true, reasonCode: 'NOT_AUTHORISED' });
  });

  it('allows an expired delegate only with an override', () => {
    const v = assessCollector(delegate({ expiresAt: new Date('2026-07-19T00:00:00Z') }), NOW);
    expect(v).toEqual({ allowed: true, requiresOverride: true, reasonCode: 'EXPIRED' });
  });

  it('treats a delegate expiring later today as still valid', () => {
    const v = assessCollector(delegate({ expiresAt: new Date('2026-07-20T23:00:00Z') }), NOW);
    expect(v).toEqual({ allowed: true, requiresOverride: false });
  });

  it('never blocks a delegate on custody — delegates carry no custody flag', () => {
    const v = assessCollector(delegate(), NOW);
    expect(v.allowed).toBe(true);
  });
});

describe('verdictMessage', () => {
  it('tells staff to escalate a block rather than just refusing', () => {
    const msg = verdictMessage(assessCollector(guardian({ custodyFlag: 'BLOCKED' }), NOW));
    expect(msg).toMatch(/head/i);
  });

  it('has wording for every override reason', () => {
    for (const c of [
      guardian({ custodyFlag: 'RESTRICTED' }),
      delegate({ authorised: false }),
      delegate({ expiresAt: new Date('2020-01-01') }),
    ]) {
      expect(verdictMessage(assessCollector(c, NOW)).length).toBeGreaterThan(10);
    }
  });
});

describe('overrideReasonValid', () => {
  it('rejects nothing, blanks and token input', () => {
    for (const r of [undefined, null, '', '   ', 'ok', 'yes']) {
      expect(overrideReasonValid(r)).toBe(false);
    }
  });

  it('accepts a real explanation', () => {
    expect(overrideReasonValid('Mother phoned, aunt collecting today')).toBe(true);
  });
});

describe('alreadyReleased', () => {
  it('catches a second release of the same child today', () => {
    expect(alreadyReleased([{ studentId: 'a' }, { studentId: 'b' }], 'a')).toBe(true);
  });

  it('lets a different child through', () => {
    expect(alreadyReleased([{ studentId: 'a' }], 'c')).toBe(false);
  });
});
