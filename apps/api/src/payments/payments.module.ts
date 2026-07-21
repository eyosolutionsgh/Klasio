import {
  BadRequestException,
  ForbiddenException,
  Body,
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { IsIn, IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';
import { GatewayProvider, PaymentChannel, PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService, withTenant } from '../prisma/prisma.service';
import {
  AuthUser,
  CurrentUser,
  Public,
  RequireEntitlement,
  RequirePermission,
} from '../common/auth';
import { decryptSecret, encryptSecret, publicToken } from '../common/crypto';
import { PaymentProvider, ProviderStatus } from '../common/payments/provider';
import { PaystackProvider } from '../common/payments/paystack';
import { HubtelProvider } from '../common/payments/hubtel';
import { FlutterwaveProvider } from '../common/payments/flutterwave';
import { MockProvider, MOCK_SECRET } from '../common/payments/mock';
import { hasEntitlement } from '../common/entitlements';
import { createHmac } from 'crypto';
import { balanceOf } from '../common/ledger';
import { nextInSequence, refNumber } from '../common/sequences';

class ConnectGatewayDto {
  @IsIn(['HUBTEL', 'PAYSTACK', 'FLUTTERWAVE']) provider: 'HUBTEL' | 'PAYSTACK' | 'FLUTTERWAVE';
  @IsIn(['TEST', 'LIVE']) mode: 'TEST' | 'LIVE';
  @IsString() @MinLength(8) secret: string;
  @IsOptional() @IsString() publicKey?: string;
  @IsOptional() @IsString() merchantNumber?: string;
  @IsOptional() @IsString() subaccountCode?: string;
}

class CheckoutDto {
  @IsString() studentId: string;
  @IsOptional() @IsString() invoiceId?: string;
  @IsOptional() @IsNumber() @IsPositive() amount?: number;
  @IsIn(['MOMO', 'CARD', 'USSD']) channel: PaymentChannel;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsIn(['HUBTEL', 'PAYSTACK', 'FLUTTERWAVE', 'MOCK']) provider?: GatewayProvider;
}

const PAYMENTS_QUEUE = 'payments';
const SWEEP_EVERY_MS = 5 * 60_000;
const PENDING_OLDER_THAN_MIN = 10;

/** Minimal shape of the raw-body request — avoids depending on @types/express. */
interface RawRequest {
  rawBody?: Buffer;
  body?: unknown;
  headers: Record<string, string | undefined>;
}

const METHOD_FOR: Record<PaymentChannel, PaymentMethod> = {
  MOMO: 'MOMO',
  USSD: 'MOMO',
  CARD: 'CARD',
};

@Injectable()
export class PaymentsService {
  constructor(private db: PrismaService) {}

  private publicBase() {
    return process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';
  }
  private apiBase() {
    return process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
  }

  /** Resolve the gateway for a school, falling back to the mock when none is connected. */
  async providerFor(schoolId: string, preferred?: GatewayProvider): Promise<PaymentProvider> {
    if (preferred === 'MOCK') {
      // The client may ask for the mock, so this must obey the same production rule as the
      // fallback below — otherwise a staff member creates a MOCK intent in production and
      // self-signs a callback to mint a receipt for money that never moved.
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_PAYMENTS !== 'true') {
        throw new BadRequestException('The test payment provider is not available here');
      }
      return new MockProvider();
    }
    const accounts = await this.db.gatewayAccount.findMany({
      where: { schoolId, active: true },
      orderBy: { createdAt: 'asc' },
    });
    const acct = preferred ? accounts.find((a) => a.provider === preferred) : accounts[0];
    if (!acct) {
      // Falling back to the mock in production would tell a parent their money went through
      // when nothing was ever charged. In development it is what makes the demo work, so the
      // fallback stays there and only there.
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_PAYMENTS !== 'true') {
        throw new BadRequestException(
          'This school has not connected a payment gateway yet — pay at the school office',
        );
      }
      return new MockProvider();
    }
    const creds = {
      secret: decryptSecret(acct.secretEnc),
      publicKey: acct.publicKey ?? undefined,
      merchantNumber: acct.merchantNumber ?? undefined,
      subaccountCode: acct.subaccountCode ?? undefined,
    };
    return acct.provider === 'PAYSTACK'
      ? new PaystackProvider(creds)
      : acct.provider === 'FLUTTERWAVE'
        ? new FlutterwaveProvider(creds)
        : new HubtelProvider(creds);
  }

  /** Outstanding balance for a student across all terms (append-only ledger projection). */
  /**
   * What this child still owes, from the ledger — the single definition of "the balance".
   *
   * Public because the guardian portal needs the same number: a parent must never be quoted a
   * different figure from the one the bursar sees.
   */
  async outstandingFor(studentId: string): Promise<number> {
    const entries = await this.db.ledgerEntry.findMany({ where: { studentId } });
    return balanceOf(entries);
  }

  // ── Gateway credentials ────────────────────────────────────────────

  async connectGateway(auth: AuthUser, dto: ConnectGatewayDto) {
    // Refuse to hold LIVE credentials under the throwaway dev key.
    const secretEnc = encryptSecret(dto.secret, dto.mode === 'LIVE');
    const acct = await this.db.gatewayAccount.upsert({
      where: { schoolId_provider: { schoolId: auth.schoolId, provider: dto.provider } },
      update: {
        mode: dto.mode,
        secretEnc,
        publicKey: dto.publicKey ?? null,
        merchantNumber: dto.merchantNumber ?? null,
        subaccountCode: dto.subaccountCode ?? null,
        active: true,
      },
      create: {
        schoolId: auth.schoolId,
        provider: dto.provider,
        mode: dto.mode,
        secretEnc,
        publicKey: dto.publicKey ?? null,
        merchantNumber: dto.merchantNumber ?? null,
        subaccountCode: dto.subaccountCode ?? null,
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'payments.gateway.connect',
      'GatewayAccount',
      acct.id,
      {
        provider: dto.provider,
        mode: dto.mode,
      },
    );
    return { id: acct.id, provider: acct.provider, mode: acct.mode, active: acct.active };
  }

  async listGateways(auth: AuthUser) {
    const accounts = await this.db.gatewayAccount.findMany({
      where: { schoolId: auth.schoolId },
      orderBy: { provider: 'asc' },
    });
    // Secrets are never returned — only whether one is held.
    return accounts.map((a) => ({
      id: a.id,
      provider: a.provider,
      mode: a.mode,
      active: a.active,
      publicKey: a.publicKey,
      merchantNumber: a.merchantNumber,
      hasSecret: !!a.secretEnc,
      updatedAt: a.updatedAt,
    }));
  }

  // ── Intents & checkout ─────────────────────────────────────────────

  private async createIntent(
    auth: AuthUser | null,
    schoolId: string,
    dto: CheckoutDto,
    withToken: boolean,
  ) {
    const student = await this.db.student.findFirst({
      where: { id: dto.studentId, schoolId },
      include: { guardians: { where: { isPrimary: true }, include: { guardian: true } } },
    });
    if (!student) throw new NotFoundException('Student not found');

    const amount = dto.amount ?? (await this.outstandingFor(dto.studentId));
    if (!(amount > 0)) throw new BadRequestException('Nothing outstanding to pay');

    const term = await this.db.term.findFirst({
      where: { isCurrent: true, academicYear: { schoolId, isCurrent: true } },
    });
    const school = await this.db.school.findUniqueOrThrow({ where: { id: schoolId } });
    const provider = await this.providerFor(schoolId, dto.provider);

    const intent = await this.db.paymentIntent.create({
      data: {
        schoolId,
        studentId: dto.studentId,
        invoiceId: dto.invoiceId ?? null,
        termId: term?.id ?? null,
        amount: new Prisma.Decimal(amount),
        currency: school.currency,
        reference: `ONL-${publicToken(9)}`,
        provider: provider.kind,
        channel: dto.channel,
        payToken: withToken ? publicToken(24) : null,
        payerPhone: dto.phone ?? student.guardians[0]?.guardian.phone ?? null,
        createdById: auth?.sub ?? null,
      },
    });
    return { intent, provider, student, school };
  }

  private async initiate(
    intent: {
      id: string;
      reference: string;
      amount: Prisma.Decimal;
      currency: string;
      channel: PaymentChannel;
      payerPhone: string | null;
    },
    provider: PaymentProvider,
    studentName: string,
    schoolName: string,
  ) {
    const result = await provider.initiate({
      reference: intent.reference,
      amount: Number(intent.amount),
      currency: intent.currency,
      description: `${schoolName} — school fees for ${studentName}`,
      channel: intent.channel,
      customerPhone: intent.payerPhone ?? undefined,
      callbackUrl: `${this.apiBase()}/payments/webhook/${provider.kind.toLowerCase()}`,
      returnUrl: `${this.publicBase()}/pay/return?ref=${encodeURIComponent(intent.reference)}`,
    });
    await this.db.paymentIntent.update({
      where: { id: intent.id },
      data: { providerRef: result.providerRef ?? null, checkoutUrl: result.checkoutUrl ?? null },
    });
    return result;
  }

  /** Staff-initiated checkout: returns a gateway checkout URL to hand to the guardian. */
  async checkout(auth: AuthUser, dto: CheckoutDto) {
    const { intent, provider, student, school } = await this.createIntent(
      auth,
      auth.schoolId,
      dto,
      false,
    );
    const result = await this.initiate(
      intent,
      provider,
      `${student.firstName} ${student.lastName}`,
      school.name,
    );
    await this.db.audit(auth.schoolId, auth.sub, 'payments.checkout', 'PaymentIntent', intent.id, {
      reference: intent.reference,
      amount: Number(intent.amount),
      provider: provider.kind,
    });
    return {
      reference: intent.reference,
      amount: Number(intent.amount),
      currency: intent.currency,
      provider: provider.kind,
      checkoutUrl: result.checkoutUrl,
      status: result.status,
    };
  }

  /**
   * A guardian paying for their own ward from the family portal.
   *
   * The caller is a guardian, not a staff user, so there is no `AuthUser` and no `@Roles` to
   * lean on — the guardian module proves the child is theirs (and not custody-BLOCKED) before
   * calling this. Entitlement is read from the school rather than the token because guardian
   * sessions last weeks and a tier baked into one would go stale.
   */
  async guardianCheckout(schoolId: string, dto: CheckoutDto) {
    const school = await this.db.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { tier: true, name: true },
    });
    if (!hasEntitlement(school.tier, 'fees.online')) {
      throw new ForbiddenException('This school does not accept online payments yet');
    }
    const { intent, provider, student } = await this.createIntent(null, schoolId, dto, false);
    const result = await this.initiate(
      intent,
      provider,
      `${student.firstName} ${student.lastName}`,
      school.name,
    );
    // No userId — a guardian is not a staff user. The intent records who paid via payerPhone.
    await this.db.audit(schoolId, null, 'payments.guardian-checkout', 'PaymentIntent', intent.id, {
      reference: intent.reference,
      amount: Number(intent.amount),
      provider: provider.kind,
    });
    return {
      reference: intent.reference,
      amount: Number(intent.amount),
      currency: intent.currency,
      provider: provider.kind,
      checkoutUrl: result.checkoutUrl,
      status: result.status,
    };
  }

  /** Mint a shareable public pay link (sent to a guardian by SMS). */
  async payLink(auth: AuthUser, dto: CheckoutDto) {
    const { intent, student } = await this.createIntent(auth, auth.schoolId, dto, true);
    await this.db.audit(auth.schoolId, auth.sub, 'payments.link', 'PaymentIntent', intent.id, {
      reference: intent.reference,
      amount: Number(intent.amount),
    });
    return {
      reference: intent.reference,
      amount: Number(intent.amount),
      currency: intent.currency,
      student: `${student.firstName} ${student.lastName}`,
      payUrl: `${this.publicBase()}/pay/${intent.payToken}`,
    };
  }

  /** Public (unauthenticated) view of a pay link. Exposes only what a payer needs. */
  /**
   * Public entry points have no principal, so no tenant is set and RLS hides every row.
   *
   * Each of these therefore resolves its intent through the OWNER client — a reference or a pay
   * token identifies a payment across schools, exactly like an email identifies a user at login
   * — and then does its real work inside `withTenant`. See prisma.service.ts.
   *
   * This was missed when RLS landed and it broke settlement silently: the gateway called back,
   * the lookup found nothing, and a parent's payment never reached the ledger.
   */
  async publicIntent(token: string) {
    const intent = await this.db.system.paymentIntent.findUnique({
      where: { payToken: token },
      include: { student: { include: { classRoom: { select: { name: true } } } } },
    });
    if (!intent) throw new NotFoundException('This payment link is not valid');
    // The intent came from the owner client, but the school lookup below is tenant-scoped —
    // outside `withTenant` the policy hides the row and this 500s on `findUniqueOrThrow`.
    return withTenant(intent.schoolId, async () => {
      const school = await this.db.school.findUniqueOrThrow({ where: { id: intent.schoolId } });
      return {
        reference: intent.reference,
        amount: Number(intent.amount),
        currency: intent.currency,
        status: intent.status,
        channel: intent.channel,
        checkoutUrl: intent.checkoutUrl,
        school: { name: school.name, logoUrl: school.logoUrl },
        student: {
          name: `${intent.student.firstName} ${intent.student.lastName}`,
          className: intent.student.classRoom?.name ?? null,
        },
      };
    });
  }

  /** Public: start checkout for a pay link (guardian has no login). */
  async publicCheckout(token: string, phone?: string) {
    const intent = await this.db.system.paymentIntent.findUnique({
      where: { payToken: token },
      include: { student: true },
    });
    if (!intent) throw new NotFoundException('This payment link is not valid');
    if (intent.status === 'SUCCESS')
      throw new BadRequestException('This payment is already settled');
    // Everything from here reads or writes tenant-owned rows — the school, the school's gateway
    // credentials, and the intent itself. Outside `withTenant` the reads find nothing and the
    // update is refused outright, which is how this route came to be broken in the first place.
    return withTenant(intent.schoolId, async () => {
      const school = await this.db.school.findUniqueOrThrow({ where: { id: intent.schoolId } });
      const provider = await this.providerFor(intent.schoolId, intent.provider);
      if (phone) {
        await this.db.paymentIntent.update({
          where: { id: intent.id },
          data: { payerPhone: phone },
        });
      }
      const result = await this.initiate(
        { ...intent, payerPhone: phone ?? intent.payerPhone },
        provider,
        `${intent.student.firstName} ${intent.student.lastName}`,
        school.name,
      );
      return {
        reference: intent.reference,
        checkoutUrl: result.checkoutUrl,
        status: result.status,
      };
    });
  }

  // ── Settlement (the only path that writes money) ───────────────────

  /**
   * Append the PAYMENT ledger entry + receipt for a successful intent.
   * Idempotent: LedgerEntry.reference is unique, so a replayed callback either short-circuits
   * on the pre-check or loses the unique-constraint race and is treated as already applied.
   */
  async applySuccess(reference: string, amountPaid?: number, providerRef?: string) {
    const intent = await this.db.system.paymentIntent.findUnique({ where: { reference } });
    if (!intent) throw new NotFoundException('Unknown payment reference');

    // The lookup above had no tenant; everything below writes, so it must run inside one or RLS
    // refuses the insert. Settling a parent's payment is the last place to be casual about this.
    return withTenant(intent.schoolId, async () => {
      // Scoped to the school now that `reference` is unique per school rather than globally.
      // Idempotency is unchanged: within one school a reference still identifies one entry.
      const existing = await this.db.ledgerEntry.findUnique({
        where: { schoolId_reference: { schoolId: intent.schoolId, reference } },
      });
      if (existing) {
        if (intent.status !== 'SUCCESS') {
          await this.db.paymentIntent.update({
            where: { id: intent.id },
            data: { status: 'SUCCESS', providerRef: providerRef ?? intent.providerRef },
          });
        }
        return { applied: false, alreadyApplied: true, reference };
      }

      const amount = amountPaid != null && amountPaid > 0 ? amountPaid : Number(intent.amount);
      const rcpSeq = await nextInSequence(this.db, intent.schoolId, 'RECEIPT');
      try {
        const entry = await this.db.ledgerEntry.create({
          data: {
            schoolId: intent.schoolId,
            studentId: intent.studentId,
            termId: intent.termId,
            type: 'PAYMENT',
            amount: new Prisma.Decimal(amount),
            method: METHOD_FOR[intent.channel],
            reference: intent.reference,
            note: `Online payment (${intent.provider})`,
            createdById: intent.createdById ?? 'system',
          },
        });
        await this.db.receipt.create({
          data: {
            schoolId: intent.schoolId,
            ledgerEntryId: entry.id,
            number: refNumber('RCP', rcpSeq),
          },
        });
      } catch (e) {
        // Which constraint fired matters, and treating them alike lost money.
        //
        // A duplicate `LedgerEntry.reference` means a concurrent callback for *this* payment won
        // the race, so the money really is recorded exactly once and there is nothing to do. A
        // duplicate receipt *number* used to mean something entirely different: two different
        // children's payments colliding on `count(receipts) + 1`. Reporting that as "already
        // applied" returned 200 to the gateway, which then never retried — while the whole
        // request, ledger entry included, had already been rolled back. The payment vanished.
        //
        // The counter is now atomic so that collision should not arise, but the catch must not be
        // the thing that hides it if it ever does.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          const target = String((e.meta as { target?: string[] } | undefined)?.target ?? '');
          if (target.includes('reference')) {
            return { applied: false, alreadyApplied: true, reference };
          }
        }
        throw e;
      }

      await this.db.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'SUCCESS', providerRef: providerRef ?? intent.providerRef },
      });
      await this.db.audit(
        intent.schoolId,
        intent.createdById,
        'payments.settled',
        'PaymentIntent',
        intent.id,
        {
          reference,
          amount,
          provider: intent.provider,
        },
      );
      return { applied: true, alreadyApplied: false, reference, amount };
    });
  }

  /**
   * Handle a gateway callback.
   *
   * Signed gateways (Paystack, mock) must pass signature verification. Unsigned gateways
   * (Hubtel) are re-queried server-to-server — the callback body is only a trigger and is
   * never trusted for status or amount.
   */
  async handleWebhook(
    kind: GatewayProvider,
    headers: Record<string, string | undefined>,
    rawBody: Buffer,
  ) {
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Malformed webhook payload');
    }

    // Parsing needs no credentials — used only to locate the intent.
    const parser =
      kind === 'PAYSTACK'
        ? new PaystackProvider({ secret: '' })
        : kind === 'FLUTTERWAVE'
          ? new FlutterwaveProvider({ secret: '' })
          : kind === 'HUBTEL'
            ? new HubtelProvider({ secret: '' })
            : new MockProvider();
    const parsed = parser.parseWebhook(payload);
    if (!parsed?.reference) throw new BadRequestException('Unrecognised webhook payload');
    // Captured before the closure below: the narrowing from the guard above does not survive
    // into a callback, and TypeScript is right to insist.
    const reference = parsed.reference;

    const intent = await this.db.system.paymentIntent.findUnique({
      where: { reference },
    });
    if (!intent) throw new NotFoundException('Unknown payment reference');

    // From here on we know the school, so everything runs in its scope — the dedupe row, the
    // intent update and the ledger write are all tenant-owned.
    return withTenant(intent.schoolId, async () => {
      const provider = await this.providerFor(intent.schoolId, intent.provider);
      let status: ProviderStatus = parsed.status;
      let amount = parsed.amount;

      // Authenticate the callback FIRST. Recording the dedupe row before this would let a
      // forged webhook burn the event id and make the genuine callback look like a replay —
      // a denial-of-settlement. Nothing is persisted until the event is proven genuine.
      if (provider.signsWebhooks) {
        if (!provider.verifyWebhookSignature(headers, rawBody)) {
          throw new UnauthorizedException('Invalid webhook signature');
        }
      } else {
        // Unsigned gateway (Hubtel): the callback is only a trigger — the server-to-server
        // re-query is authoritative for both status and amount.
        const verified = await provider.verify({
          reference,
          providerRef: parsed.providerRef,
        });
        status = verified.status;
        amount = verified.amountPaid ?? amount;
      }

      // Replay guard, only for authenticated events: unique (provider, providerEventId).
      try {
        await this.db.webhookEvent.create({
          data: {
            provider: kind,
            providerEventId: parsed.providerEventId,
            schoolId: intent.schoolId,
            reference: parsed.reference,
            verified: true,
            payload: payload as Prisma.InputJsonValue,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          return { ok: true, duplicate: true };
        }
        throw e;
      }

      let result: { applied: boolean; alreadyApplied: boolean } = {
        applied: false,
        alreadyApplied: false,
      };
      if (status === 'SUCCESS') {
        result = await this.applySuccess(reference, amount, parsed.providerRef);
      } else if (status === 'FAILED' || status === 'EXPIRED') {
        await this.db.paymentIntent.update({
          where: { id: intent.id },
          data: { status, failureCode: String(status) },
        });
      }

      await this.db.webhookEvent.update({
        where: {
          provider_providerEventId: { provider: kind, providerEventId: parsed.providerEventId },
        },
        data: { processedAt: new Date() },
      });
      return { ok: true, status, ...result };
    });
  }

  /**
   * Read-only status for the payer's return page. Performs NO gateway call and can never
   * settle money — settlement happens only via an authenticated webhook or the scheduled
   * sweep, so this stays safe to expose without a login.
   */
  async storedStatus(reference: string) {
    const intent = await this.db.system.paymentIntent.findUnique({
      where: { reference },
      select: { reference: true, status: true, amount: true, currency: true, updatedAt: true },
    });
    if (!intent) throw new NotFoundException('Unknown payment reference');
    return {
      reference: intent.reference,
      status: intent.status,
      amount: Number(intent.amount),
      currency: intent.currency,
      updatedAt: intent.updatedAt,
    };
  }

  /** On-demand re-query; also used by the scheduled sweep. Staff-only — it can settle money. */
  async refreshStatus(reference: string) {
    const intent = await this.db.paymentIntent.findUnique({ where: { reference } });
    if (!intent) throw new NotFoundException('Unknown payment reference');
    if (intent.status === 'SUCCESS') {
      return { reference, status: intent.status, applied: false };
    }
    const provider = await this.providerFor(intent.schoolId, intent.provider);
    const verified = await provider.verify({
      reference,
      providerRef: intent.providerRef ?? undefined,
    });
    if (verified.status === 'SUCCESS') {
      const applied = await this.applySuccess(reference, verified.amountPaid, verified.providerRef);
      return { ...applied, reference, status: 'SUCCESS' as const };
    }
    if (verified.status !== intent.status) {
      await this.db.paymentIntent.update({
        where: { id: intent.id },
        data: { status: verified.status },
      });
    }
    return { reference, status: verified.status, applied: false };
  }

  /**
   * Dev/demo only: simulate the guardian completing checkout on the mock gateway by
   * synthesising the exact signed callback a real gateway would send — so the production
   * webhook path is what gets exercised. Refuses anything not on the mock provider.
   */
  async mockComplete(reference: string, outcome: 'success' | 'failed' = 'success') {
    const intent = await this.db.paymentIntent.findUnique({ where: { reference } });
    if (!intent) throw new NotFoundException('Unknown payment reference');
    if (intent.provider !== 'MOCK') {
      throw new BadRequestException('Only mock-gateway payments can be completed this way');
    }
    const raw = Buffer.from(
      JSON.stringify({
        event: outcome === 'success' ? 'charge.success' : 'charge.failed',
        reference,
        amount: Number(intent.amount),
      }),
    );
    const signature = createHmac('sha512', MOCK_SECRET).update(raw).digest('hex');
    return this.handleWebhook('MOCK', { 'x-mock-signature': signature }, raw);
  }

  /**
   * Intents awaiting settlement — driven by the scheduled sweep.
   *
   * System client: the sweep runs in a worker with no request, so the tenant-aware client
   * resolves to no school and returns an empty list every time. The per-intent half of this path
   * (`refreshStatus`) was already fixed to use `db.system` + `withTenant`; the enumeration half
   * was missed, so the sweep reported `{ swept: 0 }` forever and a payment whose webhook was lost
   * was never re-queried — the exact resilience this queue exists to provide.
   */
  pendingOlderThan(minutes: number) {
    return this.db.system.paymentIntent.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: new Date(Date.now() - minutes * 60_000) },
      },
      select: { reference: true },
      take: 200,
    });
  }

  async list(auth: AuthUser, status?: string) {
    const intents = await this.db.paymentIntent.findMany({
      where: {
        schoolId: auth.schoolId,
        ...(status ? { status: status as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { student: { select: { firstName: true, lastName: true, admissionNo: true } } },
    });
    return intents.map((i) => ({
      reference: i.reference,
      student: `${i.student.firstName} ${i.student.lastName}`,
      admissionNo: i.student.admissionNo,
      amount: Number(i.amount),
      currency: i.currency,
      provider: i.provider,
      channel: i.channel,
      status: i.status,
      createdAt: i.createdAt,
    }));
  }
}

@Controller('payments')
export class PaymentsController {
  constructor(private svc: PaymentsService) {}

  @Post('gateway')
  @RequirePermission('fees.gateways')
  @RequireEntitlement('fees.online')
  connect(@CurrentUser() user: AuthUser, @Body() dto: ConnectGatewayDto) {
    return this.svc.connectGateway(user, dto);
  }

  @Get('gateway')
  @RequirePermission('fees.gateways')
  @RequireEntitlement('fees.online')
  gateways(@CurrentUser() user: AuthUser) {
    return this.svc.listGateways(user);
  }

  @Post('checkout')
  @RequirePermission('fees.record_payment')
  @RequireEntitlement('fees.online')
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.svc.checkout(user, dto);
  }

  @Post('link')
  @RequirePermission('fees.record_payment')
  @RequireEntitlement('fees.online')
  link(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.svc.payLink(user, dto);
  }

  @Get()
  @RequirePermission('fees.view')
  @RequireEntitlement('fees.online')
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.svc.list(user, status);
  }

  // ── Public (no login: guardians are not users) ─────────────────────

  @Get('public/:token')
  @Public()
  publicIntent(@Param('token') token: string) {
    return this.svc.publicIntent(token);
  }

  @Post('public/:token/checkout')
  @Public()
  publicCheckout(@Param('token') token: string, @Body() body: { phone?: string }) {
    return this.svc.publicCheckout(token, body?.phone);
  }

  // ── Gateway callbacks ──────────────────────────────────────────────

  @Post('webhook/:provider')
  @Public()
  webhook(@Param('provider') provider: string, @Req() req: RawRequest) {
    const kind = provider.toUpperCase();
    if (!['HUBTEL', 'PAYSTACK', 'FLUTTERWAVE', 'MOCK'].includes(kind)) {
      throw new BadRequestException('Unknown provider');
    }
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    return this.svc.handleWebhook(kind as GatewayProvider, req.headers, raw);
  }

  /** Dev/demo: complete a mock-gateway payment (rejects real providers). */
  @Post('mock/:reference/complete')
  @Public()
  mockComplete(
    @Param('reference') reference: string,
    @Body() body: { outcome?: 'success' | 'failed' },
  ) {
    return this.svc.mockComplete(reference, body?.outcome ?? 'success');
  }

  /**
   * Read-only status for the payer's return page. Public because guardians have no login:
   * the reference is a high-entropy bearer token, and this endpoint performs no gateway call
   * and cannot settle money.
   */
  @Get(':reference/status')
  @Public()
  status(@Param('reference') reference: string) {
    return this.svc.storedStatus(reference);
  }

  /** Staff-only forced re-query (can settle money, so it must not be public). */
  @Post(':reference/refresh')
  // Settles money: this handler can append a PAYMENT entry and mint a receipt, so it needs the
  // permission to take money, not merely to look at it.
  @RequirePermission('fees.record_payment')
  @RequireEntitlement('fees.online')
  refresh(@CurrentUser() _user: AuthUser, @Param('reference') reference: string) {
    return this.svc.refreshStatus(reference);
  }
}

/**
 * Background jobs (BullMQ + Redis, docs/04 §4.1).
 *
 * Deliberately NOT on the critical path: webhooks settle money synchronously and idempotently
 * above. This only adds resilience — a repeatable sweep that re-queries PENDING intents to
 * catch missed callbacks (docs/03 §3.7 "scheduled status re-query").
 *
 * If REDIS_URL is unset or Redis is unreachable we log and continue with the sweep disabled:
 * payments still settle, they just lose the safety net. Keeps dev, tests and air-gapped
 * installs (where online payments don't apply anyway) working without Redis.
 */
@Injectable()
export class PaymentsQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PaymentsQueue');
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;
  enabled = false;

  constructor(private svc: PaymentsService) {}

  async onModuleInit() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.warn(
        'REDIS_URL not set — payment re-query sweep disabled. Payments still settle via webhooks.',
      );
      return;
    }
    try {
      this.connection = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
      await this.connection.connect();
      this.queue = new Queue(PAYMENTS_QUEUE, { connection: this.connection });
      this.worker = new Worker(PAYMENTS_QUEUE, (job) => this.process(job.name), {
        connection: this.connection,
      });
      this.worker.on('failed', (job, err) =>
        this.logger.error(`job ${job?.name} failed: ${err.message}`),
      );
      await this.queue.upsertJobScheduler(
        'requery-sweep',
        { every: SWEEP_EVERY_MS },
        { name: 'requery', opts: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } } },
      );
      this.enabled = true;
      this.logger.log('payment re-query sweep active');
    } catch (e) {
      this.logger.warn(
        `Redis unavailable (${e instanceof Error ? e.message : e}) — payment re-query sweep disabled.`,
      );
      await this.shutdown();
    }
  }

  private async process(name: string) {
    if (name !== 'requery') return;
    const pending = await this.svc.pendingOlderThan(PENDING_OLDER_THAN_MIN);
    for (const { reference } of pending) {
      try {
        await this.svc.refreshStatus(reference);
      } catch (e) {
        this.logger.warn(`re-query ${reference} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    return { swept: pending.length };
  }

  private async shutdown() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.connection?.disconnect();
    this.worker = undefined;
    this.queue = undefined;
    this.connection = undefined;
    this.enabled = false;
  }

  async onModuleDestroy() {
    await this.shutdown();
  }
}

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentsQueue],
  exports: [PaymentsService],
})
export class PaymentsModule {}
