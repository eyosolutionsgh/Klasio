/**
 * The public payment surface: gateway webhook, pay link, payer's return page.
 *
 * These are the routes that broke when row-level security landed. None of them carries a
 * principal, so no tenant is in scope, so the policies hid the PaymentIntent and the API
 * answered 404 — a parent's money left their wallet and never reached the ledger. Typecheck,
 * lint and the unit suite were all green throughout.
 *
 * Every assertion below therefore reads through the OWNER client. Checking a write through the
 * tenant-scoped client could not distinguish "never written" from "hidden from me", which is
 * exactly the confusion that let the bug ship.
 */
import { createHmac } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOCK_SECRET } from '../src/common/payments/mock';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

describe('public payment surface', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;
  let studentId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;
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

  /** A staff member raising a pay link for a guardian — the authenticated half of the flow. */
  async function createIntent(amount: number) {
    const res = await call<{ reference: string; payUrl: string }>(
      api.baseUrl,
      'POST',
      '/payments/link',
      { token, body: { studentId, channel: 'MOMO', amount, provider: 'MOCK' } },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  }

  /** The exact bytes a gateway would POST, signed the way the gateway signs them. */
  function signedCallback(reference: string, amount: number, event = 'charge.success') {
    const raw = Buffer.from(JSON.stringify({ event, reference, amount }));
    const signature = createHmac('sha512', MOCK_SECRET).update(raw).digest('hex');
    return { raw, headers: { 'x-mock-signature': signature } };
  }

  it('settles exactly one ledger entry, and a redelivery does not duplicate it', async () => {
    const amount = 137.5;
    const { reference } = await createIntent(amount);

    const { raw, headers } = signedCallback(reference, amount);
    const first = await call<{ ok: boolean; applied: boolean }>(
      api.baseUrl,
      'POST',
      '/payments/webhook/mock',
      // No token: a gateway has no login. This is the whole point of the test.
      { raw, headers },
    );
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.applied).toBe(true);

    const entries = await db.ledgerEntry.findMany({ where: { reference } });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('PAYMENT');
    expect(Number(entries[0].amount)).toBe(amount);
    expect(entries[0].schoolId).toBe(schoolId);
    expect(entries[0].studentId).toBe(studentId);

    // A receipt is the parent's proof the money arrived; it is part of settling, not a nicety.
    const receipts = await db.receipt.findMany({ where: { ledgerEntryId: entries[0].id } });
    expect(receipts).toHaveLength(1);

    expect((await db.paymentIntent.findFirstOrThrow({ where: { reference } })).status).toBe(
      'SUCCESS',
    );

    // Gateways redeliver on any doubt about the first response. Byte-identical replay.
    const replay = await call<{ ok: boolean; duplicate?: boolean }>(
      api.baseUrl,
      'POST',
      '/payments/webhook/mock',
      { raw, headers },
    );
    expect(replay.status).toBe(201);
    expect(replay.body.duplicate).toBe(true);

    expect(await db.ledgerEntry.count({ where: { reference } })).toBe(1);
    expect(await db.receipt.count({ where: { ledgerEntryId: entries[0].id } })).toBe(1);
  });

  it('refuses a webhook whose signature does not verify, and writes nothing', async () => {
    const { reference } = await createIntent(80);
    const raw = Buffer.from(JSON.stringify({ event: 'charge.success', reference, amount: 80 }));

    const res = await call(api.baseUrl, 'POST', '/payments/webhook/mock', {
      raw,
      headers: { 'x-mock-signature': 'deadbeef' },
    });
    expect(res.status).toBe(401);

    expect(await db.ledgerEntry.count({ where: { reference } })).toBe(0);
    // Nothing is persisted before the event is proven genuine — otherwise a forged callback
    // could burn the event id and make the real one look like a replay.
    expect(await db.webhookEvent.count({ where: { reference } })).toBe(0);
    expect((await db.paymentIntent.findFirstOrThrow({ where: { reference } })).status).toBe(
      'PENDING',
    );
  });

  it('serves the public pay page and the payer return page without a principal', async () => {
    const amount = 42;
    const { reference, payUrl } = await createIntent(amount);
    const payToken = payUrl.split('/pay/')[1];

    // The pay page the guardian opens from an SMS link.
    const page = await call<{ reference: string; school: { name: string } }>(
      api.baseUrl,
      'GET',
      `/payments/public/${payToken}`,
    );
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    expect(page.body.reference).toBe(reference);
    expect(page.body.school.name).toBe('Brighton Academy');

    // The page the gateway returns the payer to afterwards.
    const status = await call<{ reference: string; status: string }>(
      api.baseUrl,
      'GET',
      `/payments/${reference}/status`,
    );
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ reference, status: 'PENDING' });
  });

  it('starts checkout from a public pay link and persists the payer phone', async () => {
    const { reference, payUrl } = await createIntent(64);
    const payToken = payUrl.split('/pay/')[1];

    // A write on a route with no principal: the update is tenant-owned, so outside a tenant
    // scope the policy refuses it and the guardian can never start paying.
    const res = await call<{ reference: string; checkoutUrl: string }>(
      api.baseUrl,
      'POST',
      `/payments/public/${payToken}/checkout`,
      { body: { phone: '0244000111' } },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.reference).toBe(reference);
    expect(res.body.checkoutUrl).toBeTruthy();

    const intent = await db.paymentIntent.findFirstOrThrow({ where: { reference } });
    expect(intent.payerPhone).toBe('0244000111');
  });
});
