import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  behindPreset,
  canGrant,
  isDelegate,
  isPermission,
  PERMISSIONS,
  permissionsForOwner,
  ROLE_PRESETS,
  sanitizePermissions,
  ungrantable,
} from './permissions';
import { effectivePermissions } from './effective-permissions';

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

  it('gives the system administrator no access to children or money', () => {
    // An account administrator does not need student records to do their job. This is the promise
    // FEATURES.md makes about the role, so it is asserted rather than intended.
    const admin = preset('IT_ADMIN').permissions;
    expect(
      admin.filter(
        (p) =>
          p.startsWith('students.') ||
          p.startsWith('fees.') ||
          p.startsWith('marks.') ||
          p.startsWith('reports.') ||
          p.startsWith('hr.'),
      ),
    ).toEqual([]);
    expect(admin).toContain('users.manage');
  });

  it('lets the system administrator hand out what it cannot use itself', () => {
    // The two halves of the job, and they must both hold: they can staff the bursar's desk
    // (delegate) without ever being able to touch the ledger (no fees.* above).
    const admin = preset('IT_ADMIN').permissions;
    expect(admin).toContain('users.delegate');
    expect(isDelegate(admin)).toBe(true);
    expect(ungrantable(admin, preset('BURSAR').permissions)).toEqual([]);
  });

  it('gives delegation to nobody else — not even the head', () => {
    const delegates = ROLE_PRESETS.filter((r) => r.permissions.includes('users.delegate')).map(
      (r) => r.key,
    );
    expect(delegates).toEqual(['IT_ADMIN']);
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

describe('behindPreset', () => {
  it('reports what a preset has gained since a school copied it', () => {
    // A school set up before payroll shipped: its Bursar row is frozen at what the preset held
    // then, so the permission exists in code, guards a route, and reaches nobody.
    const asShipped = preset('BURSAR').permissions.filter((p) => p !== 'hr.payroll');
    expect(behindPreset('BURSAR', asShipped)).toEqual(['hr.payroll']);
  });

  it('says nothing about a role that is level with its preset', () => {
    expect(behindPreset('BURSAR', preset('BURSAR').permissions)).toEqual([]);
  });

  it('cannot tell a narrowed role from an outdated one — which is why it only offers', () => {
    // Honest about the limitation: a role narrowed on purpose looks identical to one left behind,
    // because nothing records why a permission is absent. That is exactly why catching up is
    // offered with the codes named rather than applied automatically — the school knows which of
    // the two it is, and the code cannot.
    const narrowed = preset('BURSAR').permissions.filter((p) => p !== 'fees.reverse');
    expect(behindPreset('BURSAR', narrowed)).toEqual(['fees.reverse']);
  });

  it('leaves a role the school invented alone', () => {
    // No presetKey, nothing to be behind.
    expect(behindPreset(null, ['fees.view'])).toEqual([]);
    expect(behindPreset('NOT_A_PRESET', ['fees.view'])).toEqual([]);
  });
});

describe('delegated administration', () => {
  const admin = ['users.view', 'users.manage', 'users.delegate', 'roles.manage'];

  it('lets a delegate hand out everything in the catalogue', () => {
    // Their job is staffing every desk in the school, which means granting the money permissions
    // they are deliberately barred from holding.
    expect(ungrantable(admin, ALL_PERMISSIONS)).toEqual([]);
  });

  it('still refuses everyone else', () => {
    const withoutDelegation = ['users.view', 'users.manage', 'roles.manage'];
    expect(ungrantable(withoutDelegation, ['fees.record_payment'])).toEqual([
      'fees.record_payment',
    ]);
    expect(isDelegate(withoutDelegation)).toBe(false);
  });

  it('does not grant the delegate the access they hand out', () => {
    // The whole safety of the exception: granting is not holding. Nothing about `users.delegate`
    // widens what its holder may do — only what they may give.
    expect(admin).not.toContain('fees.record_payment');
    expect(
      effectivePermissions({ role: 'FRONT_DESK', rolePermissions: admin }).includes(
        'fees.record_payment',
      ),
    ).toBe(false);
  });
});
