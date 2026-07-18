import { describe, expect, it } from 'vitest';
import {
  ENTITLEMENTS,
  enrolmentHeadroom,
  entitlementsForTier,
  hasEntitlement,
  studentCapFor,
} from './entitlements';

describe('entitlement engine', () => {
  it('BASIC includes the free core and nothing paid', () => {
    expect(hasEntitlement('BASIC', 'sis.core')).toBe(true);
    expect(hasEntitlement('BASIC', 'reports.terminal')).toBe(true);
    expect(hasEntitlement('BASIC', 'fees.manual')).toBe(true);
    expect(hasEntitlement('BASIC', 'fees.online')).toBe(false);
    expect(hasEntitlement('BASIC', 'safety.pickup')).toBe(false);
    expect(hasEntitlement('BASIC', 'ai.remarks')).toBe(false);
  });

  it('MEDIUM is a strict superset of BASIC', () => {
    const basic = entitlementsForTier('BASIC');
    const medium = entitlementsForTier('MEDIUM');
    for (const e of basic) expect(medium).toContain(e);
    expect(medium).toContain('fees.online');
    expect(medium).toContain('safety.pickup');
    expect(medium).not.toContain('ai.chatbot');
  });

  it('ADVANCED is a strict superset of MEDIUM and unlocks AI', () => {
    const medium = entitlementsForTier('MEDIUM');
    const advanced = entitlementsForTier('ADVANCED');
    for (const e of medium) expect(advanced).toContain(e);
    expect(advanced).toContain('ai.remarks');
    expect(advanced).toContain('comms.whatsapp.chatbot');
  });

  it('caps enrolment per package, unlimited on ADVANCED', () => {
    expect(studentCapFor('BASIC')).toBe(150);
    expect(studentCapFor('MEDIUM')).toBe(1000);
    expect(studentCapFor('ADVANCED')).toBeNull();
  });

  it('computes headroom and never reports negative', () => {
    expect(enrolmentHeadroom('BASIC', 0)).toBe(150);
    expect(enrolmentHeadroom('BASIC', 149)).toBe(1);
    expect(enrolmentHeadroom('BASIC', 150)).toBe(0);
    // Over cap (e.g. after a downgrade) blocks new enrolment but is never negative.
    expect(enrolmentHeadroom('BASIC', 200)).toBe(0);
    expect(enrolmentHeadroom('ADVANCED', 99999)).toBe(Infinity);
  });

  it('tier bundles have no duplicate codes', () => {
    const all = [...ENTITLEMENTS.BASIC, ...ENTITLEMENTS.MEDIUM, ...ENTITLEMENTS.ADVANCED];
    expect(new Set(all).size).toBe(all.length);
  });
});
