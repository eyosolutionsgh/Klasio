/**
 * Emergency alerts write across four tables in one action — broadcast, announcement, guardian
 * SMS, staff SMS — which is exactly the multi-statement shape RLS has refused before. The staff
 * leg is also the one send path in the product that texts User phones, so it gets proved here
 * rather than assumed.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

describe('emergency alerts', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;
    // Staff numbers exist in the seed? Give the head a phone so the staff leg has a target.
    await db.user.updateMany({
      where: { schoolId, email: 'klasio-head@mailinator.com' },
      data: { phone: '0244000001' },
    });
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  it('sends a lockdown to every family and every member of staff, and records it', async () => {
    const key = `emg-${Date.now()}`;
    const res = await call<{
      id: string;
      status: string;
      results: { channel: string; ok: boolean; detail: string }[];
    }>(api.baseUrl, 'POST', '/broadcasts/emergency', {
      token,
      body: {
        kind: 'LOCKDOWN',
        message: 'Doors are locked. Do not come to the school until the all clear.',
        idempotencyKey: key,
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const broadcast = await db.broadcast.findFirstOrThrow({
      where: { schoolId, idempotencyKey: key },
    });
    expect(broadcast.title).toContain('LOCKDOWN');
    expect(broadcast.audienceScope).toBe('ALL');

    // The portal notice, so a parent who missed the text still finds it.
    const notice = await db.announcement.findFirst({
      where: { schoolId, broadcastId: broadcast.id },
    });
    expect(notice).not.toBeNull();

    // Guardian texts under the broadcast batch, staff texts under their own.
    const guardianTexts = await db.smsMessage.count({
      where: { schoolId, batchId: `BC-${broadcast.id}` },
    });
    const staffTexts = await db.smsMessage.count({
      where: { schoolId, batchId: `BC-${broadcast.id}-STAFF` },
    });
    expect(guardianTexts).toBeGreaterThan(0);
    expect(staffTexts).toBeGreaterThan(0);

    // A double-tap is one alert.
    const replay = await call<{ id: string }>(api.baseUrl, 'POST', '/broadcasts/emergency', {
      token,
      body: {
        kind: 'LOCKDOWN',
        message: 'Doors are locked. Stay away for now.',
        idempotencyKey: key,
      },
    });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(broadcast.id);
    expect(await db.broadcast.count({ where: { schoolId, idempotencyKey: key } })).toBe(1);
  });

  it('refuses a teacher, who does not hold the emergency permission', async () => {
    const signIn = await call<{ token: string }>(api.baseUrl, 'POST', '/auth/login', {
      body: { email: 'klasio-teacher@mailinator.com', password: 'Password1!' },
    });
    expect(signIn.status, JSON.stringify(signIn.body)).toBe(201);
    const res = await call(api.baseUrl, 'POST', '/broadcasts/emergency', {
      token: signIn.body.token,
      body: {
        kind: 'GENERAL',
        message: 'This should never go out at all.',
        idempotencyKey: `emg-deny-${Date.now()}`,
      },
    });
    expect(res.status).toBe(403);
  });
});
