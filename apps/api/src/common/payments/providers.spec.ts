import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import { PaystackProvider } from './paystack';
import { HubtelProvider } from './hubtel';
import { MockProvider, MOCK_SECRET } from './mock';

const SECRET = 'sk_test_abc123';

describe('Paystack webhook signature', () => {
  const p = new PaystackProvider({ secret: SECRET });
  const body = Buffer.from(
    JSON.stringify({ event: 'charge.success', data: { reference: 'ONL-1' } }),
  );

  it('accepts a correct HMAC-SHA512 over the raw body', () => {
    const sig = createHmac('sha512', SECRET).update(body).digest('hex');
    expect(p.verifyWebhookSignature({ 'x-paystack-signature': sig }, body)).toBe(true);
  });

  it('rejects a forged signature', () => {
    expect(p.verifyWebhookSignature({ 'x-paystack-signature': 'deadbeef' }, body)).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(p.verifyWebhookSignature({}, body)).toBe(false);
  });

  it('rejects a signature computed over different bytes', () => {
    const sig = createHmac('sha512', SECRET).update(Buffer.from('{}')).digest('hex');
    expect(p.verifyWebhookSignature({ 'x-paystack-signature': sig }, body)).toBe(false);
  });

  it('parses charge.success into a settlement instruction', () => {
    const parsed = p.parseWebhook({
      event: 'charge.success',
      data: { reference: 'ONL-1', id: 99, amount: 15000, status: 'success' },
    });
    expect(parsed).toMatchObject({ reference: 'ONL-1', status: 'SUCCESS', amount: 150 });
    // Event id must be stable so replays dedupe.
    expect(parsed?.providerEventId).toBe('charge.success:99');
  });

  it('returns null for an unrecognised payload', () => {
    expect(p.parseWebhook({ nonsense: true })).toBeNull();
  });
});

describe('Hubtel (unsigned callbacks)', () => {
  const h = new HubtelProvider({ secret: 'cs', publicKey: 'cid', merchantNumber: '12345' });

  it('declares that it does not sign webhooks', () => {
    // This is what forces the payments service down the authoritative re-query path.
    expect(h.signsWebhooks).toBe(false);
    expect(h.verifyWebhookSignature()).toBe(false);
  });

  it('parses a successful callback', () => {
    const parsed = h.parseWebhook({
      ResponseCode: '0000',
      Status: 'Success',
      Data: { CheckoutId: 'chk_1', ClientReference: 'ONL-2', Amount: 250 },
    });
    expect(parsed).toMatchObject({ reference: 'ONL-2', status: 'SUCCESS', amount: 250 });
    expect(parsed?.providerEventId).toBe('hubtel:chk_1');
  });

  it('marks a non-0000 callback as failed', () => {
    const parsed = h.parseWebhook({
      ResponseCode: '2001',
      Data: { CheckoutId: 'chk_2', ClientReference: 'ONL-3' },
    });
    expect(parsed?.status).toBe('FAILED');
  });
});

describe('Mock provider', () => {
  const m = new MockProvider();

  it('signs and verifies its synthetic callbacks', () => {
    const body = Buffer.from(JSON.stringify({ event: 'charge.success', reference: 'ONL-9' }));
    const sig = createHmac('sha512', MOCK_SECRET).update(body).digest('hex');
    expect(m.verifyWebhookSignature({ 'x-mock-signature': sig }, body)).toBe(true);
    expect(m.verifyWebhookSignature({ 'x-mock-signature': 'nope' }, body)).toBe(false);
  });

  it('issues a checkout url and reports success on verify', async () => {
    const init = await m.initiate({
      reference: 'ONL-9',
      amount: 10,
      currency: 'GHS',
      description: 'test',
      channel: 'MOMO',
      callbackUrl: 'http://x/cb',
      returnUrl: 'http://x/ret',
    });
    expect(init.checkoutUrl).toContain('/pay/mock/ONL-9');
    expect(init.status).toBe('PENDING');
    expect((await m.verify({ reference: 'ONL-9' })).status).toBe('SUCCESS');
  });
});
