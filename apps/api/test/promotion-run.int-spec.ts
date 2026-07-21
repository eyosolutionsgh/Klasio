/**
 * End of year, one child at a time.
 *
 * Promotion was a whole-class `updateMany`: every active child in the class moved together, or the
 * whole class graduated. Holding one child back meant promoting the class and then editing that
 * child afterwards — a two-step nobody remembers to finish — and "repeated" left no trace at all,
 * because a child held back was simply one whose `classId` did not change.
 *
 * PromotionRecord is a new tenant table, so the last test here is the RLS one: a missing policy
 * fails open and silently.
 */
import { PrismaClient } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jwtSecret } from '../src/common/auth';
import { Api, call, ownerDb, otherSchool, seededSchool, startApi } from './setup/harness';

interface Preview {
  fromClassName: string;
  isFinalClass: boolean;
  suggestedToClassId: string | null;
  classes: { id: string; name: string }[];
  students: { studentId: string; name: string; suggestedAction: string; suggestedToClassId: string | null }[];
}

describe('per-child promotion run', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;
  let classId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;

    // A class that is not the school's last, so PROMOTE has somewhere to go.
    const rows = await db.classRoom.findMany({
      where: { schoolId, students: { some: { status: 'ACTIVE' } } },
      include: { level: { select: { order: true } }, _count: { select: { students: true } } },
    });
    const maxOrder = Math.max(...rows.map((r) => r.level.order));
    classId = rows.find((r) => r.level.order < maxOrder)!.id;
  });

  afterAll(async () => {
    await db.promotionRecord.deleteMany({ where: { schoolId } });
    await api.close();
    await db.$disconnect();
  });

  const preview = () =>
    call<Preview>(api.baseUrl, 'GET', `/students/promotion/preview?classId=${classId}`, { token });

  it('suggests a destination for every child, without deciding for the school', async () => {
    const res = await preview();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.students.length).toBeGreaterThan(0);
    expect(res.body.isFinalClass).toBe(false);
    expect(res.body.suggestedToClassId).toBeTruthy();
    // Every child defaults to moving up — the common case is one click, not forty decisions.
    expect(res.body.students.every((s) => s.suggestedAction === 'PROMOTE')).toBe(true);
    // And the whole ladder is offered, so an exception is a dropdown rather than a dead end.
    expect(res.body.classes.length).toBeGreaterThan(0);
  });

  it('promotes most of the class while holding one child back', async () => {
    const p = (await preview()).body;
    const toClassId = p.suggestedToClassId as string;
    const [held, ...moving] = p.students;

    const res = await call<{ promoted: number; repeated: number; graduated: number }>(
      api.baseUrl,
      'POST',
      '/students/promotion/run',
      {
        token,
        body: {
          fromClassId: classId,
          decisions: [
            { studentId: held.studentId, action: 'REPEAT' },
            ...moving.map((s) => ({ studentId: s.studentId, action: 'PROMOTE', toClassId })),
          ],
        },
      },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.repeated).toBe(1);
    expect(res.body.promoted).toBe(moving.length);

    // The child held back is still exactly where they were…
    const stayed = await db.student.findUniqueOrThrow({ where: { id: held.studentId } });
    expect(stayed.classId).toBe(classId);
    // …and their classmates are not.
    const movedOn = await db.student.findUniqueOrThrow({ where: { id: moving[0].studentId } });
    expect(movedOn.classId).toBe(toClassId);

    // The repeat is a record, not the absence of one. This is what a parent asks about years later.
    const record = await db.promotionRecord.findFirstOrThrow({
      where: { studentId: held.studentId },
    });
    expect(record.action).toBe('REPEATED');
    expect(record.toClassId).toBeNull();
  });

  it('shows the repeated year on the cumulative record', async () => {
    const record = await db.promotionRecord.findFirstOrThrow({
      where: { schoolId, action: 'REPEATED' },
    });
    const res = await call<{ yearsRepeated: number; promotions: { action: string }[] }>(
      api.baseUrl,
      'GET',
      `/assessment/cumulative/${record.studentId}`,
      { token },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.yearsRepeated).toBe(1);
    expect(res.body.promotions.some((p) => p.action === 'REPEATED')).toBe(true);
  });

  it('refuses to graduate anyone without the count being confirmed', async () => {
    const p = (await preview()).body;
    if (p.students.length === 0) return;

    const res = await call<{ message: string }>(api.baseUrl, 'POST', '/students/promotion/run', {
      token,
      body: {
        fromClassId: classId,
        decisions: [{ studentId: p.students[0].studentId, action: 'GRADUATE' }],
      },
    });
    // Irreversible, so stating the number is the consent — a payload alone is not.
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/cannot be undone/i);

    const still = await db.student.findUniqueOrThrow({ where: { id: p.students[0].studentId } });
    expect(still.status).toBe('ACTIVE');
  });

  it('refuses a count that no longer matches the decisions', async () => {
    const p = (await preview()).body;
    const res = await call(api.baseUrl, 'POST', '/students/promotion/run', {
      token,
      body: {
        fromClassId: classId,
        decisions: [{ studentId: p.students[0].studentId, action: 'GRADUATE' }],
        confirmGraduating: 5,
      },
    });
    expect(res.status).toBe(400);
  });

  it('refuses a decision for a child who is not in the class', async () => {
    const outsider = await db.student.findFirstOrThrow({
      where: { schoolId, status: 'ACTIVE', classId: { not: classId } },
    });
    const res = await call(api.baseUrl, 'POST', '/students/promotion/run', {
      token,
      body: {
        fromClassId: classId,
        decisions: [{ studentId: outsider.id, action: 'REPEAT' }],
      },
    });
    expect(res.status).toBe(400);
  });

  /** A missing RLS policy on a new tenant table fails open, and silently. */
  it("cannot see another school's promotion records", async () => {
    const other = await otherSchool(db);
    const otherToken = jwt.sign(
      {
        sub: other.owner.id,
        schoolId: other.school.id,
        role: 'OWNER',
        tier: other.school.tier,
        name: other.owner.name,
      },
      jwtSecret(),
      { expiresIn: '1d' },
    );

    const mine = await db.promotionRecord.findFirstOrThrow({ where: { schoolId } });
    // Asked through a route that reads promotion records, as the other school's principal.
    const res = await call<{ promotions: unknown[] }>(
      api.baseUrl,
      'GET',
      `/assessment/cumulative/${mine.studentId}`,
      { token: otherToken },
    );
    // The child is not theirs, so the whole record is refused rather than partly leaked.
    expect(res.status).toBe(404);
  });
});
