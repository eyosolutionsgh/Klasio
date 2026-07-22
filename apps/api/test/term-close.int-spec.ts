/**
 * Closing a term, and what "closed" actually costs.
 *
 * Before this the software knew only `isCurrent` — a pointer at the term to default to. Moving it
 * forward left every earlier term open to writes for ever, so a register mark or a corrected
 * score could land against a term whose reports went home months earlier and silently disagree
 * with the document a family already had.
 *
 * The interesting assertions here are the ones about what closing does *not* stop: money keeps
 * moving, because arrears carry forward and a parent may settle last term's bill in December.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

describe('term and year close', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;
  let termId: string;
  let yearId: string;
  let classId: string;
  let subjectId: string;
  let studentId: string;
  let componentId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;

    const term = await db.term.findFirstOrThrow({
      where: { academicYear: { schoolId }, isCurrent: true },
    });
    termId = term.id;
    yearId = term.academicYearId;

    const score = await db.score.findFirstOrThrow({
      where: { schoolId, termId, student: { status: 'ACTIVE', classId: { not: null } } },
      include: { student: true },
    });
    classId = score.student.classId as string;
    subjectId = score.subjectId;
    studentId = score.studentId;
    componentId = score.componentId;
  });

  afterAll(async () => {
    /**
     * Leave **every** term open, not just the one this file works on.
     *
     * Closing the year requires closing its other terms, and reopening only `termId` left those
     * siblings closed for the rest of the run. On its own that was invisible; combined with
     * calendar-and-records moving the current-term flag onto one of them, a later spec would ask
     * the API to generate reports for a current term that was closed and get a 400 it could not
     * explain. Two files, each harmless alone.
     */
    await db.term.updateMany({
      where: { academicYearId: yearId },
      data: { closedAt: null, closedById: null },
    });
    await db.academicYear.updateMany({
      where: { id: yearId },
      data: { closedAt: null, closedById: null },
    });
    await api.close();
    await db.$disconnect();
  });

  const closeTerm = (body: Record<string, unknown> = {}) =>
    call<{ closed: string; message?: string }>(
      api.baseUrl,
      'POST',
      `/school/terms/${termId}/close`,
      {
        token,
        body,
      },
    );

  const reopenTerm = (reason: string) =>
    call(api.baseUrl, 'POST', `/school/terms/${termId}/reopen`, { token, body: { reason } });

  const markRegister = () =>
    call(api.baseUrl, 'POST', '/attendance/mark', {
      token,
      body: {
        classId,
        date: new Date().toISOString().slice(0, 10),
        entries: [{ studentId, status: 'PRESENT' }],
      },
    });

  const saveScore = () =>
    call(api.baseUrl, 'POST', '/assessment/scores', {
      token,
      body: {
        termId,
        classId,
        subjectId,
        entries: [{ studentId, componentId, rawScore: 10 }],
      },
    });

  it('reports what is still outstanding before closing, without refusing', async () => {
    const res = await call<{ reportsTotal: number; reportsUnpublished: number }>(
      api.baseUrl,
      'GET',
      `/school/terms/${termId}/checklist`,
      { token },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Advisory: a school closing a forgotten term in October must still be able to.
    expect(res.body).toHaveProperty('reportsUnpublished');
  });

  it('takes a register and a score while the term is open', async () => {
    expect((await markRegister()).status).toBe(201);
    expect((await saveScore()).status).toBe(201);
  });

  it('closes the term', async () => {
    const res = await closeTerm();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const term = await db.term.findUniqueOrThrow({ where: { id: termId } });
    expect(term.closedAt).not.toBeNull();
  });

  it('refuses a register and a score against the closed term, naming the way out', async () => {
    const register = await markRegister();
    expect(register.status, JSON.stringify(register.body)).toBe(400);
    expect(JSON.stringify(register.body)).toMatch(/reopen the term/i);

    const score = await saveScore();
    expect(score.status, JSON.stringify(score.body)).toBe(400);
  });

  it('refuses to regenerate reports for a closed term', async () => {
    const res = await call(api.baseUrl, 'POST', '/assessment/reports/generate', {
      token,
      body: { classId, termId, regeneratePublished: true },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  /**
   * The deliberate exception. A closed term that refused a payment would be a closed term that
   * lost a school money — parents settle last term's bill all the time.
   */
  it('still lets money move against a closed term', async () => {
    const res = await call<{ receiptNumber?: string }>(api.baseUrl, 'POST', '/fees/payments', {
      token,
      body: { studentId, amount: 50, method: 'CASH', note: 'Paid after the term closed' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it('will not close a year while one of its terms is open, and closes it once they are shut', async () => {
    // Another term in the same year is still open, so the year cannot close yet.
    const others = await db.term.findMany({
      where: { academicYearId: yearId, closedAt: null },
    });
    if (others.length > 0) {
      const refused = await call<{ message: string }>(
        api.baseUrl,
        'POST',
        `/school/years/${yearId}/close`,
        { token },
      );
      expect(refused.status, JSON.stringify(refused.body)).toBe(400);
      expect(JSON.stringify(refused.body)).toMatch(/close/i);
      // A year is exactly its terms; close the rest.
      for (const t of others) {
        await db.term.update({ where: { id: t.id }, data: { closedAt: new Date() } });
      }
    }

    const closed = await call(api.baseUrl, 'POST', `/school/years/${yearId}/close`, { token });
    expect(closed.status, JSON.stringify(closed.body)).toBe(201);
    expect(
      (await db.academicYear.findUniqueOrThrow({ where: { id: yearId } })).closedAt,
    ).not.toBeNull();
  });

  it('will not reopen a term while its year is closed', async () => {
    const res = await call<{ message: string }>(
      api.baseUrl,
      'POST',
      `/school/terms/${termId}/reopen`,
      { token, body: { reason: 'A marking error came to light' } },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/reopen the year/i);
  });

  it('reopens the year, then the term, and takes marks again — with a reason on the record', async () => {
    const year = await call(api.baseUrl, 'POST', `/school/years/${yearId}/reopen`, {
      token,
      body: { reason: 'Closed a term early by mistake' },
    });
    expect(year.status, JSON.stringify(year.body)).toBe(201);

    const res = await reopenTerm('A marking error came to light in September');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await saveScore()).status).toBe(201);

    // Reopening history is exactly the thing that must be attributable afterwards.
    const entry = await db.auditLog.findFirst({
      where: { schoolId, action: 'school.term.reopen' },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(entry?.detail ?? {})).toMatch(/marking error/i);
  });

  it('refuses to reopen a term with no stated reason', async () => {
    await closeTerm();
    const res = await reopenTerm('');
    expect(res.status).toBe(400);
    await db.term.update({ where: { id: termId }, data: { closedAt: null } });
  });
});
