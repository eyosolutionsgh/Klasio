/**
 * Boarding, proved against a live database as the non-owner role, so the new tables' RLS policies
 * and grants actually apply. The positive half walks the house → room → bed → exeat round trip;
 * the negative half proves a boarder from another school cannot be reached across the tenant line.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, otherSchool, seededSchool, startApi } from './setup/harness';

describe('boarding', () => {
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
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  it('house → room → bed → exeat, with the bed and capacity honoured', async () => {
    const house = await call<{ id: string }>(api.baseUrl, 'POST', '/housing/houses', {
      token,
      body: { name: `House ${Date.now()}`, kind: 'BOYS' },
    });
    expect(house.status, JSON.stringify(house.body)).toBe(201);

    const room = await call<{ id: string }>(
      api.baseUrl,
      'POST',
      `/housing/houses/${house.body.id}/rooms`,
      { token, body: { name: 'Dorm A', capacity: 1 } },
    );
    expect(room.status, JSON.stringify(room.body)).toBe(201);

    // Two candidates to test the capacity guard.
    const candidates = await call<{ studentId: string; name: string }[]>(
      api.baseUrl,
      'GET',
      '/housing/candidates',
      { token },
    );
    expect(candidates.status).toBe(200);
    expect(candidates.body.length).toBeGreaterThanOrEqual(2);
    const [first, second] = candidates.body;

    const assigned = await call(api.baseUrl, 'POST', `/housing/rooms/${room.body.id}/assign`, {
      token,
      body: { studentId: first.studentId },
    });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);

    // The room holds one bed, so the second boarder is refused rather than double-booked.
    const overflow = await call(api.baseUrl, 'POST', `/housing/rooms/${room.body.id}/assign`, {
      token,
      body: { studentId: second.studentId },
    });
    expect(overflow.status).toBe(400);

    // The first child now shows as a boarder in the overview, and no longer as a candidate.
    const overview = await call<{
      stats: { boarders: number };
      houses: { rooms: { boarders: { studentId: string }[] }[] }[];
    }>(api.baseUrl, 'GET', '/housing', { token });
    const boarderIds = overview.body.houses.flatMap((h) =>
      h.rooms.flatMap((r) => r.boarders.map((b) => b.studentId)),
    );
    expect(boarderIds).toContain(first.studentId);

    const stillCandidate = await call<{ studentId: string }[]>(
      api.baseUrl,
      'GET',
      '/housing/candidates',
      { token },
    );
    expect(stillCandidate.body.map((c) => c.studentId)).not.toContain(first.studentId);

    // Sign the boarder out on an exeat, then back in.
    const exeat = await call<{ id: string }>(api.baseUrl, 'POST', '/housing/exeats', {
      token,
      body: {
        studentId: first.studentId,
        reason: 'Weekend at home',
        dueBackAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      },
    });
    expect(exeat.status, JSON.stringify(exeat.body)).toBe(201);

    const out = await call<{ id: string; returnedAt: string | null }[]>(
      api.baseUrl,
      'GET',
      '/housing/exeats',
      { token },
    );
    expect(out.body.find((e) => e.id === exeat.body.id)?.returnedAt).toBeNull();

    const back = await call(api.baseUrl, 'POST', `/housing/exeats/${exeat.body.id}/return`, {
      token,
    });
    expect(back.status).toBe(201);

    const after = await db.exeat.findUniqueOrThrow({ where: { id: exeat.body.id } });
    expect(after.returnedAt).not.toBeNull();
  });

  it('a boarder in another school cannot be assigned across the tenant line', async () => {
    const other = await otherSchool(db);
    const house = await call<{ id: string }>(api.baseUrl, 'POST', '/housing/houses', {
      token,
      body: { name: `Cross ${Date.now()}`, kind: 'MIXED' },
    });
    const room = await call<{ id: string }>(
      api.baseUrl,
      'POST',
      `/housing/houses/${house.body.id}/rooms`,
      { token, body: { name: 'Dorm Z', capacity: 4 } },
    );

    // Reaching for the other school's child by id, while scoped to this school: the row is
    // invisible under RLS, so it reads as not found.
    const res = await call(api.baseUrl, 'POST', `/housing/rooms/${room.body.id}/assign`, {
      token,
      body: { studentId: other.student.id },
    });
    expect(res.status).toBe(404);

    expect(await db.boardingAssignment.count({ where: { studentId: other.student.id } })).toBe(0);
    expect(schoolId).not.toBe(other.school.id);
  });
});
