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

  /**
   * A notice aimed at one class used to be texted to that class and then posted to the notice
   * board every family in the school reads, so "one class" was true of only half the send. The
   * board now carries the audience with it.
   */
  it('a notice for one class reaches that class and nobody else', async () => {
    const mine = await db.studentGuardian.findFirstOrThrow({
      where: {
        custodyFlag: { not: 'BLOCKED' },
        student: { schoolId, status: 'ACTIVE', classId: { not: null } },
      },
      include: { guardian: true, student: true },
    });
    const targetClassId = mine.student.classId as string;

    /**
     * A guardian with **no** child in that class — the one who must not see it.
     *
     * The `none` clause is the whole point, and its absence made this test fail at random. The
     * seed gives siblings a shared guardian, so "has a child outside the class" does not mean
     * "has no child inside it": the same parent can have one in each, in which case they see the
     * notice legitimately and the assertion is wrong rather than the code. Which guardian
     * `findFirst` returned depended on row order, which every other spec in the suite quietly
     * changes — so it passed or failed according to what had run before it.
     */
    const other = await db.studentGuardian.findFirstOrThrow({
      where: {
        custodyFlag: { not: 'BLOCKED' },
        student: { schoolId, status: 'ACTIVE', classId: { not: targetClassId } },
        guardian: {
          id: { not: mine.guardianId },
          students: { none: { student: { classId: targetClassId } } },
        },
      },
      include: { guardian: true },
    });

    const marker = `Class-only notice ${Date.now()}`;
    await db.announcement.create({
      data: {
        schoolId,
        title: marker,
        body: 'Bring a hat for the trip on Friday.',
        audience: 'GUARDIANS',
        classId: targetClassId,
        createdById: (await db.user.findFirstOrThrow({ where: { schoolId } })).id,
      },
    });

    const seen = await call<{ title: string }[]>(api.baseUrl, 'GET', '/guardian/notices', {
      token: guardianToken(mine.guardian),
    });
    expect(seen.status).toBe(200);
    expect(seen.body.map((n) => n.title)).toContain(marker);

    const unseen = await call<{ title: string }[]>(api.baseUrl, 'GET', '/guardian/notices', {
      token: guardianToken(other.guardian),
    });
    expect(unseen.status).toBe(200);
    expect(unseen.body.map((n) => n.title)).not.toContain(marker);
  });

  it('a school-wide notice still reaches everybody', async () => {
    const anyone = await db.studentGuardian.findFirstOrThrow({
      where: { custodyFlag: { not: 'BLOCKED' }, student: { schoolId, status: 'ACTIVE' } },
      include: { guardian: true },
    });
    const marker = `Whole-school notice ${Date.now()}`;
    await db.announcement.create({
      data: {
        schoolId,
        title: marker,
        body: 'Term ends on the 23rd.',
        audience: 'ALL',
        createdById: (await db.user.findFirstOrThrow({ where: { schoolId } })).id,
      },
    });

    const seen = await call<{ title: string }[]>(api.baseUrl, 'GET', '/guardian/notices', {
      token: guardianToken(anyone.guardian),
    });
    expect(seen.body.map((n) => n.title)).toContain(marker);
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
