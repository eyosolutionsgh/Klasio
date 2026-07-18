import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  canGrant,
  isPermission,
  PERMISSIONS,
  permissionsForOwner,
  ROLE_PRESETS,
  sanitizePermissions,
} from './permissions';

const preset = (key: string) => ROLE_PRESETS.find((r) => r.key === key)!;

describe('the permission registry', () => {
  it('has no duplicate codes', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('gives every permission a human label and a group', () => {
    for (const p of PERMISSIONS) {
      expect(p.label.length).toBeGreaterThan(3);
      expect(p.group).toBeTruthy();
    }
  });

  it('recognises its own codes and nothing else', () => {
    expect(isPermission('fees.record_payment')).toBe(true);
    expect(isPermission('fees.do_anything')).toBe(false);
  });

  it('drops codes the code no longer defines', () => {
    // A stored role can outlive a renamed permission; it must not resurrect one.
    expect(sanitizePermissions(['fees.view', 'fees.retired', 'fees.view'])).toEqual(['fees.view']);
  });
});

describe('preset roles', () => {
  it('only reference real permissions', () => {
    for (const role of ROLE_PRESETS) {
      const unknown = role.permissions.filter((p) => !isPermission(p));
      expect(unknown, `${role.key} references unknown permissions`).toEqual([]);
    }
  });

  it('list each permission once', () => {
    // sanitizePermissions dedupes at the storage boundary, which is right — a stored role that
    // accumulated a duplicate should not break. But that tolerance hid two duplicates in the
    // presets themselves, and a preset is code. Assert it here instead of relying on the
    // runtime to paper over it.
    for (const role of ROLE_PRESETS) {
      const seen = new Set(role.permissions);
      expect(seen.size, `${role.key} lists a permission twice`).toBe(role.permissions.length);
    }
  });

  it('give the owner everything', () => {
    expect(permissionsForOwner().sort()).toEqual([...ALL_PERMISSIONS].sort());
  });
});

describe('separation of duties', () => {
  it('lets an accounts clerk take money but not decide what is owed', () => {
    const clerk = preset('ACCOUNTS_CLERK').permissions;
    expect(clerk).toContain('fees.record_payment');
    expect(clerk).not.toContain('fees.structure');
    expect(clerk).not.toContain('fees.concessions');
  });

  it('does not let the person who records payments also confirm what settled', () => {
    // One person doing both can record a payment that never arrived and reconcile away the gap.
    const clerk = preset('ACCOUNTS_CLERK').permissions;
    expect(clerk).not.toContain('fees.reconcile');
  });

  it('lets the head see the money without handling it', () => {
    const head = preset('HEAD').permissions;
    expect(head).toContain('fees.view');
    expect(head).not.toContain('fees.record_payment');
    expect(head).not.toContain('fees.structure');
    expect(head).not.toContain('fees.concessions');
  });

  it('keeps a head of department out of finance entirely', () => {
    // The case that prompted this: a subject head is not the person to record finance.
    const hod = preset('HEAD_OF_DEPARTMENT').permissions;
    expect(hod.filter((p) => p.startsWith('fees.'))).toEqual([]);
    expect(hod).toContain('marks.enter');
  });

  it('keeps a bursar out of academics', () => {
    const bursar = preset('BURSAR').permissions;
    expect(bursar).not.toContain('marks.enter');
    expect(bursar).not.toContain('reports.publish');
    expect(bursar).toContain('fees.record_payment');
  });

  it('reserves the head-teacher remark to the head, not the class teacher', () => {
    expect(preset('CLASS_TEACHER').permissions).toContain('reports.remark.teacher');
    expect(preset('CLASS_TEACHER').permissions).not.toContain('reports.remark.head');
    expect(preset('HEAD').permissions).toContain('reports.remark.head');
  });

  it('lets only the head and exams officer publish results', () => {
    const canPublish = ROLE_PRESETS.filter((r) => r.permissions.includes('reports.publish')).map(
      (r) => r.key,
    );
    expect(canPublish.sort()).toEqual(['EXAMS_OFFICER', 'HEAD']);
  });

  it('gives the IT administrator no access to children or money', () => {
    // An account administrator does not need student records to do their job.
    const it = preset('IT_ADMIN').permissions;
    expect(it.filter((p) => p.startsWith('students.') || p.startsWith('fees.'))).toEqual([]);
    expect(it).toContain('users.manage');
  });

  it('gives only the proprietor and IT admin the power to hand out access', () => {
    const canManageUsers = ROLE_PRESETS.filter((r) => r.permissions.includes('users.manage')).map(
      (r) => r.key,
    );
    expect(canManageUsers).toEqual(['IT_ADMIN']);
    // The head can see staff but not create them.
    expect(preset('HEAD').permissions).toContain('users.view');
    expect(preset('HEAD').permissions).not.toContain('users.manage');
  });

  it('gives a nurse medical access without the rest of the record', () => {
    const nurse = preset('SCHOOL_NURSE').permissions;
    expect(nurse).toContain('students.medical');
    expect(nurse).not.toContain('students.edit');
    expect(nurse).not.toContain('marks.view');
  });
});

describe('canGrant', () => {
  it('allows granting what you hold', () => {
    expect(canGrant(['fees.view', 'users.manage'], ['fees.view'])).toEqual([]);
  });

  it('refuses to let someone hand out what they do not hold themselves', () => {
    // Otherwise anyone with users.manage could mint a role with fees.record_payment, assign it
    // to themselves, and every other separation here becomes decorative.
    expect(canGrant(['users.manage', 'users.view'], ['fees.record_payment', 'users.view'])).toEqual(
      ['fees.record_payment'],
    );
  });

  it('lets an owner grant anything', () => {
    expect(canGrant(permissionsForOwner(), ALL_PERMISSIONS)).toEqual([]);
  });
});
