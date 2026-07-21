/**
 * Outbound webhooks — the half of "API access & webhooks" that was missing.
 *
 * The read-only API lets another system ask; this lets Klasio tell. A school running an accounting
 * package wants to hear about a payment when it happens rather than polling every ten minutes for
 * the rest of the term.
 *
 * The load-bearing assertions are the ones about not trusting the receiver: the signature has to
 * be verifiable over the exact bytes, and a school's own endpoint being down must never fail the
 * payment that triggered the call.
 */
import { PrismaClient } from '@prisma/client';
import { createHmac } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

interface Received {
  body: string;
  signature: string | undefined;
  event: string | undefined;
}

describe('outbound webhooks', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;
  let studentId: string;
  let sink: Server;
  let sinkUrl: string;
  let received: Received[] = [];
  /** Flipped to make the receiver fail, which must not affect the payment. */
  let sinkStatus = 200;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;
    studentId = (
      await db.student.findFirstOrThrow({ where: { schoolId, status: 'ACTIVE' } })
    ).id;

    // A real listener rather than a mock: the signature is over the bytes actually sent, so
    // anything that stubs fetch out cannot prove the receiver can verify it.
    sink = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({
          body,
          signature: req.headers['x-klasio-signature'] as string | undefined,
          event: req.headers['x-klasio-event'] as string | undefined,
        });
        res.writeHead(sinkStatus).end();
      });
    });
    await new Promise<void>((r) => sink.listen(0, '127.0.0.1', r));
    sinkUrl = `http://127.0.0.1:${(sink.address() as AddressInfo).port}/hook`;
  });

  afterAll(async () => {
    await db.webhook.deleteMany({ where: { schoolId } });
    await new Promise<void>((r) => sink.close(() => r()));
    await api.close();
    await db.$disconnect();
  });

  it('refuses a plain-http endpoint that is not on the box itself', async () => {
    const res = await call<{ message: string }>(api.baseUrl, 'POST', '/integrations/webhooks', {
      token,
      body: { url: 'http://example.com/hook' },
    });
    // A school's data leaving over plain HTTP is not a trade-off worth offering.
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/https/i);
  });

  it('refuses an event nobody emits', async () => {
    const res = await call(api.baseUrl, 'POST', '/integrations/webhooks', {
      token,
      body: { url: sinkUrl, events: ['payment.recorded', 'nonsense.happened'] },
    });
    expect(res.status).toBe(400);
  });

  it('delivers a signed payment event the receiver can verify', async () => {
    received = [];
    sinkStatus = 200;
    const created = await call<{ id: string; secret: string }>(
      api.baseUrl,
      'POST',
      '/integrations/webhooks',
      { token, body: { url: sinkUrl, events: ['payment.recorded'] } },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    // Shown once, at creation, like an API key.
    expect(created.body.secret).toBeTruthy();

    const paid = await call(api.baseUrl, 'POST', '/fees/payments', {
      token,
      body: { studentId, amount: 25, method: 'CASH' },
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);

    // Dispatch is deliberately not awaited by the payment, so give it a moment to land.
    for (let i = 0; i < 40 && received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(received).toHaveLength(1);
    expect(received[0].event).toBe('payment.recorded');

    // The signature has to verify over the exact bytes, which is what makes a delivery
    // distinguishable from anyone who guessed the URL.
    const expected = createHmac('sha256', created.body.secret)
      .update(received[0].body)
      .digest('hex');
    expect(received[0].signature).toBe(`sha256=${expected}`);
    expect(JSON.parse(received[0].body).data.amount).toBe(25);

    await call(api.baseUrl, 'DELETE', `/integrations/webhooks/${created.body.id}`, { token });
  });

  it('records a failing endpoint without failing the payment', async () => {
    received = [];
    sinkStatus = 500;
    const created = await call<{ id: string }>(api.baseUrl, 'POST', '/integrations/webhooks', {
      token,
      body: { url: sinkUrl },
    });

    const paid = await call(api.baseUrl, 'POST', '/fees/payments', {
      token,
      body: { studentId, amount: 30, method: 'CASH' },
    });
    // The whole point: the school's own endpoint being down cannot roll back money taken at
    // the counter.
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);

    for (let i = 0; i < 40 && received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    // And the failure is visible in settings rather than only in logs the school cannot read.
    for (let i = 0; i < 40; i++) {
      const row = await db.webhook.findUnique({ where: { id: created.body.id } });
      if (row?.lastStatus === 500) {
        expect(row.lastError).toContain('500');
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('the failing delivery was never recorded on the webhook');
  });

  it('does not deliver an event the school did not subscribe to', async () => {
    received = [];
    sinkStatus = 200;
    await db.webhook.deleteMany({ where: { schoolId } });
    await call(api.baseUrl, 'POST', '/integrations/webhooks', {
      token,
      body: { url: sinkUrl, events: ['student.enrolled'] },
    });

    await call(api.baseUrl, 'POST', '/fees/payments', {
      token,
      body: { studentId, amount: 15, method: 'CASH' },
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(received).toHaveLength(0);
  });
});
