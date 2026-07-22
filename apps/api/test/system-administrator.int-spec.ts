/**
 * The system administrator: employed to run accounts and access so the proprietor does not have
 * to, and answerable for what they hand out.
 *
 * This role was advertised in FEATURES.md and shipped as a preset, and could not create a single
 * account. Two independent gates refused it before its permissions were ever read — a rank rule
 * that only recognised OWNER and HEAD, and the rule that nobody hands out what they do not hold.
 * Neither was visible to typecheck, lint or the unit suite, because both live in request paths.
 *
 * So the assertions here are the job description, in order:
 *   1. they can staff the bursar's desk — the exact thing the old rules made impossible;
 *   2. they still cannot read a child's record or a cedi, which is the promise the role makes;
 *   3. what they granted beyond their own reach is written down against their name;
 *   4. they cannot mint a proprietor, the one rank rule that survives;
 *   5. resetting somebody's password hands them no way to become that person.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

const PASSWORD = 'Password1!';

describe('the system administrator', () => {
  let api: Api;
  let db: PrismaClient;
  let ownerToken: string;
  let schoolId: string;
  let adminToken: string;
  let adminId: string;
  let bursarRoleId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    ownerToken = seeded.token;
    schoolId = seeded.school.id;

    const adminRole = await db.staffRole.findFirstOrThrow({
      where: { schoolId, presetKey: 'IT_ADMIN' },
    });
    bursarRoleId = (
      await db.staffRole.findFirstOrThrow({ where: { schoolId, presetKey: 'BURSAR' } })
    ).id;

    // Plain staff, which is what every new account now is: the job is the staff role, and the
    // old rank gate refused exactly this account because the enum was not one of its two.
    const email = 'sysadmin@integration.test';
    await db.user.deleteMany({ where: { schoolId, email } });
    const admin = await db.user.create({
      data: {
        schoolId,
        name: 'Sys Admin',
        email,
        role: 'STAFF',
        staffRoleId: adminRole.id,
        // bcrypt hash of Password1!, as the seed uses.
        passwordHash: (
          await db.user.findFirstOrThrow({
            where: { schoolId, email: 'klasio-head@mailinator.com' },
          })
        ).passwordHash,
      },
    });
    adminId = admin.id;

    const signIn = await call<{ token: string }>(api.baseUrl, 'POST', '/auth/login', {
      body: { email, password: PASSWORD },
    });
    expect(signIn.status, JSON.stringify(signIn.body)).toBe(201);
    adminToken = signIn.body.token;
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { schoolId, email: { endsWith: '@integration.test' } } });
    await api.close();
    await db.$disconnect();
  });

  it('staffs the bursar’s desk, holding no fee permission itself', async () => {
    const created = await call<{ id: string }>(api.baseUrl, 'POST', '/users', {
      token: adminToken,
      // No account type is sent — that choice was retired. The job is the staff role.
      body: {
        name: 'New Bursar',
        email: 'new-bursar@integration.test',
        staffRoleId: bursarRoleId,
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    // The account really got the access, not a hollow role.
    const made = await db.user.findFirstOrThrow({
      where: { id: created.body.id },
      include: { staffRole: true },
    });
    expect(made.staffRole?.permissions).toContain('fees.record_payment');
    // Plain staff, whatever job they do — the enum no longer carries a job title.
    expect(made.role).toBe('STAFF');
  });

  it('records what was handed over beyond its own reach', async () => {
    // The accountability the whole exception rests on: over-granting has a name against it.
    const row = await db.auditLog.findFirst({
      where: { schoolId, userId: adminId, action: 'user.create' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).toBeTruthy();
    expect(JSON.stringify(row!.detail)).toContain('fees.record_payment');
  });

  it('cannot read a child’s record or a cedi', async () => {
    // The promise FEATURES.md makes about this role, asserted against the running API rather
    // than inferred from the preset list.
    for (const path of ['/students', '/fees/overview', '/payroll/runs']) {
      const res = await call(api.baseUrl, 'GET', path, { token: adminToken });
      expect([401, 403], `${path} answered ${res.status}`).toContain(res.status);
    }
  });

  it('cannot mint a proprietor', async () => {
    // The one rank rule that survives: an OWNER account cannot afterwards be narrowed by anybody,
    // so minting one is how an administrator would take the school.
    const res = await call(api.baseUrl, 'POST', '/users', {
      token: adminToken,
      body: { name: 'Usurper', email: 'usurper@integration.test', role: 'OWNER' },
    });
    expect(res.status).toBe(403);
  });

  it('cannot narrow the proprietor', async () => {
    const owner = await db.user.findFirstOrThrow({ where: { schoolId, role: 'OWNER' } });
    const res = await call(api.baseUrl, 'POST', `/roles/assign/${owner.id}`, {
      token: adminToken,
      body: { staffRoleId: bursarRoleId },
    });
    expect(res.status).toBe(400);
  });

  it('resets a password without ever holding one', async () => {
    const target = await db.user.findFirstOrThrow({
      where: { schoolId, email: 'new-bursar@integration.test' },
    });
    const before = target.passwordHash;

    const res = await call<{ temporaryPassword?: string; delivered: boolean }>(
      api.baseUrl,
      'POST',
      `/users/${target.id}/reset-password`,
      { token: adminToken, body: {} },
    );
    expect(res.status).toBe(201);

    // Whatever happened to delivery, the old password is dead and the sessions with it.
    const after = await db.user.findFirstOrThrow({ where: { id: target.id } });
    expect(after.passwordHash).not.toBe(before);
    expect(after.tokenVersion).toBe(target.tokenVersion + 1);

    /**
     * Asserted, not branched on. An earlier version of this test accepted either outcome, which
     * made it pass for the wrong reason: the suite had no email provider configured, every reset
     * fell down the "could not deliver" path, and the property being tested — that the
     * administrator is handed nothing — was never exercised at all.
     */
    expect(res.body.delivered, 'the account holder was sent their own reset').toBe(true);
    expect(
      res.body.temporaryPassword,
      'the administrator was handed no credential',
    ).toBeUndefined();

    const reset = await db.passwordReset.findFirst({
      where: { userId: target.id, consumedAt: null, supersededAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(reset, 'a live reset only the account holder can redeem').toBeTruthy();
    expect(reset!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('still refuses an administrator who does not administer access', async () => {
    // Delegation is a permission, not a side effect of being an admin-ish person. A head holds
    // users.view and no more, and must not be able to staff the bursar's desk.
    const head = await db.user.findFirstOrThrow({
      where: { schoolId, email: 'klasio-head@mailinator.com' },
    });
    const signIn = await call<{ token: string }>(api.baseUrl, 'POST', '/auth/login', {
      body: { email: head.email, password: PASSWORD },
    });
    const res = await call(api.baseUrl, 'POST', '/users', {
      token: signIn.body.token,
      body: {
        name: 'Sneaky Bursar',
        email: 'sneaky@integration.test',
        role: 'BURSAR',
        staffRoleId: bursarRoleId,
      },
    });
    expect(res.status).toBe(403);
  });

  it('leaves the proprietor able to do all of it', async () => {
    const res = await call(api.baseUrl, 'GET', '/users', { token: ownerToken });
    expect(res.status).toBe(200);
  });
});
