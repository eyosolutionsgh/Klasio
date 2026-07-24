/**
 * The LMS round trip across two guards: a teacher (staff JWT) publishes a lesson and sets an
 * assignment; a pupil (student JWT) reads it and submits from home; the teacher grades it and the
 * mark reappears on the pupil's side. The negative half proves the tenant line holds — a lesson
 * cannot be pinned to another school's class.
 */
import { PrismaClient } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jwtSecret } from '../src/common/auth';
import { Api, call, ownerDb, otherSchool, seededSchool, startApi } from './setup/harness';

function studentToken(s: { id: string; schoolId: string; firstName: string; lastName: string }) {
  return jwt.sign(
    { sub: s.id, schoolId: s.schoolId, kind: 'student', name: `${s.firstName} ${s.lastName}` },
    jwtSecret(),
    { expiresIn: '1d' },
  );
}

describe('lms', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;
  let classId: string;
  let subjectId: string;
  let pupil: { id: string; schoolId: string; firstName: string; lastName: string };

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;
    const student = await db.student.findFirstOrThrow({
      where: { schoolId, status: 'ACTIVE', classId: { not: null } },
    });
    classId = student.classId!;
    pupil = student;
    subjectId = (await db.subject.findFirstOrThrow({ where: { schoolId } })).id;
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  it('publish → read → submit → grade, end to end across both portals', async () => {
    const lesson = await call<{ id: string }>(api.baseUrl, 'POST', '/lms/lessons', {
      token,
      body: { classId, subjectId, title: 'Fractions', content: 'A fraction is a part of a whole.' },
    });
    expect(lesson.status, JSON.stringify(lesson.body)).toBe(201);

    const assignment = await call<{ id: string }>(api.baseUrl, 'POST', '/lms/assignments', {
      token,
      body: {
        classId,
        subjectId,
        title: 'Fractions homework',
        instructions: 'Answer questions 1–5.',
        dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        points: 20,
      },
    });
    expect(assignment.status, JSON.stringify(assignment.body)).toBe(201);

    const sToken = studentToken(pupil);

    // The pupil sees the lesson and the assignment for their class.
    const feed = await call<{
      lessons: { title: string }[];
      assignments: { id: string; submission: unknown }[];
    }>(api.baseUrl, 'GET', '/student/lms', { token: sToken });
    expect(feed.status, JSON.stringify(feed.body)).toBe(200);
    expect(feed.body.lessons.map((l) => l.title)).toContain('Fractions');
    const mine = feed.body.assignments.find((a) => a.id === assignment.body.id)!;
    expect(mine).toBeTruthy();
    expect(mine.submission).toBeNull();

    const submit = await call(
      api.baseUrl,
      'POST',
      `/student/lms/assignments/${assignment.body.id}/submit`,
      {
        token: sToken,
        body: { text: '1/2, 3/4, ...' },
      },
    );
    expect(submit.status, JSON.stringify(submit.body)).toBe(201);

    // The teacher sees the submission and grades it.
    const subs = await call<{ submissions: { id: string; studentId: string }[] }>(
      api.baseUrl,
      'GET',
      `/lms/assignments/${assignment.body.id}/submissions`,
      { token },
    );
    const sub = subs.body.submissions.find((s) => s.studentId === pupil.id)!;
    expect(sub).toBeTruthy();

    const grade = await call(api.baseUrl, 'POST', `/lms/submissions/${sub.id}/grade`, {
      token,
      body: { score: 18, feedback: 'Good work' },
    });
    expect(grade.status, JSON.stringify(grade.body)).toBe(201);

    // The mark reappears on the pupil's side, and the entry is now locked.
    const after = await call<{
      assignments: { id: string; submission: { score: number } | null }[];
    }>(api.baseUrl, 'GET', '/student/lms', { token: sToken });
    const graded = after.body.assignments.find((a) => a.id === assignment.body.id)!;
    expect(graded.submission?.score).toBe(18);

    const resubmit = await call(
      api.baseUrl,
      'POST',
      `/student/lms/assignments/${assignment.body.id}/submit`,
      {
        token: sToken,
        body: { text: 'changed my answer' },
      },
    );
    expect(resubmit.status).toBe(400);
  });

  it("another school's pupil cannot submit to this school's assignment", async () => {
    // An assignment that belongs to the seeded school.
    const assignment = await call<{ id: string }>(api.baseUrl, 'POST', '/lms/assignments', {
      token,
      body: {
        classId,
        subjectId,
        title: 'Private homework',
        instructions: 'For this class only.',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });

    const other = await otherSchool(db);
    const intruder = studentToken(other.student);

    // The intruder is scoped to their own school by their token, so the assignment is invisible.
    const res = await call(
      api.baseUrl,
      'POST',
      `/student/lms/assignments/${assignment.body.id}/submit`,
      {
        token: intruder,
        body: { text: 'let me in' },
      },
    );
    expect(res.status).toBe(404);
    expect(await db.submission.count({ where: { studentId: other.student.id } })).toBe(0);
    expect(schoolId).not.toBe(other.school.id);
  });
});
