import { describe, it, expect } from 'vitest';
import { reconcileLink, demoteOthers, successorPrimary } from './guardianship';

describe('reconcileLink', () => {
  it('refuses pickup for a BLOCKED guardian even when the caller asked for it', () => {
    expect(reconcileLink({ canPickup: true, custodyFlag: 'BLOCKED' })).toEqual({
      canPickup: false,
      custodyFlag: 'BLOCKED',
    });
  });

  it('leaves RESTRICTED and NONE guardians as the school set them', () => {
    expect(reconcileLink({ canPickup: true, custodyFlag: 'RESTRICTED' }).canPickup).toBe(true);
    expect(reconcileLink({ canPickup: true, custodyFlag: 'NONE' }).canPickup).toBe(true);
    expect(reconcileLink({ canPickup: false, custodyFlag: 'NONE' }).canPickup).toBe(false);
  });
});

describe('demoteOthers', () => {
  it('returns every other primary so exactly one survives', () => {
    const links = [
      { guardianId: 'a', isPrimary: true },
      { guardianId: 'b', isPrimary: false },
      { guardianId: 'c', isPrimary: true },
    ];
    expect(demoteOthers(links, 'b').sort()).toEqual(['a', 'c']);
  });

  it('demotes nobody when the promoted guardian is already the only primary', () => {
    const links = [
      { guardianId: 'a', isPrimary: true },
      { guardianId: 'b', isPrimary: false },
    ];
    expect(demoteOthers(links, 'a')).toEqual([]);
  });
});

describe('successorPrimary', () => {
  const link = (
    guardianId: string,
    isPrimary: boolean,
    custodyFlag: 'NONE' | 'BLOCKED' | 'RESTRICTED' = 'NONE',
  ) => ({ guardianId, isPrimary, custodyFlag }) as const;

  it('promotes the remaining guardian when the primary leaves', () => {
    expect(successorPrimary([link('a', true), link('b', false)], 'a')).toBe('b');
  });

  it('skips a flagged guardian in favour of an unflagged one', () => {
    const links = [link('a', true), link('b', false, 'BLOCKED'), link('c', false)];
    expect(successorPrimary(links, 'a')).toBe('c');
  });

  it('promotes a flagged guardian only when there is nobody else', () => {
    expect(successorPrimary([link('a', true), link('b', false, 'RESTRICTED')], 'a')).toBe('b');
  });

  it('does nothing when a primary already remains', () => {
    expect(successorPrimary([link('a', true), link('b', false)], 'b')).toBeNull();
  });

  it('returns null when the student has no guardians left', () => {
    expect(successorPrimary([link('a', true)], 'a')).toBeNull();
  });
});
