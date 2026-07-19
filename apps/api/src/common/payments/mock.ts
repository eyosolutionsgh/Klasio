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

/**
 * Which module can settle the references this provider mints.
 *
 * A school fee reference lives in `PaymentIntent`, a subscription reference in
 * `SubscriptionInvoice`, and the two are settled by different services on purpose. The checkout
 * page therefore has to be told which one to call back: it used to assume `payments`, so
 * approving a subscription payment answered "Unknown payment reference" and no school could
 * complete an upgrade without a live gateway.
 *
 * Carried in the URL rather than inferred from the reference prefix, so the naming convention
 * of one module is not something the web app has to know about.
 */
export type MockSettleRoute = 'payments' | 'billing';

export class MockProvider implements PaymentProvider {
  readonly kind = 'MOCK' as const;
  readonly signsWebhooks = true;

  constructor(private readonly settleVia: MockSettleRoute = 'payments') {}

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const base = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';
    return {
      status: 'PENDING',
      providerRef: `mock-${input.reference}`,
      // Points at our own mock checkout page, which posts the synthetic callback.
      checkoutUrl: `${base}/pay/mock/${encodeURIComponent(input.reference)}?via=${this.settleVia}`,
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
