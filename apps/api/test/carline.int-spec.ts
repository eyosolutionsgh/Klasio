/**
 * The car line round trip: a guardian announces from the family portal, the gate sees the queue
 * in arrival order, calls the family forward and finishes the entry. Guardian-side writes run
 * under RLS with a guardian JWT — a path no other spec exercises.
 */
import { PrismaClient } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jwtSecret } from '../src/common/auth';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

function guardianToken(guardian: {
  id: string;
  schoolId: string;
  firstName: string;
  lastName: string;
}) {
  return jwt.sign(
    {
      sub: guardian.id,
      schoolId: guardian.schoolId,
      kind: 'guardian',
      name: `${guardian.firstName} ${guardian.lastName}`,
    },
    jwtSecret(),
    { expiresIn: '1d' },
  );
}

describe('car line', () => {
  let api: Api;
  let db: PrismaClient;
  let staffToken: string;
  let gToken: string;
  let schoolId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    staffToken = seeded.token;
    schoolId = seeded.school.id;
    const guardian = await db.guardian.findFirstOrThrow({
      where: { schoolId, students: { some: { canPickup: true } } },
    });
    gToken = guardianToken(guardian);
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  it('announce → queue → call → done, and announcing twice holds one place', async () => {
    const first = await call<{ entry: { id: string; status: string }; position: number }>(
      api.baseUrl,
      'POST',
      '/guardian/carline',
      { token: gToken },
    );
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.entry).toBeTruthy();
    expect(first.body.position).toBe(1);

    // A nervous double-tap keeps the same place, not two.
    const again = await call<{ entry: { id: string } }>(api.baseUrl, 'POST', '/guardian/carline', {
      token: gToken,
    });
    expect(again.body.entry.id).toBe(first.body.entry.id);

    const queue = await call<
      { id: string; position: number; status: string; children: { name: string }[] }[]
    >(api.baseUrl, 'GET', '/pickup/carline', { token: staffToken });
    expect(queue.status, JSON.stringify(queue.body)).toBe(200);
    const mine = queue.body.find((r) => r.id === first.body.entry.id)!;
    expect(mine).toBeTruthy();
    expect(mine.children.length).toBeGreaterThan(0);

    const called = await call(api.baseUrl, 'PATCH', `/pickup/carline/${mine.id}`, {
      token: staffToken,
      body: { status: 'CALLED' },
    });
    expect(called.status, JSON.stringify(called.body)).toBe(200);

    // The family's screen flips to "you're up".
    const myView = await call<{ entry: { status: string }; position: number }>(
      api.baseUrl,
      'GET',
      '/guardian/carline',
      { token: gToken },
    );
    expect(myView.body.entry.status).toBe('CALLED');
    expect(myView.body.position).toBe(0);

    const done = await call(api.baseUrl, 'PATCH', `/pickup/carline/${mine.id}`, {
      token: staffToken,
      body: { status: 'DONE' },
    });
    expect(done.status).toBe(200);

    const row = await db.carLineEntry.findUniqueOrThrow({ where: { id: mine.id } });
    expect(row.status).toBe('DONE');
    expect(row.calledAt).not.toBeNull();
    expect(row.doneAt).not.toBeNull();

    // Finished means gone from both screens.
    const after = await call<{ entry: null }>(api.baseUrl, 'GET', '/guardian/carline', {
      token: gToken,
    });
    expect(after.body.entry).toBeNull();
  });
});
