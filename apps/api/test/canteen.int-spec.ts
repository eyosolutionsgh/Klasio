/**
 * The canteen wallet, proved against a live database as the non-owner role. The balance is derived
 * from an append-only ledger, so the interesting assertions are arithmetic: a reversal must undo
 * exactly what it points at, and a spend must never exceed the balance. The negative half proves a
 * wallet in another school cannot be topped up across the tenant line.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, otherSchool, seededSchool, startApi } from './setup/harness';

describe('canteen wallet', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let studentId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    const student = await db.student.findFirstOrThrow({
      where: { schoolId: seeded.school.id, status: 'ACTIVE' },
    });
    studentId = student.id;
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  it('top up, spend, and a reversal that undoes exactly what it cancels', async () => {
    const top = await call<{ balance: number }>(api.baseUrl, 'POST', '/canteen/topup', {
      token,
      body: { studentId, amount: 50 },
    });
    expect(top.status, JSON.stringify(top.body)).toBe(201);
    expect(top.body.balance).toBe(50);

    const spend = await call<{ balance: number; id: string }>(
      api.baseUrl,
      'POST',
      '/canteen/spend',
      {
        token,
        body: { studentId, amount: 12.5, note: 'Lunch' },
      },
    );
    expect(spend.status, JSON.stringify(spend.body)).toBe(201);
    expect(spend.body.balance).toBe(37.5);

    // Spending more than the balance is refused, not allowed to go negative.
    const over = await call(api.baseUrl, 'POST', '/canteen/spend', {
      token,
      body: { studentId, amount: 100 },
    });
    expect(over.status).toBe(400);

    // Reversing the lunch returns exactly its amount — balance back to 50.
    const rev = await call<{ balance: number }>(
      api.baseUrl,
      'POST',
      `/canteen/txns/${spend.body.id}/reverse`,
      { token },
    );
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    expect(rev.body.balance).toBe(50);

    // The same entry cannot be reversed twice.
    const twice = await call(api.baseUrl, 'POST', `/canteen/txns/${spend.body.id}/reverse`, {
      token,
    });
    expect(twice.status).toBe(400);

    const wallet = await call<{ balance: number }>(api.baseUrl, 'GET', `/canteen/${studentId}`, {
      token,
    });
    expect(wallet.body.balance).toBe(50);
  });

  it('a wallet in another school cannot be topped up across the tenant line', async () => {
    const other = await otherSchool(db);
    const res = await call(api.baseUrl, 'POST', '/canteen/topup', {
      token,
      body: { studentId: other.student.id, amount: 20 },
    });
    expect(res.status).toBe(404);
    expect(await db.canteenTxn.count({ where: { studentId: other.student.id } })).toBe(0);
  });
});
