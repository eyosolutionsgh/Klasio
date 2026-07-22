import { describe, expect, it } from 'vitest';
import {
  canAdministerStaff,
  canAssignRole,
  canManageUser,
  isStaffRole,
  STAFF_ROLES,
} from './roles';

/**
 * These rules moved from rank to permission. The old suite asserted "owner and head, nobody
 * else", which read as a security property but was really an accident of the enum predating
 * permissions — and it was what made the advertised System Administrator role unable to create a
 * single account. What survives, and is asserted hardest below, is the part that was always the
 * real guard: nobody but a proprietor mints a proprietor.
 */

const owner = { role: 'OWNER', permissions: [] };
const head = { role: 'HEAD', permissions: ['users.manage', 'users.view'] };
/** The system administrator: holds no student, academic or money permission of any kind. */
const sysadmin = {
  role: 'STAFF',
  permissions: ['users.view', 'users.manage', 'users.delegate', 'roles.manage', 'audit.view'],
};
const teacher = { role: 'STAFF', permissions: ['marks.enter', 'attendance.mark'] };
const bursar = { role: 'STAFF', permissions: ['fees.record_payment', 'fees.structure'] };

describe('who may administer staff', () => {
  it('is whoever holds users.manage, whatever their legacy role', () => {
    expect(canAdministerStaff(head)).toBe(true);
    // The case the old rank rule got wrong: a system administrator sits on no leadership role.
    expect(canAdministerStaff(sysadmin)).toBe(true);
  });

  it('always includes the proprietor, who holds it by being the proprietor', () => {
    // OWNER short-circuits before permissions are read anywhere else; it must here too, or the
    // one account that can never be locked out could be locked out of staff administration.
    expect(canAdministerStaff(owner)).toBe(true);
  });

  it('excludes staff who merely do important work', () => {
    expect(canAdministerStaff(teacher)).toBe(false);
    expect(canAdministerStaff(bursar)).toBe(false);
    expect(canAdministerStaff({ role: 'GUARDIAN', permissions: [] })).toBe(false);
  });
});

describe('role assignment cannot escalate privilege', () => {
  it('lets a proprietor grant any staff role, including proprietor', () => {
    for (const r of STAFF_ROLES) expect(canAssignRole(owner, r)).toBe(true);
  });

  it('stops anyone else minting a proprietor, however much they administer', () => {
    // The core guard, and the only rank rule left: an OWNER account cannot afterwards be narrowed
    // by anybody, so minting one is how a head teacher — or an administrator — takes over.
    expect(canAssignRole(head, 'OWNER')).toBe(false);
    expect(canAssignRole(sysadmin, 'OWNER')).toBe(false);
  });

  it('lets an administrator staff every other desk', () => {
    for (const r of ['STAFF', 'HEAD', 'BURSAR', 'TEACHER', 'FRONT_DESK'] as const) {
      expect(canAssignRole(sysadmin, r)).toBe(true);
      expect(canAssignRole(head, r)).toBe(true);
    }
  });

  it('stops non-administrators granting anything at all', () => {
    for (const actor of [teacher, bursar]) {
      for (const target of STAFF_ROLES) expect(canAssignRole(actor, target)).toBe(false);
    }
  });

  it('refuses GUARDIAN as a staff role', () => {
    // Guardians are not staff and have no login yet.
    expect(isStaffRole('GUARDIAN')).toBe(false);
    expect(canAssignRole(owner, 'GUARDIAN')).toBe(false);
  });
});

describe('managing existing users', () => {
  it('protects the proprietor from everyone but a proprietor', () => {
    expect(canManageUser(head, 'OWNER')).toBe(false);
    expect(canManageUser(sysadmin, 'OWNER')).toBe(false);
    expect(canManageUser(owner, 'OWNER')).toBe(true);
  });

  it('lets an administrator manage ordinary staff', () => {
    expect(canManageUser(sysadmin, 'STAFF')).toBe(true);
    expect(canManageUser(sysadmin, 'BURSAR')).toBe(true);
    expect(canManageUser(sysadmin, 'HEAD')).toBe(true);
    expect(canManageUser(head, 'FRONT_DESK')).toBe(true);
  });

  it('gives ordinary staff no management rights', () => {
    expect(canManageUser(teacher, 'TEACHER')).toBe(false);
    expect(canManageUser(bursar, 'FRONT_DESK')).toBe(false);
  });
});
