/**
 * Mock examination series — exams that are not terms.
 *
 * The audit's gap: a candidate class sits three to six mocks inside one term, each with a full set
 * of subject marks and a BECE-style aggregate, and the software could only express an exam as a
 * term or as an assessment component. The first would need a fee structure and report cards per
 * mock; the second would fold a rehearsal into the terminal report.
 *
 * The assertions that matter are about the aggregate: four cores plus the best two electives, a
 * stated reason when it cannot be computed, and improvement expressed as improvement even though
 * a BECE aggregate falls as a candidate gets better.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

interface Results {
  candidates: {
    studentId: string;
    name: string;
    aggregate: number | null;
    gap: string | null;
    subjects: { subject: string; grade: number }[];
  }[];
  bestAggregate: number | null;
  averageAggregate: number | null;
  candidatesWithAggregate: number;
}

describe('mock examination series', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;
  let seriesId: string;
  let secondId: string;
  let students: { id: string }[];
  let cores: { id: string; name: string }[];
  let electives: { id: string; name: string }[];

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;

    const all = await db.subject.findMany({ where: { schoolId } });
    cores = all.filter((s) => s.isCore).slice(0, 4);
    electives = all.filter((s) => !s.isCore).slice(0, 2);
    students = await db.student.findMany({
      where: { schoolId, status: 'ACTIVE' },
      select: { id: true },
      take: 3,
    });
  });

  afterAll(async () => {
    await db.mockSeries.deleteMany({ where: { schoolId } });
    await api.close();
    await db.$disconnect();
  });

  /** Give every listed student the same mark in every listed subject. */
  async function mark(id: string, subjects: { id: string }[], total: number) {
    for (const s of subjects) {
      const res = await call(api.baseUrl, 'POST', `/mocks/${id}/marks`, {
        token,
        body: { subjectId: s.id, marks: students.map((st) => ({ studentId: st.id, total })) },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
  }

  it('creates a series against the year, not a term', async () => {
    const res = await call<{ id: string }>(api.baseUrl, 'POST', '/mocks', {
      token,
      body: { name: 'Mock 1', sittingOn: '2026-02-10' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    seriesId = res.body.id;

    const row = await db.mockSeries.findUniqueOrThrow({ where: { id: seriesId } });
    expect(row.academicYearId).toBeTruthy();
    // The whole point: no term id anywhere on it.
    expect(row).not.toHaveProperty('termId');
  });

  it('refuses a second series with the same name in the same year', async () => {
    const res = await call(api.baseUrl, 'POST', '/mocks', { token, body: { name: 'Mock 1' } });
    expect(res.status).toBe(400);
  });

  it('says why an aggregate cannot be computed rather than inventing one', async () => {
    // Only three cores marked — not enough for a BECE aggregate.
    await mark(seriesId, cores.slice(0, 3), 70);
    const res = await call<Results>(api.baseUrl, 'GET', `/mocks/${seriesId}/results`, { token });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const c = res.body.candidates[0];
    expect(c.aggregate).toBeNull();
    expect(c.gap).toMatch(/core/i);
  });

  it('computes the aggregate from four cores and the best two electives', async () => {
    await mark(seriesId, cores, 75);
    await mark(seriesId, electives, 75);

    const res = await call<Results>(api.baseUrl, 'GET', `/mocks/${seriesId}/results`, { token });
    const c = res.body.candidates[0];
    // 75 is grade 3 on the BECE stanine scale, over four cores plus two electives.
    expect(c.aggregate).toBe(18);
    expect(c.gap).toBeNull();
    expect(res.body.candidatesWithAggregate).toBe(students.length);
    expect(res.body.bestAggregate).toBe(18);
  });

  it('re-entering a mark corrects it rather than adding a second one', async () => {
    await mark(seriesId, [cores[0]], 90);
    const rows = await db.mockResult.findMany({
      where: { seriesId, studentId: students[0].id, subjectId: cores[0].id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(90);
  });

  it('compares two series and states improvement as improvement', async () => {
    const created = await call<{ id: string }>(api.baseUrl, 'POST', '/mocks', {
      token,
      body: { name: 'Mock 2', sittingOn: '2026-04-14' },
    });
    secondId = created.body.id;
    // Better marks: 85 is grade 2 against 75's grade 3, so the aggregate falls from 18 to 12.
    await mark(secondId, cores, 85);
    await mark(secondId, electives, 85);

    const res = await call<{ rows: { was: number | null; now: number | null; improvedBy: number | null }[] }>(
      api.baseUrl,
      'GET',
      `/mocks/${secondId}/compare/${seriesId}`,
      { token },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = res.body.rows.find((r) => r.was !== null && r.now !== null);
    expect(row?.now).toBe(12);
    /*
      A BECE aggregate falls as a candidate improves, so the raw difference is negative for a
      better result. Improvement is reported positive, because a table of negative numbers meaning
      "better" gets read backwards in a staff meeting.
    */
    expect(row?.improvedBy).toBeGreaterThan(0);
  });

  it('exports the series with every subject grade', async () => {
    const res = await fetch(`${api.baseUrl}/mocks/${seriesId}/results.csv`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain('Aggregate');
    expect(csv).toContain(cores[0].name);
  });

  it('deletes a series and its marks together', async () => {
    const res = await call(api.baseUrl, 'DELETE', `/mocks/${secondId}`, { token });
    expect(res.status).toBe(200);
    expect(await db.mockResult.count({ where: { seriesId: secondId } })).toBe(0);
  });
});
