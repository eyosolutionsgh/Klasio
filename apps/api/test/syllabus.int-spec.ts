/**
 * Syllabus coverage: topic CRUD and per-class ticks under RLS, and the two guards that make
 * the numbers honest — a tick for a class at the wrong level is refused, and a deleted topic
 * takes its ticks with it (else coverage percentages count ghosts).
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

describe('syllabus coverage', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;
  let subjectId: string;
  let levelId: string;
  let classId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;
    const cls = await db.classRoom.findFirstOrThrow({
      where: { schoolId },
      include: { level: true },
    });
    classId = cls.id;
    levelId = cls.levelId;
    subjectId = (await db.subject.findFirstOrThrow({ where: { schoolId } })).id;
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  it('creates topics, ticks them for a class, and reports the class summary', async () => {
    const t1 = await call<{ id: string }>(api.baseUrl, 'POST', '/syllabus/topics', {
      token,
      body: { subjectId, levelId, title: 'Fractions — addition' },
    });
    const t2 = await call<{ id: string }>(api.baseUrl, 'POST', '/syllabus/topics', {
      token,
      body: { subjectId, levelId, title: 'Fractions — subtraction' },
    });
    expect(t1.status, JSON.stringify(t1.body)).toBe(201);
    expect(t2.status).toBe(201);

    const tick = await call(api.baseUrl, 'POST', `/syllabus/topics/${t1.body.id}/coverage`, {
      token,
      body: { classId, covered: true },
    });
    expect(tick.status, JSON.stringify(tick.body)).toBe(201);

    const listed = await call<{ id: string; covered: boolean }[]>(
      api.baseUrl,
      'GET',
      `/syllabus/topics?subjectId=${subjectId}&levelId=${levelId}&classId=${classId}`,
      { token },
    );
    expect(listed.body.find((t) => t.id === t1.body.id)?.covered).toBe(true);
    expect(listed.body.find((t) => t.id === t2.body.id)?.covered).toBe(false);

    const summary = await call<{ classId: string; covered: number; topics: number; pct: number }[]>(
      api.baseUrl,
      'GET',
      `/syllabus/summary?subjectId=${subjectId}`,
      { token },
    );
    const mine = summary.body.find((s) => s.classId === classId)!;
    expect(mine.covered).toBe(1);
    expect(mine.topics).toBeGreaterThanOrEqual(2);

    // Unticking deletes the row — coverage is a fact, not a ledger.
    await call(api.baseUrl, 'POST', `/syllabus/topics/${t1.body.id}/coverage`, {
      token,
      body: { classId, covered: false },
    });
    expect(await db.syllabusCoverage.count({ where: { topicId: t1.body.id } })).toBe(0);
  });

  it('refuses a tick for a class at another level', async () => {
    const otherLevel = await db.level.findFirstOrThrow({
      where: { schoolId, id: { not: levelId } },
    });
    const otherClass = await db.classRoom.findFirst({
      where: { schoolId, levelId: otherLevel.id },
    });
    if (!otherClass) return; // seed guarantees several levels, but stay honest

    const topic = await call<{ id: string }>(api.baseUrl, 'POST', '/syllabus/topics', {
      token,
      body: { subjectId, levelId, title: 'Level-bound topic' },
    });
    const res = await call<{ message: string }>(
      api.baseUrl,
      'POST',
      `/syllabus/topics/${topic.body.id}/coverage`,
      { token, body: { classId: otherClass.id, covered: true } },
    );
    expect(res.status).toBe(400);
  });

  it('deleting a topic takes its ticks with it', async () => {
    const topic = await call<{ id: string }>(api.baseUrl, 'POST', '/syllabus/topics', {
      token,
      body: { subjectId, levelId, title: 'Doomed topic' },
    });
    await call(api.baseUrl, 'POST', `/syllabus/topics/${topic.body.id}/coverage`, {
      token,
      body: { classId, covered: true },
    });
    const del = await call(api.baseUrl, 'DELETE', `/syllabus/topics/${topic.body.id}`, { token });
    expect(del.status).toBe(200);
    expect(await db.syllabusCoverage.count({ where: { topicId: topic.body.id } })).toBe(0);
  });
});
