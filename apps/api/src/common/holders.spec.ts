import { describe, expect, it } from 'vitest';
import { holdersOf } from './holders';
import { can } from './effective-permissions';

/**
 * `holdersOf` is a Prisma where-clause, so what can be unit-tested is its *shape* — that it asks
 * the same three questions, in the same order, as `effectivePermissions`. The behaviour itself is
 * proved against a live database in the integration suite; this guards the drift.
 */
describe('holdersOf', () => {
  const clause = holdersOf('marks.enter');

  it('includes the proprietor unconditionally', () => {
    // Not subject to the revocation filter: a stray revoked row must never drop the one account
    // that holds everything out of a roster. `can()` agrees.
    expect(clause.OR?.[0]).toEqual({ role: 'OWNER' });
    expect(can({ role: 'OWNER', revokedPermissions: ['marks.enter'] }, 'marks.enter')).toBe(true);
  });

  it('accepts the permission from a staff role or a personal grant', () => {
    expect(JSON.stringify(clause)).toContain('staffRole');
    expect(JSON.stringify(clause)).toContain('extraPermissions');
  });

  it('lets a personal revocation win, as it does everywhere else', () => {
    expect(JSON.stringify(clause)).toContain('revokedPermissions');
    expect(
      can(
        { role: 'STAFF', rolePermissions: ['marks.enter'], revokedPermissions: ['marks.enter'] },
        'marks.enter',
      ),
    ).toBe(false);
  });
});
