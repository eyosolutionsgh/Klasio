/**
 * Hubtel adapter (Ghana-first: MoMo + cards + USSD).
 *
 * Contract per Hubtel's Online Checkout API reference:
 *  - Initiate: POST https://payproxyapi.hubtel.com/items/initiate
 *              Basic auth (clientId:clientSecret); body { totalAmount, description,
 *              callbackUrl, returnUrl, cancellationUrl, merchantAccountNumber,
 *              clientReference }; success is responseCode "0000" with
 *              data.checkoutUrl / data.checkoutId.
 *  - Callback: POST to callbackUrl with { ResponseCode, Status, Data: { CheckoutId,
 *              ClientReference, Amount, CustomerPhoneNumber, PaymentDetails, ... } }.
 *
 * ⚠ SECURITY: Hubtel does NOT sign callbacks (no HMAC header), so `signsWebhooks` is false.
 * The payments service therefore treats a Hubtel callback purely as a TRIGGER and re-queries
 * `verify()` server-to-server before any money is written to the ledger. Never trust the
 * callback body's amount/status on its own.
 *
 * The exact status-check path and field casing should be confirmed against sandbox
 * credentials; because settlement is gated on verify(), a field-name drift fails closed
 * (payment stays PENDING) rather than crediting wrongly.
 */
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

const CHECKOUT_BASE = process.env.HUBTEL_CHECKOUT_URL ?? 'https://payproxyapi.hubtel.com';
const STATUS_BASE = process.env.HUBTEL_STATUS_URL ?? 'https://api-txnstatus.hubtel.com';

function mapStatus(s: unknown): ProviderStatus {
  const v = String(s ?? '').toLowerCase();
  if (v === 'success' || v === 'paid') return 'SUCCESS';
  if (v === 'failed' || v === 'cancelled') return 'FAILED';
  if (v === 'expired') return 'EXPIRED';
  return 'PENDING';
}

export class HubtelProvider implements PaymentProvider {
  readonly kind = 'HUBTEL' as const;
  readonly signsWebhooks = false;

  constructor(private creds: ProviderCredentials & { publicKey?: string }) {}

  /** Hubtel authenticates with Basic base64(clientId:clientSecret). */
  private authHeader(): string {
    const id = this.creds.publicKey ?? '';
    return `Basic ${Buffer.from(`${id}:${this.creds.secret}`).toString('base64')}`;
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const res = asResponse(
      await fetch(`${CHECKOUT_BASE}/items/initiate`, {
        method: 'POST',
        headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          totalAmount: Number(input.amount.toFixed(2)),
          description: input.description,
          callbackUrl: input.callbackUrl,
          returnUrl: input.returnUrl,
          cancellationUrl: input.returnUrl,
          merchantAccountNumber: this.creds.merchantNumber,
          clientReference: input.reference,
        }),
      }),
    );
    const body = asRecord(await res.json().catch(() => ({})));
    const ok = res.ok && String(body.responseCode) === '0000';
    if (!ok) throw new Error(`Hubtel initiate failed: ${body.message ?? res.status}`);
    const data = asRecord(body.data);
    return {
      status: 'PENDING',
      providerRef: typeof data.checkoutId === 'string' ? data.checkoutId : undefined,
      checkoutUrl:
        (typeof data.checkoutDirectUrl === 'string' && data.checkoutDirectUrl) ||
        (typeof data.checkoutUrl === 'string' ? data.checkoutUrl : undefined),
      raw: body,
    };
  }

  async verify(ref: { reference: string; providerRef?: string }): Promise<VerifyResult> {
    const merchant = encodeURIComponent(this.creds.merchantNumber ?? '');
    const url = `${STATUS_BASE}/transactions/${merchant}/status?clientReference=${encodeURIComponent(ref.reference)}`;
    const res = asResponse(await fetch(url, { headers: { Authorization: this.authHeader() } }));
    const body = asRecord(await res.json().catch(() => ({})));
    if (!res.ok) throw new Error(`Hubtel status check failed: ${res.status}`);
    const data = asRecord(body.data);
    const amount = data.amount ?? data.Amount;
    return {
      status:
        String(body.responseCode) === '0000' ? mapStatus(data.status ?? data.Status) : 'PENDING',
      amountPaid: amount != null ? Number(amount) : undefined,
      channel: typeof data.paymentMethod === 'string' ? data.paymentMethod : undefined,
      providerRef: typeof data.checkoutId === 'string' ? data.checkoutId : ref.providerRef,
      raw: body,
    };
  }

  /** Hubtel sends no signature — always false, forcing the verify() re-query path. */
  verifyWebhookSignature(): boolean {
    return false;
  }

  parseWebhook(payload: unknown): ParsedWebhook | null {
    const body = asRecord(payload);
    const data = asRecord(body.Data ?? body.data);
    const reference =
      (typeof data.ClientReference === 'string' && data.ClientReference) ||
      (typeof data.clientReference === 'string' ? data.clientReference : undefined);
    const checkoutId =
      (typeof data.CheckoutId === 'string' && data.CheckoutId) ||
      (typeof data.checkoutId === 'string' ? data.checkoutId : undefined);
    if (!reference && !checkoutId) return null;
    const amount = data.Amount ?? data.amount;
    return {
      providerEventId: `hubtel:${checkoutId ?? reference}`,
      reference,
      providerRef: checkoutId,
      status: String(body.ResponseCode ?? body.responseCode) === '0000' ? 'SUCCESS' : 'FAILED',
      amount: amount != null ? Number(amount) : undefined,
    };
  }
}
