/**
 * Separation of duties on bank deposits — the half of the promise that was never written.
 *
 * FEATURES.md §17 says "an accounts clerk can record a payment but cannot confirm their own bank
 * deposits", and the permission catalogue splits `fees.deposit_submit` from `fees.deposits` to
 * carry exactly that. The service, however, never compared the reviewer to `submittedById`, so
 * anyone holding both codes — every OWNER and BURSAR by default — could bank nothing, claim a
 * deposit, and confirm it into the ledger themselves.
 *
 * The tests deliberately act as the OWNER, who holds every permission there is. A refusal from
 * this account cannot be a permission error, which is the only way to prove the separation guard
 * itself is doing the work rather than the RBAC grid incidentally covering for it.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';
import { signToken } from '../src/common/auth';

describe('bank deposit separation of duties', () => {
  let api: Api;
  let db: PrismaClient;
  let ownerToken: string;
  let bursarToken: string;
  let schoolId: string;
  let studentId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    ownerToken = seeded.token;
    schoolId = seeded.school.id;

    // A second reviewer who is not the submitter — the person the guard should let through.
    const bursar = await db.user.findFirstOrThrow({
      where: { schoolId, role: 'BURSAR' },
    });
    bursarToken = signToken({
      sub: bursar.id,
      schoolId,
      role: bursar.role,
      tier: seeded.school.tier,
      name: bursar.name,
    });

    const student = await db.student.findFirstOrThrow({
      where: { schoolId, status: 'ACTIVE' },
      orderBy: { admissionNo: 'asc' },
    });
    studentId = student.id;
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  /** Lodge a deposit as a given actor and hand back its id. */
  async function submit(token: string, amount: number) {
    const res = await call<{ id: string; reference: string }>(api.baseUrl, 'POST', '/fees/deposits', {
      token,
      body: {
        studentId,
        amount,
        bankName: 'GCB',
        bankRef: `SLIP-${amount}`,
        depositedAt: new Date().toISOString(),
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id;
  }

  it('refuses to let the submitter confirm their own deposit', async () => {
    const id = await submit(ownerToken, 1234);

    const res = await call(api.baseUrl, 'POST', `/fees/deposits/${id}/confirm`, {
      token: ownerToken,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);

    // The refusal has to be real, not cosmetic: no money may have moved.
    const deposit = await db.bankDeposit.findUniqueOrThrow({ where: { id } });
    expect(deposit.status).toBe('PENDING');
    const entry = await db.ledgerEntry.findUnique({
      where: { schoolId_reference: { schoolId, reference: deposit.reference } },
    });
    expect(entry).toBeNull();
  });

  it('refuses to let the submitter reject their own deposit', async () => {
    const id = await submit(ownerToken, 2345);

    const res = await call(api.baseUrl, 'POST', `/fees/deposits/${id}/reject`, {
      token: ownerToken,
      body: { reason: 'changed my mind' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);

    // Rejecting your own entry hides a payment as effectively as confirming a fictitious one.
    const deposit = await db.bankDeposit.findUniqueOrThrow({ where: { id } });
    expect(deposit.status).toBe('PENDING');
  });

  it('lets a different reviewer confirm the deposit, and money then moves', async () => {
    const id = await submit(ownerToken, 3456);

    const res = await call<{ confirmed: boolean }>(
      api.baseUrl,
      'POST',
      `/fees/deposits/${id}/confirm`,
      { token: bursarToken },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.confirmed).toBe(true);

    const deposit = await db.bankDeposit.findUniqueOrThrow({ where: { id } });
    expect(deposit.status).toBe('CONFIRMED');
    const entry = await db.ledgerEntry.findUniqueOrThrow({
      where: { schoolId_reference: { schoolId, reference: deposit.reference } },
    });
    expect(entry.type).toBe('PAYMENT');
    expect(Number(entry.amount)).toBe(3456);
  });

  it('lets a different reviewer reject the deposit', async () => {
    const id = await submit(ownerToken, 4567);

    const res = await call(api.baseUrl, 'POST', `/fees/deposits/${id}/reject`, {
      token: bursarToken,
      body: { reason: 'slip does not match the amount claimed' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const deposit = await db.bankDeposit.findUniqueOrThrow({ where: { id } });
    expect(deposit.status).toBe('REJECTED');
    expect(deposit.reviewNote).toContain('does not match');
  });
});
