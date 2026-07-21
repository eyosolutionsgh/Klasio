/**
 * Staff register and leave, against RLS. The load-bearing assertions: a corrected mark replaces
 * rather than duplicates (composite-key upsert), and the holder of hr.leave still cannot decide
 * their own request — the one separation-of-duties rule the permission grid cannot carry.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

describe('staff attendance and leave', () => {
  let api: Api;
  let db: PrismaClient;
  let ownerToken: string;
  let schoolId: string;
  let headId: string;
  let headToken: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    ownerToken = seeded.token;
    schoolId = seeded.school.id;
    const head = await db.user.findFirstOrThrow({
      where: { schoolId, email: 'klasio-head@mailinator.com' },
    });
    headId = head.id;
    const signIn = await call<{ token: string }>(api.baseUrl, 'POST', '/auth/login', {
      body: { email: 'klasio-head@mailinator.com', password: 'Password1!' },
    });
    expect(signIn.status, JSON.stringify(signIn.body)).toBe(201);
    headToken = signIn.body.token;
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  it('marks a staff member and a correction replaces the mark', async () => {
    const date = '2026-07-20';
    const first = await call(api.baseUrl, 'POST', '/hr/attendance/mark', {
      token: ownerToken,
      body: { userId: headId, date, status: 'LATE' },
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    const corrected = await call(api.baseUrl, 'POST', '/hr/attendance/mark', {
      token: ownerToken,
      body: { userId: headId, date, status: 'PRESENT' },
    });
    expect(corrected.status).toBe(201);

    const rows = await db.staffAttendanceRecord.findMany({
      where: { schoolId, userId: headId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('PRESENT');

    const roster = await call<{ userId: string; status: string | null }[]>(
      api.baseUrl,
      'GET',
      `/hr/attendance?date=${date}`,
      { token: ownerToken },
    );
    expect(roster.body.find((r) => r.userId === headId)?.status).toBe('PRESENT');
  });

  it('leave: request → someone else approves; self-approval is refused outright', async () => {
    const req = await call<{ id: string }>(api.baseUrl, 'POST', '/hr/leave', {
      token: headToken,
      body: {
        kind: 'CASUAL',
        startDate: '2026-08-03',
        endDate: '2026-08-05',
        reason: 'Family matter in Kumasi',
      },
    });
    expect(req.status, JSON.stringify(req.body)).toBe(201);

    // The head holds hr.leave, but this request is their own.
    const self = await call<{ message: string }>(api.baseUrl, 'PATCH', `/hr/leave/${req.body.id}`, {
      token: headToken,
      body: { status: 'APPROVED' },
    });
    expect(self.status).toBe(400);
    expect(self.body.message).toContain('Someone else');

    const decided = await call(api.baseUrl, 'PATCH', `/hr/leave/${req.body.id}`, {
      token: ownerToken,
      body: { status: 'APPROVED' },
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);

    const row = await db.leaveRequest.findUniqueOrThrow({ where: { id: req.body.id } });
    expect(row.status).toBe('APPROVED');
    expect(row.decidedById).not.toBe(headId);

    // Approved leave shows on the register for its days.
    const roster = await call<{ userId: string; onLeave: string | null }[]>(
      api.baseUrl,
      'GET',
      '/hr/attendance?date=2026-08-04',
      { token: ownerToken },
    );
    expect(roster.body.find((r) => r.userId === headId)?.onLeave).toBe('CASUAL');

    // A second overlapping request is a duplicate, not a new ask.
    const dup = await call<{ message: string }>(api.baseUrl, 'POST', '/hr/leave', {
      token: headToken,
      body: {
        kind: 'ANNUAL',
        startDate: '2026-08-04',
        endDate: '2026-08-06',
        reason: 'Overlapping request that must be refused',
      },
    });
    expect(dup.status).toBe(400);
  });
});
