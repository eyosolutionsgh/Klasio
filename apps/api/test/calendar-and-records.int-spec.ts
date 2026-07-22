/**
 * The two remaining `$transaction` call sites: switching the current academic term, and setting
 * a student's custom field values.
 *
 * Both are multi-statement writes that ran on the base client and were refused by RLS. The term
 * switch is the worse of the two — it clears every `isCurrent` flag before setting the new one,
 * so a half-applied run leaves a school with no current term at all, and every screen that reads
 * "this term" goes blank.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

describe('academic term switch', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;
  /** What the seed had current before this file moved it — restored in afterAll. */
  let originalCurrentTermId: string | null = null;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;
    originalCurrentTermId =
      (
        await db.term.findFirst({
          where: { academicYear: { schoolId }, isCurrent: true },
          select: { id: true },
        })
      )?.id ?? null;
  });

  afterAll(async () => {
    /**
     * Put the current-term flag back where the seed left it.
     *
     * This file moves it deliberately — that is what it tests — but every other spec asks for
     * "the current term" and expects the one the seed filled with scores, attendance and fees.
     * Leaving the pointer on a different term made unrelated files fail depending on order.
     */
    if (originalCurrentTermId) {
      await db.term.updateMany({
        where: { academicYear: { schoolId } },
        data: { isCurrent: false },
      });
      await db.term.update({ where: { id: originalCurrentTermId }, data: { isCurrent: true } });
      const restored = await db.term.findUniqueOrThrow({
        where: { id: originalCurrentTermId },
        select: { academicYearId: true },
      });
      await db.academicYear.updateMany({ where: { schoolId }, data: { isCurrent: false } });
      await db.academicYear.update({
        where: { id: restored.academicYearId },
        data: { isCurrent: true },
      });
    }
    await api.close();
    await db.$disconnect();
  });

  it('moves the current flag to the chosen term, and to exactly one term', async () => {
    const terms = await db.term.findMany({
      where: { academicYear: { schoolId } },
      include: { academicYear: true },
      orderBy: { startDate: 'asc' },
    });
    const target = terms.find((t) => !t.isCurrent)!;
    expect(target).toBeDefined();

    const res = await call<{ currentTerm: string }>(
      api.baseUrl,
      'POST',
      `/school/terms/${target.id}/current`,
      { token },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.currentTerm).toBe(target.name);

    const after = await db.term.findMany({ where: { academicYear: { schoolId } } });
    const current = after.filter((t) => t.isCurrent);
    // Both halves: the clear AND the set. Either alone leaves the school broken.
    expect(current).toHaveLength(1);
    expect(current[0].id).toBe(target.id);

    const years = await db.academicYear.findMany({ where: { schoolId } });
    expect(years.filter((y) => y.isCurrent)).toHaveLength(1);
    expect(years.find((y) => y.isCurrent)!.id).toBe(target.academicYearId);
  });
});

describe('student custom field values', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;
  let studentId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;
    const student = await db.student.findFirstOrThrow({
      where: { schoolId, status: 'ACTIVE' },
      orderBy: { admissionNo: 'asc' },
    });
    studentId = student.id;
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  it('persists a value, updates it, and clears it', async () => {
    const field = await call<{ id: string }>(api.baseUrl, 'POST', '/records/fields', {
      token,
      body: { label: 'Bus Route', kind: 'TEXT' },
    });
    expect(field.status, JSON.stringify(field.body)).toBe(201);
    const fieldId = field.body.id;

    const set = await call(api.baseUrl, 'PUT', `/records/students/${studentId}/fields`, {
      token,
      body: { values: [{ fieldId, value: 'Route 4 — Achimota' }] },
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);

    const stored = await db.studentFieldValue.findUniqueOrThrow({
      where: { studentId_fieldId: { studentId, fieldId } },
    });
    expect(stored.value).toBe('Route 4 — Achimota');
    expect(stored.schoolId).toBe(schoolId);

    // Upsert path: the same field again, different value.
    await call(api.baseUrl, 'PUT', `/records/students/${studentId}/fields`, {
      token,
      body: { values: [{ fieldId, value: 'Route 7 — Madina' }] },
    });
    expect(
      (
        await db.studentFieldValue.findUniqueOrThrow({
          where: { studentId_fieldId: { studentId, fieldId } },
        })
      ).value,
    ).toBe('Route 7 — Madina');

    // Blank clears the row rather than storing an empty string.
    const cleared = await call(api.baseUrl, 'PUT', `/records/students/${studentId}/fields`, {
      token,
      body: { values: [{ fieldId, value: '' }] },
    });
    expect(cleared.status).toBe(200);
    expect(await db.studentFieldValue.count({ where: { studentId, fieldId } })).toBe(0);
  });
});
