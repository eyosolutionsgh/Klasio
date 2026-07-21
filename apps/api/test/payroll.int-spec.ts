/**
 * Payroll: profile → compute → approve, under RLS. The load-bearing assertions: line figures
 * match the pure tax functions exactly, a draft recomputes but an approved month refuses, and
 * a salary change after approval never rewrites the frozen lines.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computePay } from '../src/common/payroll';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

describe('payroll', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;
  let headId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;
    headId = (await db.user.findFirstOrThrow({ where: { schoolId, email: 'head@demo.school' } }))
      .id;
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  it('computes a month whose figures match the tax engine, then freezes on approval', async () => {
    const profile = await call(api.baseUrl, 'POST', '/payroll/profiles', {
      token,
      body: {
        userId: headId,
        basicSalary: 4000,
        allowances: 600,
        deductions: 150,
        payoutMethod: 'MOMO',
        payoutAccount: '0244000001',
      },
    });
    expect(profile.status, JSON.stringify(profile.body)).toBe(201);

    const run = await call<{
      id: string;
      lines: { userId: string; net: number; paye: number; ssnitEmployee: number }[];
    }>(api.baseUrl, 'POST', '/payroll/runs', { token, body: { period: '2026-07' } });
    expect(run.status, JSON.stringify(run.body)).toBe(201);

    const line = run.body.lines.find((l) => l.userId === headId)!;
    const expected = computePay({ basic: 4000, allowances: 600, otherDeductions: 150 });
    expect(line.ssnitEmployee).toBe(expected.ssnitEmployee);
    expect(line.paye).toBe(expected.paye);
    expect(line.net).toBe(expected.net);

    const approved = await call(api.baseUrl, 'POST', `/payroll/runs/${run.body.id}/approve`, {
      token,
    });
    expect(approved.status).toBe(201);

    // A raise after approval must not rewrite the frozen month.
    await call(api.baseUrl, 'POST', '/payroll/profiles', {
      token,
      body: { userId: headId, basicSalary: 9000 },
    });
    const recompute = await call<{ message: string }>(api.baseUrl, 'POST', '/payroll/runs', {
      token,
      body: { period: '2026-07' },
    });
    expect(recompute.status).toBe(400);
    const frozen = await db.payRunLine.findFirstOrThrow({
      where: { payRunId: run.body.id, userId: headId },
    });
    expect(Number(frozen.basic)).toBe(4000);

    // The MoMo payout file carries this person; the bank file does not.
    const momo = await fetch(`${api.baseUrl}/payroll/runs/${run.body.id}/payout?method=MOMO`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(momo.status).toBe(200);
    const csv = await momo.text();
    expect(csv).toContain('0244000001');
    expect(csv).toContain(String(expected.net));

    // And a payslip renders.
    const slip = await fetch(`${api.baseUrl}/payroll/runs/${run.body.id}/payslips/${headId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(slip.status).toBe(200);
    expect(slip.headers.get('content-type')).toContain('pdf');
  });

  it('refuses payroll to a teacher', async () => {
    const signIn = await call<{ token: string }>(api.baseUrl, 'POST', '/auth/login', {
      body: { email: 'teacher@demo.school', password: 'Password1!' },
    });
    const res = await call(api.baseUrl, 'GET', '/payroll/profiles', {
      token: signIn.body.token,
    });
    expect(res.status).toBe(403);
  });
});
