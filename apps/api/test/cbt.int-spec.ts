/**
 * Computer-based tests, end to end: bank → questions → exam → a pupil sits it → auto-marking →
 * posting into the gradebook as an ordinary Score row. The pupil's paper must never carry the
 * correct answers, scores must stay hidden until the exam closes, and a second submit must
 * return the first result rather than a second chance.
 */
import { PrismaClient } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jwtSecret } from '../src/common/auth';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

describe('computer-based tests', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;
  let classId: string;
  let subjectId: string;
  let levelId: string;
  let studentToken: string;
  let studentId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;
    const student = await db.student.findFirstOrThrow({
      where: { schoolId, status: 'ACTIVE', classId: { not: null } },
      include: { classRoom: true },
    });
    studentId = student.id;
    classId = student.classId!;
    levelId = student.classRoom!.levelId;
    subjectId = (await db.subject.findFirstOrThrow({ where: { schoolId } })).id;
    studentToken = jwt.sign(
      {
        sub: student.id,
        schoolId,
        kind: 'student',
        name: `${student.firstName} ${student.lastName}`,
      },
      jwtSecret(),
      { expiresIn: '1d' },
    );
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  it('runs the whole lifecycle', async () => {
    const bank = await call<{ id: string }>(api.baseUrl, 'POST', '/exams/banks', {
      token,
      body: { subjectId, levelId, name: 'CBT spec bank' },
    });
    expect(bank.status, JSON.stringify(bank.body)).toBe(201);

    // Three questions; the exam uses two, so we also prove the same-paper slice.
    const q = async (text: string, correctIndex: number) =>
      call<{ id: string }>(api.baseUrl, 'POST', `/exams/banks/${bank.body.id}/questions`, {
        token,
        body: { text, options: ['Option A', 'Option B', 'Option C'], correctIndex },
      });
    const q1 = await q('First question of the paper?', 0);
    const q2 = await q('Second question of the paper?', 2);
    await q('Never-used third question?', 1);
    expect(q1.status).toBe(201);

    const exam = await call<{ id: string }>(api.baseUrl, 'POST', '/exams', {
      token,
      body: {
        title: 'Spec test',
        bankId: bank.body.id,
        classId,
        durationMinutes: 30,
        questionCount: 2,
      },
    });
    expect(exam.status, JSON.stringify(exam.body)).toBe(201);
    await call(api.baseUrl, 'PATCH', `/exams/${exam.body.id}/status`, {
      token,
      body: { status: 'OPEN' },
    });

    // The pupil sees it, starts it, and the paper carries no answers.
    const listed = await call<{ id: string }[]>(api.baseUrl, 'GET', '/student/cbt', {
      token: studentToken,
    });
    expect(listed.body.some((e) => e.id === exam.body.id)).toBe(true);

    const sitting = await call<{
      questions: { id: string; text: string; correctIndex?: number }[];
    }>(api.baseUrl, 'POST', `/student/cbt/${exam.body.id}/start`, { token: studentToken });
    expect(sitting.status, JSON.stringify(sitting.body)).toBe(201);
    expect(sitting.body.questions).toHaveLength(2);
    expect(sitting.body.questions.every((x) => x.correctIndex === undefined)).toBe(true);

    // One right, one wrong.
    const submitted = await call<{ submitted: boolean; total: number }>(
      api.baseUrl,
      'POST',
      `/student/cbt/${exam.body.id}/submit`,
      {
        token: studentToken,
        body: { answers: { [q1.body.id]: 0, [q2.body.id]: 1 } },
      },
    );
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);

    // Score hidden while OPEN, shown once CLOSED.
    const whileOpen = await call<{ id: string; attempt: { score: number | null } }[]>(
      api.baseUrl,
      'GET',
      '/student/cbt',
      { token: studentToken },
    );
    expect(whileOpen.body.find((e) => e.id === exam.body.id)!.attempt!.score).toBeNull();

    // A second submit is the first result, not a second chance.
    const again = await call<{ alreadySubmitted: boolean; score: number }>(
      api.baseUrl,
      'POST',
      `/student/cbt/${exam.body.id}/submit`,
      { token: studentToken, body: { answers: { [q1.body.id]: 0, [q2.body.id]: 2 } } },
    );
    expect(again.body.alreadySubmitted).toBe(true);
    expect(again.body.score).toBe(1);

    await call(api.baseUrl, 'PATCH', `/exams/${exam.body.id}/status`, {
      token,
      body: { status: 'CLOSED' },
    });
    const whenClosed = await call<{ id: string; attempt: { score: number; total: number } }[]>(
      api.baseUrl,
      'GET',
      '/student/cbt',
      { token: studentToken },
    );
    const mine = whenClosed.body.find((e) => e.id === exam.body.id)!;
    expect(mine.attempt.score).toBe(1);
    expect(mine.attempt.total).toBe(2);

    const results = await call<{ attempts: { studentId: string; score: number }[] }>(
      api.baseUrl,
      'GET',
      `/exams/${exam.body.id}/results`,
      { token },
    );
    expect(results.body.attempts.find((a) => a.studentId === studentId)!.score).toBe(1);
  });

  it('posts scores into the gradebook scaled to the component', async () => {
    // Build a component to post into, an exam bound to it, and a submitted attempt.
    const component = await db.assessmentComponent.create({
      data: { schoolId, name: 'CBT spec component', maxScore: 20, subjectId },
    });
    const bank = await db.questionBank.create({
      data: { schoolId, subjectId, levelId, name: 'Post bank' },
    });
    const qq = await db.question.create({
      data: {
        schoolId,
        bankId: bank.id,
        text: 'Only question?',
        options: ['A', 'B'],
        correctIndex: 0,
      },
    });
    const exam = await db.cbtExam.create({
      data: {
        schoolId,
        title: 'Post test',
        bankId: bank.id,
        classId,
        durationMinutes: 10,
        questionCount: 1,
        status: 'OPEN',
        componentId: component.id,
        createdById: 'seed',
      },
    });
    await call(api.baseUrl, 'POST', `/student/cbt/${exam.id}/start`, { token: studentToken });
    await call(api.baseUrl, 'POST', `/student/cbt/${exam.id}/submit`, {
      token: studentToken,
      body: { answers: { [qq.id]: 0 } },
    });

    const posted = await call<{ posted: number }>(api.baseUrl, 'POST', `/exams/${exam.id}/post`, {
      token,
    });
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    expect(posted.body.posted).toBe(1);

    const term = await db.term.findFirstOrThrow({
      where: { isCurrent: true, academicYear: { schoolId, isCurrent: true } },
    });
    const score = await db.score.findUniqueOrThrow({
      where: {
        studentId_subjectId_termId_componentId: {
          studentId,
          subjectId,
          termId: term.id,
          componentId: component.id,
        },
      },
    });
    // 1/1 correct, scaled to maxScore 20.
    expect(score.rawScore).toBe(20);
  });
});
