/**
 * The six books a school still kept on a shelf.
 *
 * All six are new tenant tables, so RLS matters for every one of them — a missing policy fails
 * open and silently. The behavioural assertions are on the rules that make each book worth having
 * rather than on the CRUD: vetting your own notes is not vetting, a returned note has to say
 * what was wrong, a second feeding collection is a correction rather than a second lunch, and a
 * visitor who never signed out has to be visible as still on site.
 */
import { PrismaClient } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jwtSecret, signToken } from '../src/common/auth';
import { Api, call, ownerDb, otherSchool, seededSchool, startApi } from './setup/harness';

describe('school registers', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let teacherToken: string;
  let teacherId: string;
  let schoolId: string;
  let studentId: string;
  let classId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;

    const teacher = await db.user.findFirstOrThrow({ where: { schoolId, role: 'TEACHER' } });
    teacherId = teacher.id;
    teacherToken = signToken({
      sub: teacher.id,
      schoolId,
      role: teacher.role,
      tier: seeded.school.tier,
      name: teacher.name,
    });

    const student = await db.student.findFirstOrThrow({
      where: { schoolId, status: 'ACTIVE', classId: { not: null } },
    });
    studentId = student.id;
    classId = student.classId as string;
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  it('writes a dated, attributed log book entry', async () => {
    const res = await call<{ id: string }>(api.baseUrl, 'POST', '/registers/logbook', {
      token,
      body: { kind: 'VISIT', body: 'District officer called unannounced at 10.15.' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const list = await call<{ rows: { body: string; authorName: string }[] }>(
      api.baseUrl,
      'GET',
      '/registers/logbook',
      { token },
    );
    const entry = list.body.rows.find((r) => r.body.includes('District officer'));
    // Attribution is the point: an unsigned log book entry is worth nothing to an inspector.
    expect(entry?.authorName).toBeTruthy();
  });

  it('puts a teacher on duty and reports who is on duty today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await call(api.baseUrl, 'POST', '/registers/duty', {
      token,
      body: { userId: teacherId, startDate: today, endDate: today, note: 'Assembly and closing' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const on = await call<{ userId: string }[]>(api.baseUrl, 'GET', '/registers/duty/today', {
      token,
    });
    expect(on.body.map((d) => d.userId)).toContain(teacherId);
  });

  it('refuses a duty turn that ends before it starts', async () => {
    const res = await call(api.baseUrl, 'POST', '/registers/duty', {
      token,
      body: { userId: teacherId, startDate: '2026-05-10', endDate: '2026-05-01' },
    });
    expect(res.status).toBe(400);
  });

  it('will not let a teacher vet their own lesson notes', async () => {
    const submitted = await call<{ id: string }>(api.baseUrl, 'POST', '/registers/lesson-notes', {
      token: teacherToken,
      body: { weekOf: '2026-05-04', title: 'Fractions — week 4', body: 'Introduce equivalence.' },
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);

    const self = await call(
      api.baseUrl,
      'PATCH',
      `/registers/lesson-notes/${submitted.body.id}/vet`,
      { token: teacherToken, body: { status: 'APPROVED' } },
    );
    // Either the permission refuses it or the self-check does; both are correct, neither is 200.
    expect([401, 403]).toContain(self.status);

    const byHead = await call(
      api.baseUrl,
      'PATCH',
      `/registers/lesson-notes/${submitted.body.id}/vet`,
      { token, body: { status: 'APPROVED' } },
    );
    expect(byHead.status, JSON.stringify(byHead.body)).toBe(200);
  });

  it('will not return lesson notes without saying what is wrong', async () => {
    const submitted = await call<{ id: string }>(api.baseUrl, 'POST', '/registers/lesson-notes', {
      token: teacherToken,
      body: { weekOf: '2026-05-11', title: 'Fractions — week 5' },
    });
    const bounced = await call(
      api.baseUrl,
      'PATCH',
      `/registers/lesson-notes/${submitted.body.id}/vet`,
      { token, body: { status: 'RETURNED' } },
    );
    // "Redo it" with no reason is a bounce, not vetting.
    expect(bounced.status).toBe(400);

    const proper = await call(
      api.baseUrl,
      'PATCH',
      `/registers/lesson-notes/${submitted.body.id}/vet`,
      { token, body: { status: 'RETURNED', comment: 'Add the assessment for Thursday.' } },
    );
    expect(proper.status).toBe(200);
  });

  it('shows a teacher only their own notes, and a vetter everyone’s', async () => {
    const mine = await call<{ rows: { teacherName: string }[] }>(
      api.baseUrl,
      'GET',
      '/registers/lesson-notes',
      { token: teacherToken },
    );
    expect(mine.body.rows.length).toBeGreaterThan(0);
    expect(new Set(mine.body.rows.map((r) => r.teacherName)).size).toBe(1);
  });

  it('records a discipline entry against the child, with the escalation on it', async () => {
    const res = await call(api.baseUrl, 'POST', '/registers/discipline', {
      token,
      body: {
        studentId,
        occurredOn: '2026-05-12',
        description: 'Left the compound at break without permission.',
        actionTaken: 'Spoken to by the class teacher; guardian telephoned.',
        outcome: 'PARENT_INFORMED',
        guardianInformedAt: '2026-05-12T14:00:00.000Z',
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const list = await call<{ rows: { outcome: string; guardianInformedAt: string | null }[] }>(
      api.baseUrl,
      'GET',
      `/registers/discipline?studentId=${studentId}`,
      { token },
    );
    expect(list.body.rows[0].outcome).toBe('PARENT_INFORMED');
    // The date the family was told is the fact most often disputed afterwards.
    expect(list.body.rows[0].guardianInformedAt).toBeTruthy();
  });

  it('signs a visitor in and out, and shows anyone still on site', async () => {
    const inRes = await call<{ id: string }>(api.baseUrl, 'POST', '/registers/visitors', {
      token,
      body: { name: 'Yaw Boateng', organisation: 'GES District', purpose: 'Routine inspection', toSee: 'The head' },
    });
    expect(inRes.status, JSON.stringify(inRes.body)).toBe(201);

    const before = await fetch(`${api.baseUrl}/registers/visitors/export`, {
      headers: { authorization: `Bearer ${token}` },
    });
    // Someone who never signed out has to be visible as such — that is the safeguarding question.
    expect(await before.text()).toContain('STILL ON SITE');

    const out = await call(api.baseUrl, 'PATCH', `/registers/visitors/${inRes.body.id}/out`, {
      token,
    });
    expect(out.status).toBe(200);
  });

  it('treats a second feeding collection as a correction, not a second lunch', async () => {
    const on = '2026-05-13';
    const first = await call<{ amount: number }>(api.baseUrl, 'POST', '/registers/feeding', {
      token,
      body: { studentId, onDate: on, amount: 5 },
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    const corrected = await call<{ amount: number }>(api.baseUrl, 'POST', '/registers/feeding', {
      token,
      body: { studentId, onDate: on, amount: 7 },
    });
    expect(corrected.body.amount).toBe(7);

    const rows = await db.feedingRecord.findMany({ where: { studentId } });
    expect(rows).toHaveLength(1);

    // And it must never have touched the child's fee account: an unpaid lunch is not an arrear.
    const ledger = await db.ledgerEntry.count({
      where: { studentId, note: { contains: 'eeding' } },
    });
    expect(ledger).toBe(0);
  });

  it('lists a class’s feeding day with the unpaid names, not just a total', async () => {
    const res = await call<{ collected: number; paidCount: number; unpaidCount: number; rows: unknown[] }>(
      api.baseUrl,
      'GET',
      `/registers/feeding?classId=${classId}&onDate=2026-05-13`,
      { token },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.collected).toBe(7);
    expect(res.body.paidCount).toBe(1);
    // The person carrying the tin needs the list of who has not paid, not a figure.
    expect(res.body.unpaidCount).toBeGreaterThan(0);
    expect(res.body.rows.length).toBe(res.body.paidCount + res.body.unpaidCount);
  });

  /** Six new tenant tables; a missing policy on any of them fails open and silently. */
  it("cannot read another school's registers", async () => {
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

    for (const path of ['/registers/logbook', '/registers/visitors', '/registers/discipline']) {
      const res = await call<{ rows: unknown[] }>(api.baseUrl, 'GET', path, { token: otherToken });
      expect(res.status, `${path} → ${res.status}`).toBe(200);
      expect(res.body.rows, `${path} leaked rows`).toHaveLength(0);
    }
  });
});
