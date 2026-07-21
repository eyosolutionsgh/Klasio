/**
 * Flutterwave adapter (FEATURES.md §8 — diaspora payments). A relative in London or Toronto
 * pays a Ghanaian school bill by card in their own currency; the money settles into the
 * school's own Flutterwave account, exactly as Hubtel and Paystack settle locally.
 *
 * Contract per Flutterwave v3 docs:
 *  - Initiate: POST https://api.flutterwave.com/v3/payments (Bearer secret key),
 *              amount in MAJOR units, returns data.link (hosted checkout).
 *  - Verify:   GET  /v3/transactions/verify_by_reference?tx_ref=…
 *  - Webhook:  the `verif-hash` header must equal the account's configured secret hash —
 *              a shared secret, not an HMAC of the body, per their documentation.
 */
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

const BASE = process.env.FLUTTERWAVE_BASE_URL ?? 'https://api.flutterwave.com';

function mapStatus(s: unknown): ProviderStatus {
  switch (String(s).toLowerCase()) {
    case 'successful':
      return 'SUCCESS';
    case 'failed':
      return 'FAILED';
    case 'cancelled':
      return 'EXPIRED';
    default:
      return 'PENDING';
  }
}

export class FlutterwaveProvider implements PaymentProvider {
  readonly kind = 'FLUTTERWAVE' as const;
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
    if (!res.ok || body.status === 'error') {
      throw new Error(`Flutterwave ${path} failed: ${body.message ?? res.status}`);
    }
    return body;
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const body = await this.call('/v3/payments', {
      method: 'POST',
      body: JSON.stringify({
        tx_ref: input.reference,
        amount: input.amount,
        currency: input.currency,
        redirect_url: input.returnUrl,
        customer: {
          email: input.customerEmail || `${input.reference.toLowerCase()}@no-email.eyo.school`,
          phonenumber: input.customerPhone,
        },
        customizations: { title: input.description },
      }),
    });
    const data = asRecord(body.data);
    return {
      status: 'PENDING',
      providerRef: input.reference,
      checkoutUrl: typeof data.link === 'string' ? data.link : undefined,
      raw: body,
    };
  }

  async verify(ref: { reference: string }): Promise<VerifyResult> {
    const body = await this.call(
      `/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(ref.reference)}`,
    );
    const data = asRecord(body.data);
    return {
      status: mapStatus(data.status),
      amountPaid: typeof data.amount === 'number' ? data.amount : undefined,
      channel: typeof data.payment_type === 'string' ? data.payment_type : undefined,
      providerRef: data.id != null ? String(data.id) : undefined,
      raw: body,
    };
  }

  /**
   * `verif-hash` equals the configured secret hash. We store that hash in `merchantNumber` (the
   * spare credential slot) so the secret key and the webhook hash stay independent, as they are
   * in Flutterwave's own dashboard.
   */
  verifyWebhookSignature(headers: Record<string, string | undefined>, _rawBody: Buffer): boolean {
    const given = headers['verif-hash'];
    const expected = this.creds.merchantNumber;
    if (!given || !expected) return false;
    return safeEqual(expected, given);
  }

  parseWebhook(payload: unknown): ParsedWebhook | null {
    const body = asRecord(payload);
    const data = asRecord(body.data);
    const reference = typeof data.tx_ref === 'string' ? data.tx_ref : undefined;
    if (!reference) return null;
    return {
      providerEventId: `${String(body.event ?? 'charge')}:${String(data.id ?? reference)}`,
      reference,
      providerRef: data.id != null ? String(data.id) : undefined,
      status: mapStatus(data.status),
      amount: typeof data.amount === 'number' ? data.amount : undefined,
    };
  }
}
