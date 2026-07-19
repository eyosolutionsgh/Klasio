import { Injectable, Logger, Module } from '@nestjs/common';
import { RenderedEmail } from '../common/email-templates';

export interface EmailResult {
  ok: boolean;
  /** Provider message id, kept so a delivery question can be traced back to a send. */
  ref?: string;
  error?: string;
}

interface EmailProvider {
  name: string;
  send(to: string, toName: string | null, msg: RenderedEmail): Promise<EmailResult>;
}

/** Dev/offline fallback: prints the message rather than delivering it. */
class MockEmailProvider implements EmailProvider {
  name = 'mock';
  private log = new Logger('EmailService');
  async send(to: string, _toName: string | null, msg: RenderedEmail): Promise<EmailResult> {
    this.log.log(`[mock email] → ${to}\n  subject: ${msg.subject}\n${msg.text}`);
    return { ok: true, ref: `mock-${to}` };
  }
}

/** How long to wait when MailerSend gives no `retry-after`, and the ceiling on what it asks for. */
const DEFAULT_RETRY_SECONDS = 2;
const MAX_RETRY_SECONDS = 10;

/**
 * MailerSend transactional API.
 *
 * Two parts of this contract are easy to get wrong and both are load-bearing:
 *
 * A successful send is **202 Accepted with an empty body**, not 200 — the message is queued, not
 * delivered, and the id comes back in the `x-message-id` *header*. Checking `res.ok` and parsing
 * JSON would appear to work and then throw on every successful send.
 *
 * 422 is the domain-verification failure. It is the one error a correctly-coded integration still
 * hits — a `from` address whose domain has not been verified in the MailerSend account is
 * rejected every time — so its body is surfaced rather than swallowed.
 */
class MailerSendProvider implements EmailProvider {
  name = 'mailersend';
  private log = new Logger('EmailService');
  constructor(
    private cfg: { token: string; fromEmail: string; fromName: string; replyTo?: string },
  ) {}

  async send(to: string, toName: string | null, msg: RenderedEmail): Promise<EmailResult> {
    // One retry only, and only for the two statuses that are genuinely transient. A retry on 422
    // would re-send a message that can never be accepted; a retry on 401 would hammer the API
    // with a bad token.
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.post(to, toName, msg);
      if (!res.retryable || attempt === 1) return res.result;
      await new Promise((r) => setTimeout(r, res.retryAfterSeconds * 1000));
    }
    /* c8 ignore next */
    return { ok: false, error: 'unreachable' };
  }

  private async post(
    to: string,
    toName: string | null,
    msg: RenderedEmail,
  ): Promise<{ result: EmailResult; retryable: boolean; retryAfterSeconds: number }> {
    try {
      const res = await fetch('https://api.mailersend.com/v1/email', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.token}`,
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          from: { email: this.cfg.fromEmail, name: this.cfg.fromName },
          to: [{ email: to, ...(toName ? { name: toName } : {}) }],
          ...(this.cfg.replyTo ? { reply_to: { email: this.cfg.replyTo } } : {}),
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
        }),
      });

      if (res.status === 202) {
        return {
          result: { ok: true, ref: res.headers.get('x-message-id') ?? undefined },
          retryable: false,
          retryAfterSeconds: 0,
        };
      }

      const detail = await res.text().catch(() => '');
      // 429 carries `retry-after` in seconds; 5xx is MailerSend being unwell. Both are worth one
      // more try. Everything else is a request that will fail identically forever.
      const retryable = res.status === 429 || res.status >= 500;
      const asked = Number(res.headers.get('retry-after'));
      const retryAfterSeconds = Math.min(
        Number.isFinite(asked) && asked > 0 ? asked : DEFAULT_RETRY_SECONDS,
        MAX_RETRY_SECONDS,
      );
      return {
        result: { ok: false, error: `HTTP ${res.status}: ${detail.slice(0, 500)}` },
        retryable,
        retryAfterSeconds,
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'network error';
      return {
        result: { ok: false, error },
        retryable: true,
        retryAfterSeconds: DEFAULT_RETRY_SECONDS,
      };
    }
  }
}

@Injectable()
export class EmailService {
  private provider: EmailProvider;
  private log = new Logger('EmailService');

  constructor() {
    const {
      MAILERSEND_API_TOKEN,
      MAILERSEND_FROM_EMAIL,
      MAILERSEND_FROM_NAME,
      MAILERSEND_REPLY_TO,
    } = process.env;
    const configured = !!(MAILERSEND_API_TOKEN && MAILERSEND_FROM_EMAIL);

    /**
     * The same reasoning as SmsService's guard, with a sharper edge.
     *
     * A mock that reports success means an invited school never receives its only onboarding link,
     * and a locked-out head teacher never receives a reset — while every log line says the message
     * went out. Unlike SMS there is no credit balance to notice draining, so a misconfigured
     * deploy is silent indefinitely.
     */
    if (
      !configured &&
      process.env.NODE_ENV === 'production' &&
      process.env.ALLOW_MOCK_EMAIL !== 'true'
    ) {
      throw new Error(
        'No email provider configured. Set MAILERSEND_API_TOKEN/MAILERSEND_FROM_EMAIL, or ALLOW_MOCK_EMAIL=true to accept that no message will be delivered.',
      );
    }

    this.provider = configured
      ? new MailerSendProvider({
          token: MAILERSEND_API_TOKEN,
          fromEmail: MAILERSEND_FROM_EMAIL,
          fromName: MAILERSEND_FROM_NAME ?? 'EYO School Management',
          replyTo: MAILERSEND_REPLY_TO || undefined,
        })
      : new MockEmailProvider();

    if (!configured) {
      this.log.warn('No email provider configured — messages are logged but not delivered.');
    }
  }

  /** Which provider is live, for the vendor console and for tests. */
  get providerName(): string {
    return this.provider.name;
  }

  /**
   * Deliver a rendered message.
   *
   * Never throws. Email is a side effect of flows that must still succeed without it: an
   * invitation is valid whether or not its notification landed, and a guardian who also got the
   * SMS is not locked out because MailerSend was down. Callers that need to know get `ok`.
   *
   * Nothing about the message body is persisted. Reset links and sign-in codes pass through here,
   * and there is no store that could later leak them — the same rule `SmsService.sendOtp` follows.
   */
  async send(opts: {
    to: string;
    toName?: string | null;
    message: RenderedEmail;
    /** Names the flow in logs, e.g. `invitation`. Never the recipient or the contents. */
    kind: string;
  }): Promise<EmailResult> {
    const result = await this.provider.send(opts.to, opts.toName ?? null, opts.message);
    if (result.ok) {
      this.log.log(
        `${opts.kind} email accepted by ${this.provider.name} (ref=${result.ref ?? 'none'})`,
      );
    } else {
      // The address is logged on failure and only on failure: without it a delivery complaint
      // cannot be investigated at all, and a failed send is already an operational event.
      this.log.error(`${opts.kind} email to ${opts.to} failed: ${result.error}`);
    }
    return result;
  }
}

@Module({ providers: [EmailService], exports: [EmailService] })
export class EmailModule {}
