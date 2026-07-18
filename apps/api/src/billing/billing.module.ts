import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Injectable,
  Module,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { GatewayProvider, Prisma, Tier } from '@prisma/client';
import { PrismaService, withTenant } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Public, RequirePermission, Roles } from '../common/auth';
import { publicToken } from '../common/crypto';
import { PaymentProvider } from '../common/payments/provider';
import { PaystackProvider } from '../common/payments/paystack';
import { HubtelProvider } from '../common/payments/hubtel';
import { MockProvider, MOCK_SECRET } from '../common/payments/mock';
import { changeEffect, isEntitled, periodFor, quoteFor, TIER_PRICES } from '../common/pricing';

/**
 * The school's own subscription to EYO.
 *
 * Every other payment path in this codebase moves money *to a school*. This one moves money to
 * the vendor, so it deliberately shares no configuration with `payments.module.ts`: credentials
 * come from platform env vars, not from the school's `GatewayAccount`. Wiring these together
 * would pay a school its own subscription fee.
 */

class SubscribeDto {
  @IsIn(['MEDIUM', 'ADVANCED']) tier: Extract<Tier, 'MEDIUM' | 'ADVANCED'>;
  @IsIn(['MOMO', 'CARD']) channel: 'MOMO' | 'CARD';
  @IsOptional() @IsString() phone?: string;
}

class ChangeTierDto {
  @IsIn(['BASIC', 'MEDIUM', 'ADVANCED']) tier: Tier;
}

@Injectable()
export class BillingService {
  constructor(private db: PrismaService) {}

  /**
   * The vendor's own gateway, from env.
   *
   * Absent in development, where the mock stands in. In production a missing platform gateway
   * must fail loudly rather than fall back: a mock here would report a subscription paid and
   * silently upgrade a school that never paid anything.
   */
  private platformProvider(): { provider: PaymentProvider; kind: GatewayProvider } {
    const { PLATFORM_GATEWAY, PLATFORM_GATEWAY_SECRET, PLATFORM_GATEWAY_PUBLIC_KEY } = process.env;
    if (PLATFORM_GATEWAY === 'PAYSTACK' && PLATFORM_GATEWAY_SECRET) {
      return {
        provider: new PaystackProvider({
          secret: PLATFORM_GATEWAY_SECRET,
          publicKey: PLATFORM_GATEWAY_PUBLIC_KEY,
        }),
        kind: 'PAYSTACK',
      };
    }
    if (PLATFORM_GATEWAY === 'HUBTEL' && PLATFORM_GATEWAY_SECRET) {
      return {
        provider: new HubtelProvider({
          secret: PLATFORM_GATEWAY_SECRET,
          merchantNumber: process.env.PLATFORM_GATEWAY_MERCHANT,
        }),
        kind: 'HUBTEL',
      };
    }
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException(
        'Online subscription payment is not configured. Contact EYO to pay by transfer.',
      );
    }
    return { provider: new MockProvider(), kind: 'MOCK' };
  }

  private async activeStudents(schoolId: string) {
    return this.db.student.count({ where: { schoolId, status: 'ACTIVE' } });
  }

  /** What each tier would cost this school today, at its current roll. */
  async plans(auth: AuthUser) {
    const [school, count, sub] = await Promise.all([
      this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } }),
      this.activeStudents(auth.schoolId),
      this.db.subscription.findUnique({ where: { schoolId: auth.schoolId } }),
    ]);

    return {
      currentTier: school.tier,
      studentCount: count,
      currency: school.currency,
      subscription: sub
        ? {
            tier: sub.tier,
            status: sub.status,
            amount: Number(sub.amount),
            periodStart: sub.periodStart,
            periodEnd: sub.periodEnd,
            pendingTier: sub.pendingTier,
            entitled: isEntitled(sub),
          }
        : null,
      plans: (Object.keys(TIER_PRICES) as Tier[]).map((tier) => ({
        ...quoteFor(tier, count, school.currency),
        perStudent: TIER_PRICES[tier].perStudent,
        current: tier === school.tier,
      })),
    };
  }

  /**
   * Start a self-serve upgrade.
   *
   * This creates an invoice and a checkout only. **The tier is not touched here** — it moves
   * when the gateway confirms the money, in `settle()`. Upgrading at checkout would hand a
   * school a paid tier for abandoning a payment page.
   */
  async subscribe(auth: AuthUser, dto: SubscribeDto) {
    const [school, count] = await Promise.all([
      this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } }),
      this.activeStudents(auth.schoolId),
    ]);
    if (school.tier === dto.tier) {
      throw new BadRequestException(`This school is already on ${dto.tier}`);
    }
    if (!(quoteFor(dto.tier, count, school.currency).amount > 0)) {
      throw new BadRequestException('Nothing to pay for that plan');
    }

    const quote = quoteFor(dto.tier, count, school.currency);
    const term = await this.db.term.findFirst({
      where: { isCurrent: true, academicYear: { schoolId: auth.schoolId, isCurrent: true } },
      select: { endDate: true },
    });
    const period = periodFor(new Date(), term?.endDate ?? null);

    const invoice = await this.db.subscriptionInvoice.create({
      data: {
        schoolId: auth.schoolId,
        tier: dto.tier,
        amount: new Prisma.Decimal(quote.amount),
        currency: quote.currency,
        studentCount: count,
        periodStart: period.start,
        periodEnd: period.end,
        reference: `SUB-${publicToken(10)}`,
        createdById: auth.sub,
      },
    });

    const { provider, kind } = this.platformProvider();
    const apiBase = process.env.API_PUBLIC_URL ?? 'http://localhost:4000';
    const webBase = process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000';
    const result = await provider.initiate({
      reference: invoice.reference,
      amount: quote.amount,
      currency: quote.currency,
      channel: dto.channel,
      customerPhone: dto.phone ?? school.phone ?? undefined,
      customerEmail: school.email ?? undefined,
      description: `EYO ${dto.tier} — ${school.name}`,
      // Its own webhook, not the school-payment one: that path settles into a school's fee
      // ledger, and a subscription must never land there.
      callbackUrl: `${apiBase}/billing/webhook`,
      returnUrl: `${webBase}/settings/billing?ref=${encodeURIComponent(invoice.reference)}`,
    });

    await this.db.subscriptionInvoice.update({
      where: { id: invoice.id },
      data: { provider: kind },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'billing.subscribe',
      'SubscriptionInvoice',
      invoice.id,
      {
        tier: dto.tier,
        amount: quote.amount,
      },
    );

    return {
      reference: invoice.reference,
      amount: quote.amount,
      currency: quote.currency,
      tier: dto.tier,
      checkoutUrl: result.checkoutUrl,
      status: result.status,
    };
  }

  /**
   * Apply a confirmed subscription payment.
   *
   * The only place a tier is raised. Idempotent on the invoice's own status, because a gateway
   * will redeliver a webhook and a second application must not extend the period twice.
   */
  async settle(reference: string, externalId?: string) {
    // The gateway knows a reference, not a school, so this first lookup has no tenant to run
    // under and RLS would return nothing. It is one of the few deliberate uses of the owner
    // client — see prisma.service.ts. Everything after it runs inside the school's scope.
    const invoice = await this.db.system.subscriptionInvoice.findUnique({ where: { reference } });
    if (!invoice) return { ignored: 'unknown reference' };
    if (invoice.status === 'PAID') return { duplicate: true };

    return withTenant(invoice.schoolId, async () => {
      const paidAt = new Date();
      await this.db.subscriptionInvoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID', paidAt, externalId: externalId ?? null },
      });

      await this.db.subscription.upsert({
        where: { schoolId: invoice.schoolId },
        create: {
          schoolId: invoice.schoolId,
          tier: invoice.tier,
          status: 'ACTIVE',
          amount: invoice.amount,
          currency: invoice.currency,
          studentCount: invoice.studentCount,
          periodStart: invoice.periodStart,
          periodEnd: invoice.periodEnd,
        },
        update: {
          tier: invoice.tier,
          status: 'ACTIVE',
          amount: invoice.amount,
          studentCount: invoice.studentCount,
          periodStart: invoice.periodStart,
          periodEnd: invoice.periodEnd,
          // A fresh payment clears any pending downgrade — they have changed their mind.
          pendingTier: null,
        },
      });

      await this.db.school.update({
        where: { id: invoice.schoolId },
        data: { tier: invoice.tier },
      });
      await this.db.audit(
        invoice.schoolId,
        null,
        'billing.settled',
        'SubscriptionInvoice',
        invoice.id,
        {
          tier: invoice.tier,
          amount: Number(invoice.amount),
        },
      );
      return { settled: true, tier: invoice.tier };
    });
  }

  /**
   * Ask to move tier without paying — only ever downward.
   *
   * An upgrade needs money and goes through `subscribe`. A downgrade is recorded as an intention
   * and applied at period end by `applyDueChanges`, because the current term is already paid for.
   */
  async changeTier(auth: AuthUser, dto: ChangeTierDto) {
    const sub = await this.db.subscription.findUnique({ where: { schoolId: auth.schoolId } });
    const school = await this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } });
    const effect = changeEffect(school.tier, dto.tier, sub?.periodEnd ?? new Date());

    if (effect.kind === 'none') throw new BadRequestException(`Already on ${dto.tier}`);
    if (effect.kind === 'upgrade') {
      throw new BadRequestException('Upgrading needs a payment — choose the plan and pay for it');
    }
    if (!sub) {
      // No paid period to see out, so there is nothing to defer.
      await this.db.school.update({ where: { id: auth.schoolId }, data: { tier: dto.tier } });
      return { applied: true, tier: dto.tier };
    }

    await this.db.subscription.update({
      where: { schoolId: auth.schoolId },
      data: { pendingTier: dto.tier, status: dto.tier === 'BASIC' ? 'CANCELLING' : sub.status },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'billing.downgrade-scheduled',
      'Subscription',
      sub.id,
      {
        from: school.tier,
        to: dto.tier,
        effectiveAt: effect.effectiveAt,
      },
    );
    return {
      applied: false,
      tier: school.tier,
      pendingTier: dto.tier,
      effectiveAt: effect.effectiveAt,
      message: `You keep ${school.tier} until ${effect.effectiveAt.toDateString()}, then move to ${dto.tier}.`,
    };
  }

  async invoices(auth: AuthUser) {
    const rows = await this.db.subscriptionInvoice.findMany({
      where: { schoolId: auth.schoolId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      tier: r.tier,
      amount: Number(r.amount),
      currency: r.currency,
      studentCount: r.studentCount,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      status: r.status,
      paidAt: r.paidAt,
    }));
  }
}

@Controller('billing')
export class BillingController {
  constructor(private svc: BillingService) {}

  @Get('plans')
  @RequirePermission('billing.manage')
  plans(@CurrentUser() user: AuthUser) {
    return this.svc.plans(user);
  }

  @Get('invoices')
  @RequirePermission('billing.manage')
  invoices(@CurrentUser() user: AuthUser) {
    return this.svc.invoices(user);
  }

  /**
   * Both gates, deliberately. `billing.manage` is the permission the school can hand out, but
   * committing to a recurring bill stays the proprietor's own decision — it is the one place
   * where "the owner personally" is the right rule rather than "whoever holds the permission".
   */
  @Post('subscribe')
  @Roles('OWNER')
  @RequirePermission('billing.manage')
  subscribe(@CurrentUser() user: AuthUser, @Body() dto: SubscribeDto) {
    return this.svc.subscribe(user, dto);
  }

  @Post('change-tier')
  @Roles('OWNER')
  @RequirePermission('billing.manage')
  changeTier(@CurrentUser() user: AuthUser, @Body() dto: ChangeTierDto) {
    return this.svc.changeTier(user, dto);
  }

  /**
   * Vendor gateway callback. Public because the gateway has no session.
   *
   * Separate from the school-payment webhook on purpose: that one settles into a school's fee
   * ledger, and a subscription must never land there.
   */
  @Public()
  @Post('webhook')
  async webhook(
    @Req() req: { rawBody?: Buffer; body: unknown },
    @Headers('x-paystack-signature') signature?: string,
  ) {
    const body = req.body as {
      data?: { reference?: string; id?: string | number; status?: string };
      event?: string;
      Data?: { ClientReference?: string; TransactionId?: string; Status?: string };
    };

    // Paystack signs; verify before trusting anything in the payload.
    if (process.env.PLATFORM_GATEWAY === 'PAYSTACK') {
      const secret = process.env.PLATFORM_GATEWAY_SECRET ?? '';
      const ok = new PaystackProvider({ secret }).verifyWebhookSignature(
        { 'x-paystack-signature': signature },
        req.rawBody ?? Buffer.from(JSON.stringify(req.body)),
      );
      if (!ok) throw new BadRequestException('Bad signature');
    }

    const reference = body.data?.reference ?? body.Data?.ClientReference;
    const status = (body.data?.status ?? body.Data?.Status ?? '').toLowerCase();
    if (!reference) return { ignored: 'no reference' };
    if (status && !['success', 'paid', 'successful'].includes(status)) {
      return { ignored: `status ${status}` };
    }
    return this.svc.settle(reference, String(body.data?.id ?? body.Data?.TransactionId ?? ''));
  }

  /**
   * Development only: settle a mock subscription without a gateway.
   *
   * Guarded by the mock secret and refused outright in production, so it can never become a way
   * to grant a school a paid tier for free.
   */
  @Public()
  @Post('mock-settle')
  mockSettle(@Body() body: { reference: string; secret: string }) {
    if (process.env.NODE_ENV === 'production') throw new NotFoundException();
    if (body?.secret !== MOCK_SECRET) throw new BadRequestException('Bad mock secret');
    return this.svc.settle(body.reference, `mock-${Date.now()}`);
  }
}

@Module({
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
