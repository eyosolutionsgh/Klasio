/**
 * Applicant papers: attach → list → enrol, proving the carry-over. The interesting assertion is
 * the last one — enrolment must move the rows onto the student record over the SAME storage
 * keys, and leave nothing behind on the applicant, or a birth certificate handed in at
 * application would be asked for twice.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

describe('applicant documents', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;
  let applicantId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;

    const level = await db.level.findFirstOrThrow({ where: { schoolId } });
    const applied = await call<{ reference: string }>(
      api.baseUrl,
      'POST',
      `/admissions/apply/${schoolId}`,
      {
        body: {
          firstName: 'Efua',
          lastName: 'Owusu',
          levelId: level.id,
          guardianName: 'Akosua Owusu',
          guardianPhone: '0244555666',
        },
      },
    );
    expect(applied.status, JSON.stringify(applied.body)).toBe(201);
    const row = await db.applicant.findFirstOrThrow({
      where: { schoolId, reference: applied.body.reference },
    });
    applicantId = row.id;
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  it('attaches a paper, lists it, and enrolment carries it onto the student record', async () => {
    const form = new FormData();
    form.append('kind', 'BIRTH_CERTIFICATE');
    form.append(
      'file',
      new File([Buffer.from('%PDF-1.4 test certificate')], 'birth-cert.pdf', {
        type: 'application/pdf',
      }),
    );
    const up = await fetch(`${api.baseUrl}/admissions/${applicantId}/documents`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    expect(up.status, await up.clone().text()).toBe(201);

    const list = await call<{ id: string; kind: string; filename: string }[]>(
      api.baseUrl,
      'GET',
      `/admissions/${applicantId}/documents`,
      { token },
    );
    expect(list.body).toHaveLength(1);
    expect(list.body[0].kind).toBe('BIRTH_CERTIFICATE');

    // Walk the pipeline to ACCEPTED, then enrol.
    for (const stage of ['ASSESSED', 'OFFERED', 'ACCEPTED']) {
      const moved = await call(api.baseUrl, 'POST', `/admissions/${applicantId}/stage`, {
        token,
        body: { stage },
      });
      expect(moved.status, `${stage}: ${JSON.stringify(moved.body)}`).toBe(201);
    }
    const cls = await db.classRoom.findFirstOrThrow({ where: { schoolId } });
    const converted = await call<{ studentId: string }>(
      api.baseUrl,
      'POST',
      `/admissions/${applicantId}/convert`,
      { token, body: { classId: cls.id, dateOfBirth: '2015-03-04', gender: 'FEMALE' } },
    );
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);

    const applicantDoc = await db.applicantDocument.findMany({ where: { applicantId } });
    expect(applicantDoc).toHaveLength(0);
    const studentDocs = await db.studentDocument.findMany({
      where: { studentId: converted.body.studentId },
    });
    expect(studentDocs).toHaveLength(1);
    expect(studentDocs[0].kind).toBe('BIRTH_CERTIFICATE');
    expect(studentDocs[0].filename).toBe('birth-cert.pdf');
  });
});
