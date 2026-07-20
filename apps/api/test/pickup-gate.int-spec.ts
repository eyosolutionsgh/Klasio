/**
 * The gate's write paths, proved against RLS as the eyo_app role.
 *
 * Check-in is a tenant-scoped append made replay-safe by `clientRef` — exactly the shape the
 * offline queue depends on, so its idempotency has to be proved against a real database, not a
 * mock. Delegate creation carries a policy default (expiry with the current term) that only a
 * live current-term row can exercise.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

describe('gate check-in and delegates', () => {
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

  it('checks a child in, and replaying the same clientRef does not record a second arrival', async () => {
    const clientRef = `test-checkin-${Date.now()}`;
    const first = await call<{ id: string; student: string }>(
      api.baseUrl,
      'POST',
      '/pickup/checkin',
      {
        token,
        body: { studentId, broughtBy: 'Kofi Mensah', clientRef },
      },
    );
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.student).toBeTruthy();

    // The replay is the point: the device only retries because it never saw our answer.
    const replay = await call<{ checkedIn: boolean; replayed: boolean }>(
      api.baseUrl,
      'POST',
      '/pickup/checkin',
      { token, body: { studentId, broughtBy: 'Kofi Mensah', clientRef } },
    );
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(replay.body.replayed).toBe(true);

    const rows = await db.checkInLog.findMany({ where: { studentId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].broughtBy).toBe('Kofi Mensah');
  });

  it('refuses a second check-in for the same child on the same day', async () => {
    const res = await call<{ message: string }>(api.baseUrl, 'POST', '/pickup/checkin', {
      token,
      body: { studentId, clientRef: `test-checkin-2-${Date.now()}` },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('already checked in');
  });

  it('defaults a delegate with no end date to expiring with the current term', async () => {
    const term = await db.term.findFirstOrThrow({
      where: { isCurrent: true, academicYear: { schoolId, isCurrent: true } },
    });

    const res = await call<{ id: string; expiresAt: string }>(
      api.baseUrl,
      'POST',
      `/pickup/students/${studentId}/delegates`,
      { token, body: { name: 'Ama Serwaa', phone: '0209876543', relationship: 'Neighbour' } },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.expiresAt).toBeTruthy();

    const delegate = await db.pickupDelegate.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(delegate.expiresAt).not.toBeNull();
    // Either the term end (a future date) or the 90-day fallback — never open-ended, and when
    // the seeded term is still running it must be exactly the term end.
    if (term.endDate > new Date()) {
      expect(delegate.expiresAt!.toISOString()).toBe(term.endDate.toISOString());
    }
  });
});
