/**
 * Gateway-agnostic payment provider contract (docs/03 §3.7, docs/04 §4.3 "every integration
 * behind an interface"). Adapters: Paystack, Hubtel, and a Mock used for dev/offline and tests.
 *
 * Amounts crossing this boundary are always in MAJOR units (e.g. GHS 120.50). Each adapter
 * converts to whatever its gateway expects (Paystack uses minor units / pesewas).
 */
import type { GatewayProvider, PaymentChannel } from '@prisma/client';

export type ProviderStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';

export interface InitiateInput {
  reference: string;
  amount: number;
  currency: string;
  description: string;
  channel: PaymentChannel;
  customerEmail?: string;
  customerPhone?: string;
  /** Server-to-server callback (our webhook). */
  callbackUrl: string;
  /** Where the guardian's browser lands after checkout. */
  returnUrl: string;
}

export interface InitiateResult {
  status: ProviderStatus;
  providerRef?: string;
  checkoutUrl?: string;
  raw?: unknown;
}

export interface VerifyResult {
  status: ProviderStatus;
  amountPaid?: number;
  channel?: string;
  providerRef?: string;
  raw?: unknown;
}

export interface ParsedWebhook {
  /** Stable per-event id — stored unique so a replayed callback is a no-op. */
  providerEventId: string;
  reference?: string;
  providerRef?: string;
  status: ProviderStatus;
  amount?: number;
}

export interface PaymentProvider {
  readonly kind: GatewayProvider;
  /**
   * Whether this gateway cryptographically signs its callbacks.
   * Paystack does (HMAC-SHA512). Hubtel does NOT — for unsigned providers the caller MUST
   * treat a callback as a mere trigger and re-query `verify()` before touching the ledger.
   */
  readonly signsWebhooks: boolean;

  initiate(input: InitiateInput): Promise<InitiateResult>;
  verify(ref: { reference: string; providerRef?: string }): Promise<VerifyResult>;
  verifyWebhookSignature(headers: Record<string, string | undefined>, rawBody: Buffer): boolean;
  parseWebhook(payload: unknown): ParsedWebhook | null;
}

export interface ProviderCredentials {
  secret: string;
  publicKey?: string;
  merchantNumber?: string;
  subaccountCode?: string;
}

/** Narrow unknown JSON safely. */
export function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
