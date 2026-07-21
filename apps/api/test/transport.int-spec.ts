/**
 * Transport: routes, riders, scans and the billing hand-off. The load-bearing assertions are
 * the seat-follows-billing rule (assigning a rider to a route with a fee item subscribes them;
 * moving or removing them unsubscribes) and the scan's clientRef idempotency, because the bus
 * is the definition of an offline device.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

describe('transport', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;
  let studentId: string;
  let feeItemId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;
    studentId = (await db.student.findFirstOrThrow({ where: { schoolId, status: 'ACTIVE' } })).id;
    const term = await db.term.findFirstOrThrow({
      where: { isCurrent: true, academicYear: { schoolId, isCurrent: true } },
    });
    feeItemId = (
      await db.feeItem.create({
        data: {
          schoolId,
          termId: term.id,
          name: 'Transport (test)',
          amount: 300,
          optional: true,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  it('route → stop → rider, with billing following the seat', async () => {
    const route = await call<{ id: string }>(api.baseUrl, 'POST', '/transport/routes', {
      token,
      body: { name: 'Adenta line', feeItemId },
    });
    expect(route.status, JSON.stringify(route.body)).toBe(201);

    const stop = await call<{ id: string }>(
      api.baseUrl,
      'POST',
      `/transport/routes/${route.body.id}/stops`,
      { token, body: { name: 'Shell signboard' } },
    );
    expect(stop.status).toBe(201);

    const rider = await call(api.baseUrl, 'POST', `/transport/routes/${route.body.id}/riders`, {
      token,
      body: { studentId, stopId: stop.body.id },
    });
    expect(rider.status, JSON.stringify(rider.body)).toBe(201);

    // Billing followed the seat: the child is now subscribed to the route's optional item.
    expect(await db.studentFeeItem.count({ where: { schoolId, studentId, feeItemId } })).toBe(1);

    const manifest = await call<{ riders: { studentId: string; stop: string | null }[] }>(
      api.baseUrl,
      'GET',
      `/transport/routes/${route.body.id}/manifest`,
      { token },
    );
    const mine = manifest.body.riders.find((r) => r.studentId === studentId)!;
    expect(mine).toBeTruthy();
    expect(mine.stop).toBe('Shell signboard');

    // Removing the rider unsubscribes them — no ghost billing.
    const removed = await call(api.baseUrl, 'DELETE', `/transport/riders/${studentId}`, { token });
    expect(removed.status).toBe(200);
    expect(await db.studentFeeItem.count({ where: { schoolId, studentId, feeItemId } })).toBe(0);
  });

  it('scans are idempotent by clientRef and honest about the manifest', async () => {
    const route = await call<{ id: string }>(api.baseUrl, 'POST', '/transport/routes', {
      token,
      body: { name: 'Madina line' },
    });
    const clientRef = `scan-${Date.now()}`;
    const first = await call<{ onManifest: boolean; student: string }>(
      api.baseUrl,
      'POST',
      '/transport/scan',
      { token, body: { studentId, routeId: route.body.id, direction: 'BOARD', clientRef } },
    );
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    // Not on this route's manifest — recorded anyway, and said out loud.
    expect(first.body.onManifest).toBe(false);

    const replay = await call<{ replayed: boolean }>(api.baseUrl, 'POST', '/transport/scan', {
      token,
      body: { studentId, routeId: route.body.id, direction: 'BOARD', clientRef },
    });
    expect(replay.body.replayed).toBe(true);
    expect(await db.transportScan.count({ where: { schoolId, routeId: route.body.id } })).toBe(1);

    // The ID-card QR path: the admission number finds the same child.
    const student = await db.student.findUniqueOrThrow({ where: { id: studentId } });
    const byAdmission = await call<{ student: string }>(api.baseUrl, 'POST', '/transport/scan', {
      token,
      body: {
        admissionNo: student.admissionNo,
        routeId: route.body.id,
        direction: 'ALIGHT',
        clientRef: `scan2-${Date.now()}`,
      },
    });
    expect(byAdmission.status, JSON.stringify(byAdmission.body)).toBe(201);
  });
});
