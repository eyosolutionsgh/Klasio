import { describe, expect, it } from 'vitest';
import { can, effectivePermissions } from './effective-permissions';
import { ALL_PERMISSIONS } from './permissions';

const src = (over: Partial<Parameters<typeof effectivePermissions>[0]> = {}) => ({
  role: 'TEACHER',
  rolePermissions: ['marks.view', 'marks.enter'],
  ...over,
});

describe('effectivePermissions', () => {
  it('takes the role as the starting point', () => {
    expect(effectivePermissions(src())).toEqual(['marks.enter', 'marks.view']);
  });

  it('gives the proprietor everything, whatever their role says', () => {
    // A school must always have one account that can reach everything, or a mis-set role locks
    // the owner out with nobody able to undo it.
    const owner = effectivePermissions({
      role: 'OWNER',
      rolePermissions: [],
      revokedPermissions: ALL_PERMISSIONS,
    });
    expect(owner.sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('holds nothing when the person has no role', () => {
    // Deny by default: an account whose role was deleted loses access rather than inheriting.
    expect(effectivePermissions({ role: 'TEACHER', rolePermissions: null })).toEqual([]);
    expect(effectivePermissions({ role: 'TEACHER' })).toEqual([]);
  });

  it('widens with a personal grant', () => {
    // The one teacher who also covers the gate should not need a whole new role.
    const p = effectivePermissions(src({ extraPermissions: ['pickup.release'] }));
    expect(p).toContain('pickup.release');
    expect(p).toContain('marks.enter');
  });

  it('narrows with a personal revocation', () => {
    expect(effectivePermissions(src({ revokedPermissions: ['marks.enter'] }))).toEqual([
      'marks.view',
    ]);
  });

  it('lets a revocation beat the role that grants it', () => {
    // Taking something away has to be decisive, or a head revoking a permission from one person
    // would watch it come straight back because their role also grants it.
    expect(
      effectivePermissions(
        src({
          rolePermissions: ['fees.record_payment'],
          revokedPermissions: ['fees.record_payment'],
        }),
      ),
    ).toEqual([]);
  });

  it('lets a revocation beat a personal grant too', () => {
    expect(
      effectivePermissions(
        src({
          rolePermissions: [],
          extraPermissions: ['fees.record_payment'],
          revokedPermissions: ['fees.record_payment'],
        }),
      ),
    ).toEqual([]);
  });

  it('ignores codes the registry no longer defines', () => {
    // A stored role can outlive a renamed permission; it must not resurrect one.
    expect(
      effectivePermissions(src({ rolePermissions: ['marks.view', 'marks.telepathy'] })),
    ).toEqual(['marks.view']);
  });

  it('does not duplicate a permission granted twice', () => {
    expect(
      effectivePermissions(
        src({ rolePermissions: ['marks.view'], extraPermissions: ['marks.view'] }),
      ),
    ).toEqual(['marks.view']);
  });
});

describe('can', () => {
  it('agrees with the resolved set', () => {
    const s = src({ extraPermissions: ['pickup.release'], revokedPermissions: ['marks.enter'] });
    const resolved = effectivePermissions(s);
    for (const code of ['marks.view', 'marks.enter', 'pickup.release', 'fees.view']) {
      expect(can(s, code), code).toBe(resolved.includes(code));
    }
  });

  it('is true for the proprietor on anything', () => {
    expect(can({ role: 'OWNER', rolePermissions: [] }, 'fees.record_payment')).toBe(true);
  });

  it('is false for a permission nobody granted', () => {
    expect(can(src(), 'fees.record_payment')).toBe(false);
  });
});
