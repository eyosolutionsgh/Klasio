/**
 * Regenerating a published terminal report needs the school to say so.
 *
 * Editing one line of a published report was always refused, while re-running generation for the
 * whole class silently overwrote every mark, grade and position on documents families had already
 * read. The API grew a `regeneratePublished` consent flag for that — but nothing in the web app
 * ever sent it, so the guard was unreachable from the product: a head correcting a genuine marking
 * error could only ever read the refusal.
 *
 * This proves the contract the confirmation dialog now depends on, in both directions: refused
 * without consent, and actually applied with it.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

describe('regenerating published reports', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;
  let termId: string;
  let classId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;

    // The seed scores Term 3, so it is the only term that generates non-empty reports.
    const term = await db.term.findFirstOrThrow({
      where: { academicYear: { schoolId }, isCurrent: true },
    });
    termId = term.id;

    /*
     * A class that actually has scored, active students behind it. Picking the first class by
     * name instead produced an empty KG roll, where generation succeeds with `generated: 0` and
     * every assertion about published reports is vacuously wrong — the test has to stand on a
     * class the seed really marked.
     */
    const scored = await db.score.findFirstOrThrow({
      where: { schoolId, termId, student: { status: 'ACTIVE', classId: { not: null } } },
      select: { student: { select: { classId: true } } },
    });
    classId = scored.student.classId as string;
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  const generate = (body: Record<string, unknown>) =>
    call<{ generated: number; message?: string }>(api.baseUrl, 'POST', '/assessment/reports/generate', {
      token,
      body: { classId, termId, ...body },
    });

  const setPublished = (published: boolean) =>
    call(api.baseUrl, 'POST', '/assessment/reports/publish', {
      token,
      body: { classId, termId, published },
    });

  it('generates freely while nothing has been released', async () => {
    await setPublished(false);
    const res = await generate({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.generated).toBeGreaterThan(0);
  });

  it('refuses to regenerate over published reports without consent', async () => {
    const published = await setPublished(true);
    expect(published.status, JSON.stringify(published.body)).toBe(201);

    const res = await generate({});
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    // The message is what the confirmation dialog paraphrases, so it must name the stakes.
    expect(JSON.stringify(res.body)).toMatch(/already been published/i);

    // Refused means refused: the reports are still the published ones.
    const stillPublished = await db.termReport.count({
      where: { schoolId, termId, classId, publishedAt: { not: null } },
    });
    expect(stillPublished).toBeGreaterThan(0);
  });

  it('regenerates when the school states its consent, and the reports stay published', async () => {
    const before = await db.termReport.findFirstOrThrow({
      where: { schoolId, termId, classId, publishedAt: { not: null } },
      orderBy: { studentId: 'asc' },
    });

    const res = await generate({ regeneratePublished: true });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.generated).toBeGreaterThan(0);

    const after = await db.termReport.findUniqueOrThrow({
      where: { studentId_termId: { studentId: before.studentId, termId } },
    });
    // Rewritten…
    expect(after.generatedAt.getTime()).toBeGreaterThanOrEqual(before.generatedAt.getTime());
    // …but still released, so the correction reaches the families who already read the original
    // rather than silently vanishing from their portal.
    expect(after.publishedAt).not.toBeNull();
  });
});
