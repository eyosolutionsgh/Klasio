/**
 * The regulator-facing exports, and the CSSPS choices behind one of them.
 *
 * These replace a clerk retyping the roll from a paper register, so the assertions are about the
 * content being right rather than the file merely existing: a WAEC sheet that silently omits the
 * unchecked names, or a register that quietly drops the children who left, would be worse than
 * no export at all — it looks finished.
 *
 * CsspsChoice is a new tenant table, so the last test is the RLS one.
 */
import { PrismaClient } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jwtSecret } from '../src/common/auth';
import { Api, call, ownerDb, otherSchool, seededSchool, startApi } from './setup/harness';

/** The exports stream binary; CSV is the readable one, so the assertions use it. */
async function csv(baseUrl: string, path: string, token: string): Promise<string> {
  const res = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  expect(res.status, `${path} → ${res.status}`).toBe(200);
  return res.text();
}

describe('regulator exports', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;
  let classId: string;
  let termId: string;
  let studentId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;

    const term = await db.term.findFirstOrThrow({
      where: { academicYear: { schoolId }, isCurrent: true },
    });
    termId = term.id;
    const scored = await db.score.findFirstOrThrow({
      where: { schoolId, termId, student: { status: 'ACTIVE', classId: { not: null } } },
      include: { student: true },
    });
    classId = scored.student.classId as string;
    studentId = scored.studentId;
  });

  afterAll(async () => {
    await db.csspsChoice.deleteMany({ where: { schoolId } });
    await api.close();
    await db.$disconnect();
  });

  it('lists WAEC candidates and flags the names nobody has checked', async () => {
    await db.student.update({ where: { id: studentId }, data: { certificateName: null } });
    const sheet = await csv(
      api.baseUrl,
      `/compliance/waec/candidates?classId=${classId}&format=csv`,
      token,
    );
    expect(sheet).toContain('Name on birth certificate');
    // The whole point of the sheet: a name nobody verified is called out, not left blank, because
    // a mismatch blocks the candidate and is always found too late.
    expect(sheet).toContain('NOT CHECKED');

    await db.student.update({
      where: { id: studentId },
      data: { certificateName: 'Ama Serwaa MENSAH' },
    });
    const after = await csv(
      api.baseUrl,
      `/compliance/waec/candidates?classId=${classId}&format=csv`,
      token,
    );
    expect(after).toContain('Ama Serwaa MENSAH');
  });

  it('exports the SBA marks that make up the 30 per cent', async () => {
    // Reports have to exist for there to be marks to submit.
    const generated = await call(api.baseUrl, 'POST', '/assessment/reports/generate', {
      token,
      body: { classId, termId, regeneratePublished: true },
    });
    expect(generated.status, JSON.stringify(generated.body)).toBe(201);

    const sheet = await csv(
      api.baseUrl,
      `/compliance/waec/sba?classId=${classId}&termId=${termId}&format=csv`,
      token,
    );
    // Headers name the school's own weighting rather than assuming 30/70, since it is adjustable.
    expect(sheet).toMatch(/SBA \(of \d+\)/);
    expect(sheet.split('\n').length).toBeGreaterThan(2);
  });

  it('counts the census by class, sex and age at the census date', async () => {
    const sheet = await csv(api.baseUrl, '/compliance/emis/census?format=csv&asOf=2026-10-01', token);
    expect(sheet).toContain('Youngest');
    expect(sheet).toContain('TOTAL');
    // Staff appear with their licence state named rather than left blank — a blank reads as
    // "no licence needed", which is the opposite of what an inspector should conclude.
    expect(sheet).toContain('NTC number not recorded');
  });

  it('keeps children who have left on the admission register', async () => {
    const leaver = await db.student.findFirst({
      where: { schoolId, status: { not: 'ACTIVE' } },
    });
    const sheet = await csv(api.baseUrl, '/compliance/admission-register?format=csv', token);
    expect(sheet).toContain('Admission No');
    if (leaver) {
      // The register is permanent: a child who withdrew is still a numbered line in it.
      expect(sheet).toContain(leaver.admissionNo);
    }
    // Ordered by admission number, because the sequence is what makes it a register.
    const numbers = sheet
      .split('\n')
      .slice(1)
      .map((l) => l.split(',')[0].replace(/"/g, ''))
      .filter(Boolean);
    expect([...numbers].sort()).toEqual(numbers);
  });

  it('records a candidate’s eight CSSPS choices and refuses a duplicated rank', async () => {
    const set = await call<{ maxChoices: number; choices: unknown[] }>(
      api.baseUrl,
      'POST',
      `/compliance/cssps/${studentId}`,
      {
        token,
        body: {
          choices: [
            { rank: 1, schoolName: 'Achimota School', programme: 'General Science', category: 'A', residency: 'Boarding' },
            { rank: 2, schoolName: 'Presec Legon', programme: 'General Science', category: 'A', residency: 'Boarding' },
            { rank: 3, schoolName: 'Accra Academy', programme: 'General Arts', category: 'B', residency: 'Day' },
          ],
        },
      },
    );
    expect(set.status, JSON.stringify(set.body)).toBe(201);
    expect(set.body.maxChoices).toBe(8);
    expect(set.body.choices).toHaveLength(3);

    const clash = await call(api.baseUrl, 'POST', `/compliance/cssps/${studentId}`, {
      token,
      body: {
        choices: [
          { rank: 1, schoolName: 'Achimota School' },
          { rank: 1, schoolName: 'Presec Legon' },
        ],
      },
    });
    expect(clash.status).not.toBe(201);
  });

  it('shows on the selection sheet how many choices are still missing', async () => {
    const sheet = await csv(api.baseUrl, `/compliance/cssps/export/${classId}?format=csv`, token);
    expect(sheet).toContain('Choice 8');
    // An incomplete list is what costs a candidate a placement, and it is invisible by eye in a
    // row of mostly-filled cells.
    expect(sheet).toContain('3 of 8');
    expect(sheet).toContain('Achimota School');
  });

  /** A missing RLS policy on a new tenant table fails open, and silently. */
  it("cannot read another school's CSSPS choices", async () => {
    const other = await otherSchool(db);
    const otherToken = jwt.sign(
      {
        sub: other.owner.id,
        schoolId: other.school.id,
        role: 'OWNER',
        tier: other.school.tier,
        name: other.owner.name,
      },
      jwtSecret(),
      { expiresIn: '1d' },
    );
    const res = await call(api.baseUrl, 'GET', `/compliance/cssps/${studentId}`, {
      token: otherToken,
    });
    // Not their child, so the whole record is refused rather than returning an empty list that
    // would read as "this candidate has chosen nothing".
    expect(res.status).toBe(404);
  });
});
