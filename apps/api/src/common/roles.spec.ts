import { describe, expect, it } from 'vitest';
import {
  canAdministerStaff,
  canAssignRole,
  canManageUser,
  isStaffRole,
  STAFF_ROLES,
} from './roles';

describe('who may administer staff', () => {
  it('is limited to owner and head', () => {
    expect(canAdministerStaff('OWNER')).toBe(true);
    expect(canAdministerStaff('HEAD')).toBe(true);
    for (const r of ['BURSAR', 'TEACHER', 'FRONT_DESK', 'GUARDIAN'] as const) {
      expect(canAdministerStaff(r)).toBe(false);
    }
  });
});

describe('role assignment cannot escalate privilege', () => {
  it('lets an owner grant any staff role, including owner', () => {
    for (const r of STAFF_ROLES) expect(canAssignRole('OWNER', r)).toBe(true);
  });

  it('stops a head from minting an owner', () => {
    // The core guard: otherwise a head teacher could take over the school.
    expect(canAssignRole('HEAD', 'OWNER')).toBe(false);
    expect(canAssignRole('HEAD', 'HEAD')).toBe(true);
    expect(canAssignRole('HEAD', 'BURSAR')).toBe(true);
    expect(canAssignRole('HEAD', 'TEACHER')).toBe(true);
  });

  it('stops non-administrators granting anything at all', () => {
    for (const actor of ['BURSAR', 'TEACHER', 'FRONT_DESK'] as const) {
      for (const target of STAFF_ROLES) expect(canAssignRole(actor, target)).toBe(false);
    }
  });

  it('refuses GUARDIAN as a staff role', () => {
    // Guardians are not staff and have no login yet.
    expect(isStaffRole('GUARDIAN')).toBe(false);
    expect(canAssignRole('OWNER', 'GUARDIAN')).toBe(false);
  });
});

describe('managing existing users', () => {
  it('never lets someone edit an account above their own rank', () => {
    expect(canManageUser('HEAD', 'OWNER')).toBe(false);
    expect(canManageUser('OWNER', 'HEAD')).toBe(true);
    expect(canManageUser('OWNER', 'OWNER')).toBe(true);
    expect(canManageUser('HEAD', 'HEAD')).toBe(true);
    expect(canManageUser('HEAD', 'FRONT_DESK')).toBe(true);
  });

  it('gives ordinary staff no management rights', () => {
    expect(canManageUser('TEACHER', 'TEACHER')).toBe(false);
    expect(canManageUser('BURSAR', 'FRONT_DESK')).toBe(false);
  });
});
