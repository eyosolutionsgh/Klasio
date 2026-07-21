/**
 * Paystack adapter (Ghana + Nigeria).
 *
 * Contract per Paystack docs:
 *  - Initialize:  POST https://api.paystack.co/transaction/initialize  (Bearer secret key)
 *                 amount is in MINOR units (pesewas/kobo); returns data.authorization_url
 *  - Verify:      GET  https://api.paystack.co/transaction/verify/:reference
 *  - Webhook:     HMAC-SHA512 of the RAW body keyed by the secret key, compared to the
 *                 `x-paystack-signature` header.
 */
import { createHmac } from 'crypto';
import { safeEqual } from '../crypto';
import {
  asRecord,
  InitiateInput,
  InitiateResult,
  ParsedWebhook,
  PaymentProvider,
  ProviderCredentials,
  ProviderStatus,
  VerifyResult,
} from './provider';
import { asResponse } from '../http';

const BASE = process.env.PAYSTACK_BASE_URL ?? 'https://api.paystack.co';

const CHANNELS: Record<string, string[]> = {
  MOMO: ['mobile_money'],
  CARD: ['card'],
  USSD: ['ussd'],
};

function mapStatus(s: unknown): ProviderStatus {
  switch (String(s)) {
    case 'success':
      return 'SUCCESS';
    case 'failed':
    case 'reversed':
      return 'FAILED';
    case 'abandoned':
      return 'EXPIRED';
    default:
      return 'PENDING';
  }
}

export class PaystackProvider implements PaymentProvider {
  readonly kind = 'PAYSTACK' as const;
  readonly signsWebhooks = true;

  constructor(private creds: ProviderCredentials) {}

  private async call(path: string, init?: RequestInit) {
    const res = asResponse(
      await fetch(`${BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.creds.secret}`,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
      }),
    );
    const body = asRecord(await res.json().catch(() => ({})));
    if (!res.ok || body.status === false) {
      throw new Error(`Paystack ${path} failed: ${body.message ?? res.status}`);
    }
    return body;
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const body = await this.call('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        // Paystack requires an email; guardians often have none, so fall back to a
        // non-routable placeholder keyed by our reference.
        email: input.customerEmail || `${input.reference.toLowerCase()}@no-email.eyo.school`,
        amount: Math.round(input.amount * 100),
        currency: input.currency,
        reference: input.reference,
        callback_url: input.returnUrl,
        channels: CHANNELS[input.channel] ?? undefined,
        metadata: { description: input.description, phone: input.customerPhone },
        ...(this.creds.subaccountCode ? { subaccount: this.creds.subaccountCode } : {}),
      }),
    });
    const data = asRecord(body.data);
    return {
      status: 'PENDING',
      providerRef: typeof data.reference === 'string' ? data.reference : input.reference,
      checkoutUrl: typeof data.authorization_url === 'string' ? data.authorization_url : undefined,
      raw: body,
    };
  }

  async verify(ref: { reference: string }): Promise<VerifyResult> {
    const body = await this.call(`/transaction/verify/${encodeURIComponent(ref.reference)}`);
    const data = asRecord(body.data);
    return {
      status: mapStatus(data.status),
      amountPaid: typeof data.amount === 'number' ? data.amount / 100 : undefined,
      channel: typeof data.channel === 'string' ? data.channel : undefined,
      providerRef: data.id != null ? String(data.id) : undefined,
      raw: body,
    };
  }

  verifyWebhookSignature(headers: Record<string, string | undefined>, rawBody: Buffer): boolean {
    const sig = headers['x-paystack-signature'];
    if (!sig) return false;
    const expected = createHmac('sha512', this.creds.secret).update(rawBody).digest('hex');
    return safeEqual(expected, sig);
  }

  parseWebhook(payload: unknown): ParsedWebhook | null {
    const body = asRecord(payload);
    const data = asRecord(body.data);
    const reference = typeof data.reference === 'string' ? data.reference : undefined;
    if (!reference) return null;
    // Paystack sends no event-id header; (event name + transaction id) is stable per event.
    const providerEventId = `${String(body.event ?? 'event')}:${String(data.id ?? reference)}`;
    return {
      providerEventId,
      reference,
      providerRef: data.id != null ? String(data.id) : undefined,
      status: body.event === 'charge.success' ? 'SUCCESS' : mapStatus(data.status),
      amount: typeof data.amount === 'number' ? data.amount / 100 : undefined,
    };
  }
}
