/**
 * Mock gateway — used when a school has connected no GatewayAccount (dev, tests, demos).
 * Mirrors the SMS module's mock-fallback pattern so the whole payment flow is exercisable
 * without gateway credentials and without moving real money.
 *
 * Checkout "happens" at POST /payments/mock/:reference/complete, which synthesises the same
 * callback a real gateway would send — so the code path under test is the production one.
 */
import { createHmac } from 'crypto';
import { safeEqual } from '../crypto';
import {
  asRecord,
  InitiateInput,
  InitiateResult,
  ParsedWebhook,
  PaymentProvider,
  VerifyResult,
} from './provider';

export const MOCK_SECRET = 'mock-gateway-secret';

export class MockProvider implements PaymentProvider {
  readonly kind = 'MOCK' as const;
  readonly signsWebhooks = true;

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    return {
      status: 'PENDING',
      providerRef: `mock-${input.reference}`,
      // Points at our own mock checkout page, which posts the synthetic callback.
      checkoutUrl: `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'}/pay/mock/${encodeURIComponent(input.reference)}`,
    };
  }

  /**
   * Deliberately reports SUCCESS: the mock has no external state to consult, so a re-query
   * settles the intent. Real gateways return their true state.
   */
  async verify(ref: { reference: string }): Promise<VerifyResult> {
    return { status: 'SUCCESS', providerRef: `mock-${ref.reference}` };
  }

  verifyWebhookSignature(headers: Record<string, string | undefined>, rawBody: Buffer): boolean {
    const sig = headers['x-mock-signature'];
    if (!sig) return false;
    return safeEqual(createHmac('sha512', MOCK_SECRET).update(rawBody).digest('hex'), sig);
  }

  parseWebhook(payload: unknown): ParsedWebhook | null {
    const body = asRecord(payload);
    const reference = typeof body.reference === 'string' ? body.reference : undefined;
    if (!reference) return null;
    return {
      providerEventId: `mock:${reference}:${String(body.event ?? 'charge.success')}`,
      reference,
      providerRef: `mock-${reference}`,
      status: body.event === 'charge.failed' ? 'FAILED' : 'SUCCESS',
      amount: typeof body.amount === 'number' ? body.amount : undefined,
    };
  }
}
