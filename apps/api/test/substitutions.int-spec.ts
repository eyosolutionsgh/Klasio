/**
 * Substitutions: cover is clash-checked like any placement — a relief teacher already teaching
 * (or already covering) in that period is refused with the clash named — and re-arranging cover
 * for the same lesson and date replaces rather than duplicates.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

/** The next Monday from today, as YYYY-MM-DD — substitutions refuse weekends. */
function nextMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

describe('substitutions', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;
  let periodId: string;
  let absentId: string;
  let reliefId: string;
  let slotA: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;

    // Build the little world the checks need: one period, two classes, two teachers, and the
    // absent teacher timetabled in class A while the relief teacher is free.
    const period = await db.timetablePeriod.create({
      data: { schoolId, name: 'Sub P1', startsMin: 8 * 60, endsMin: 9 * 60, order: 90 },
    });
    periodId = period.id;
    const classes = await db.classRoom.findMany({ where: { schoolId }, take: 2 });
    const [teacherA, teacherB] = await Promise.all([
      db.user.findFirstOrThrow({ where: { schoolId, email: 'teacher@demo.school' } }),
      db.user.findFirstOrThrow({ where: { schoolId, email: 'head@demo.school' } }),
    ]);
    absentId = teacherA.id;
    reliefId = teacherB.id;
    const slot = await db.timetableSlot.create({
      data: {
        schoolId,
        classId: classes[0].id,
        periodId,
        weekday: 1,
        teacherId: absentId,
      },
    });
    slotA = slot.id;
  });

  afterAll(async () => {
    await db.substitution.deleteMany({ where: { schoolId } });
    await db.timetableSlot.deleteMany({ where: { schoolId, periodId } });
    await db.timetablePeriod.deleteMany({ where: { schoolId, id: periodId } });
    await api.close();
    await db.$disconnect();
  });

  it('lists the absentee’s lessons, arranges cover, and re-arranging replaces it', async () => {
    const date = nextMonday();
    const listed = await call<{ slots: { id: string; cover: unknown }[] }>(
      api.baseUrl,
      'GET',
      `/timetable/substitutions/absentee?teacherId=${absentId}&date=${date}`,
      { token },
    );
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    expect(listed.body.slots.some((s) => s.id === slotA)).toBe(true);

    const covered = await call<{ id: string }>(api.baseUrl, 'POST', '/timetable/substitutions', {
      token,
      body: { slotId: slotA, date, reliefTeacherId: reliefId },
    });
    expect(covered.status, JSON.stringify(covered.body)).toBe(201);

    // Re-arranging the same lesson and date is an upsert, not a second row.
    const again = await call<{ id: string }>(api.baseUrl, 'POST', '/timetable/substitutions', {
      token,
      body: { slotId: slotA, date },
    });
    expect(again.status).toBe(201);
    expect(await db.substitution.count({ where: { slotId: slotA } })).toBe(1);
    const row = await db.substitution.findFirstOrThrow({ where: { slotId: slotA } });
    expect(row.reliefTeacherId).toBeNull(); // now honestly unstaffed

    const sheet = await call<{ id: string; relief: string | null }[]>(
      api.baseUrl,
      'GET',
      `/timetable/substitutions?date=${date}`,
      { token },
    );
    expect(sheet.body).toHaveLength(1);
    expect(sheet.body[0].relief).toBeNull();
  });

  it('refuses a relief teacher who already teaches in that period, naming the clash', async () => {
    const date = nextMonday();
    const classes = await db.classRoom.findMany({ where: { schoolId }, take: 2 });
    // Put the would-be relief teacher in class B for the same period and weekday.
    await db.timetableSlot.create({
      data: {
        schoolId,
        classId: classes[1].id,
        periodId,
        weekday: 1,
        teacherId: reliefId,
      },
    });
    const res = await call<{ message: string }>(api.baseUrl, 'POST', '/timetable/substitutions', {
      token,
      body: { slotId: slotA, date, reliefTeacherId: reliefId },
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('already teaches');
  });

  it('refuses a date that does not fall on the lesson’s weekday', async () => {
    const d = new Date(nextMonday());
    d.setDate(d.getDate() + 1); // Tuesday, but the slot is Monday
    const res = await call<{ message: string }>(api.baseUrl, 'POST', '/timetable/substitutions', {
      token,
      body: { slotId: slotA, date: d.toISOString().slice(0, 10) },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Monday');
  });
});
