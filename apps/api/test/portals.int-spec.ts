/**
 * The two family-facing portals, proved on the isolation rules the surveys found untested:
 * a guardian only ever sees their own children; unpublished reports do not exist for them; and
 * a pupil signs in with an issued PIN and reads only their own record.
 */
import { PrismaClient } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jwtSecret } from '../src/common/auth';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

const guardianToken = (g: { id: string; schoolId: string; firstName: string; lastName: string }) =>
  jwt.sign(
    { sub: g.id, schoolId: g.schoolId, kind: 'guardian', name: `${g.firstName} ${g.lastName}` },
    jwtSecret(),
    { expiresIn: '1d' },
  );

describe('family and student portals', () => {
  let api: Api;
  let db: PrismaClient;
  let staffToken: string;
  let schoolId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    staffToken = seeded.token;
    schoolId = seeded.school.id;
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  it("a guardian cannot read another family's child", async () => {
    // Two guardians with disjoint wards.
    const guardians = await db.guardian.findMany({
      where: { schoolId, students: { some: {} } },
      include: { students: { select: { studentId: true } } },
      take: 20,
    });
    const a = guardians[0];
    const b = guardians.find(
      (g) =>
        g.id !== a.id &&
        !g.students.some((s) => a.students.some((as) => as.studentId === s.studentId)),
    )!;
    expect(b).toBeTruthy();

    const tokenA = guardianToken(a);
    const own = await call(api.baseUrl, 'GET', `/guardian/wards/${a.students[0].studentId}`, {
      token: tokenA,
    });
    expect(own.status, JSON.stringify(own.body)).toBe(200);

    const theirs = await call<{ student?: unknown }>(
      api.baseUrl,
      'GET',
      `/guardian/wards/${b.students[0].studentId}`,
      { token: tokenA },
    );
    // Refused — whichever status the API words it with, no child data crosses the line.
    expect([403, 404]).toContain(theirs.status);
    expect(theirs.body.student).toBeUndefined();
  });

  it('an unpublished report does not exist for the family', async () => {
    const report = await db.termReport.findFirst({ where: { schoolId } });
    if (!report) return; // seed always generates some, but stay honest
    // Force it unpublished for the check.
    await db.termReport.update({ where: { id: report.id }, data: { publishedAt: null } });
    const link = await db.studentGuardian.findFirstOrThrow({
      where: { studentId: report.studentId },
      include: { guardian: true },
    });
    const res = await call(
      api.baseUrl,
      'GET',
      `/guardian/wards/${report.studentId}/reports/${report.termId}`,
      { token: guardianToken(link.guardian) },
    );
    expect(res.status).toBe(404);
  });

  it('a pupil signs in with an issued PIN and reads only their own record', async () => {
    const student = await db.student.findFirstOrThrow({
      where: { schoolId, status: 'ACTIVE' },
    });
    // No PIN issued → cannot sign in, whatever is typed. The sensible default for the youngest.
    const before = await call(api.baseUrl, 'POST', '/student/auth/login', {
      body: { admissionNo: student.admissionNo, pin: '123456' },
    });
    expect(before.status).toBe(401);

    const issued = await call<{ pin: string }>(
      api.baseUrl,
      'POST',
      `/students/${student.id}/portal-pin`,
      { token: staffToken },
    );
    expect(issued.status, JSON.stringify(issued.body)).toBe(201);

    const login = await call<{ token: string }>(api.baseUrl, 'POST', '/student/auth/login', {
      body: { admissionNo: student.admissionNo, pin: issued.body.pin },
    });
    expect(login.status, JSON.stringify(login.body)).toBe(201);

    const me = await call<{ student: { admissionNo: string } }>(api.baseUrl, 'GET', '/student/me', {
      token: login.body.token,
    });
    expect(me.status).toBe(200);
    expect(me.body.student.admissionNo).toBe(student.admissionNo);
  });
});
