import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { PrismaService, withTenant } from '../prisma/prisma.service';
import {
  AuthUser,
  CurrentUser,
  Public,
  RequireEntitlement,
  RequirePermission,
} from '../common/auth';
import { canReply, minutesLeft, windowFromInbound } from '../common/whatsapp-window';
import { normalizeMsisdn } from '../common/phone';

/**
 * WhatsApp, strictly reply-only.
 *
 * The school never opens a conversation — see common/whatsapp-window.ts for why, and for the
 * rule that enforces it. There is deliberately no "send template" path anywhere in this module:
 * the absence is the feature. Anything that needs to reach a family unprompted goes by SMS.
 */

class ReplyDto {
  @IsString() @MinLength(1) body: string;
}

export interface WhatsAppProvider {
  readonly kind: string;
  send(to: string, body: string): Promise<{ externalId?: string }>;
}

/** Meta Cloud API. Only ever asked to send free-form replies inside an open window. */
class CloudApiProvider implements WhatsAppProvider {
  readonly kind = 'META';
  constructor(
    private phoneNumberId: string,
    private token: string,
  ) {}

  async send(to: string, body: string) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace('+', ''),
        type: 'text',
        text: { body },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new BadRequestException(data.error?.message ?? 'WhatsApp rejected that message');
    }
    return { externalId: data.messages?.[0]?.id };
  }
}

/** Development stand-in. Logs instead of sending, and says so, so nobody mistakes it for live. */
class MockWhatsAppProvider implements WhatsAppProvider {
  readonly kind = 'MOCK';
  async send(to: string, body: string) {
    console.log(`[whatsapp:mock] → ${to}: ${body.slice(0, 80)}`);
    return { externalId: `mock-${Date.now()}` };
  }
}

@Injectable()
export class WhatsAppService {
  private provider: WhatsAppProvider;

  constructor(private db: PrismaService) {
    const { WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TOKEN } = process.env;
    this.provider =
      WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_TOKEN
        ? new CloudApiProvider(WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TOKEN)
        : new MockWhatsAppProvider();
  }

  /**
   * A message arriving from a guardian.
   *
   * This is the only thing that opens a window, so it is the only reason the school can ever
   * reply. Redelivery is expected — Meta retries webhooks — so the provider's message id makes
   * it idempotent rather than appending the same message twice.
   */
  async receive(schoolId: string, from: string, body: string, externalId?: string) {
    const phone = normalizeMsisdn(from);
    if (!phone) return { ignored: 'unreadable phone number' };

    return withTenant(schoolId, async () => {
      if (externalId) {
        const seen = await this.db.whatsAppMessage.findFirst({
          where: { schoolId, externalId },
        });
        if (seen) return { duplicate: true };
      }

      // Link to a guardian when we recognise the number; an unknown number still gets a thread
      // so the front office can see it and reply, but no ward data is ever attached to it.
      //
      // Matched on the last nine digits, as the OTP flow does. Numbers reach us in several
      // shapes — WhatsApp sends 233…, guardians are stored +233…, and schools type 024… — and an
      // exact comparison silently fails to recognise a parent it should know.
      const guardian = await this.db.guardian.findFirst({
        where: { schoolId, phone: { contains: phone.slice(-9) } },
      });
      const now = new Date();
      const expires = windowFromInbound(now);

      const conv = await this.db.whatsAppConversation.upsert({
        where: { schoolId_phone: { schoolId, phone } },
        create: {
          schoolId,
          phone,
          guardianId: guardian?.id ?? null,
          windowExpiresAt: expires,
          lastInboundAt: now,
        },
        update: {
          guardianId: guardian?.id ?? undefined,
          windowExpiresAt: expires,
          lastInboundAt: now,
        },
      });

      await this.db.whatsAppMessage.create({
        data: {
          schoolId,
          conversationId: conv.id,
          direction: 'INBOUND',
          body,
          externalId: externalId ?? null,
        },
      });
      return { conversationId: conv.id, windowExpiresAt: expires };
    });
  }

  /** Open threads, most recently active first, with how long is left to answer each. */
  async conversations(auth: AuthUser) {
    const rows = await this.db.whatsAppConversation.findMany({
      where: { schoolId: auth.schoolId },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: {
        guardian: { select: { firstName: true, lastName: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const now = new Date();
    return rows.map((c) => ({
      id: c.id,
      phone: c.phone,
      name: c.guardian ? `${c.guardian.firstName} ${c.guardian.lastName}` : null,
      lastMessage: c.messages[0]?.body ?? null,
      lastInboundAt: c.lastInboundAt,
      minutesLeft: minutesLeft(c, now),
      canReply: canReply(c, now).allowed,
    }));
  }

  async thread(auth: AuthUser, id: string) {
    const conv = await this.db.whatsAppConversation.findFirst({
      where: { id, schoolId: auth.schoolId },
      include: { guardian: { select: { firstName: true, lastName: true } } },
    });
    if (!conv) throw new NotFoundException('No such conversation');
    const messages = await this.db.whatsAppMessage.findMany({
      where: { schoolId: auth.schoolId, conversationId: id },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const decision = canReply(conv);
    return {
      id: conv.id,
      phone: conv.phone,
      name: conv.guardian ? `${conv.guardian.firstName} ${conv.guardian.lastName}` : null,
      canReply: decision.allowed,
      /** Present when the school may not reply — shown to the user instead of a dead button. */
      blockedReason: decision.allowed ? null : decision.reason,
      minutesLeft: minutesLeft(conv),
      messages: messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        body: m.body,
        createdAt: m.createdAt,
      })),
    };
  }

  /**
   * Reply to a family.
   *
   * `canReply` is checked here, on the server, immediately before sending. The UI hides the box
   * when the window is shut, but a window can close between page load and click, and the rule
   * that the school never initiates has to hold at the only point that actually sends.
   */
  async reply(auth: AuthUser, id: string, dto: ReplyDto) {
    const conv = await this.db.whatsAppConversation.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!conv) throw new NotFoundException('No such conversation');

    const decision = canReply(conv);
    if (!decision.allowed) throw new BadRequestException(decision.reason);

    const sent = await this.provider.send(conv.phone, dto.body);
    const now = new Date();
    await this.db.whatsAppMessage.create({
      data: {
        schoolId: auth.schoolId,
        conversationId: conv.id,
        direction: 'OUTBOUND',
        body: dto.body,
        externalId: sent.externalId ?? null,
        sentById: auth.sub,
      },
    });
    await this.db.whatsAppConversation.update({
      where: { id: conv.id },
      data: { lastOutboundAt: now },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'whatsapp.reply', 'WhatsAppConversation', conv.id);
    return { sent: true, provider: this.provider.kind };
  }
}

@Controller('whatsapp')
export class WhatsAppController {
  constructor(private svc: WhatsAppService) {}

  /**
   * Meta's verification handshake. Public by necessity — Meta calls it before any token exists.
   */
  @Public()
  @Get('webhook/:schoolId')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return challenge;
    }
    throw new BadRequestException('Verification failed');
  }

  @Public()
  @Post('webhook/:schoolId')
  async inbound(@Param('schoolId') schoolId: string, @Body() payload: unknown) {
    // Meta nests messages several levels deep and will happily deliver status-only callbacks
    // that contain none. Walk defensively and ignore anything that is not a text message.
    const body = payload as {
      entry?: {
        changes?: {
          value?: { messages?: { from?: string; id?: string; text?: { body?: string } }[] };
        }[];
      }[];
    };
    const messages =
      body.entry?.flatMap((e) => e.changes?.flatMap((c) => c.value?.messages ?? []) ?? []) ?? [];

    const results = [];
    for (const m of messages) {
      if (!m.from || !m.text?.body) continue;
      results.push(await this.svc.receive(schoolId, m.from, m.text.body, m.id));
    }
    // Always 200: Meta retries anything else, and a retry loop on a message we chose to ignore
    // is worse than silence.
    return { received: results.length };
  }

  @Get('conversations')
  @RequirePermission('comms.whatsapp')
  @RequireEntitlement('comms.whatsapp.templates')
  conversations(@CurrentUser() user: AuthUser) {
    return this.svc.conversations(user);
  }

  @Get('conversations/:id')
  @RequirePermission('comms.whatsapp')
  @RequireEntitlement('comms.whatsapp.templates')
  thread(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.thread(user, id);
  }

  @Post('conversations/:id/reply')
  @RequirePermission('comms.whatsapp')
  @RequireEntitlement('comms.whatsapp.templates')
  reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReplyDto) {
    return this.svc.reply(user, id, dto);
  }
}

@Module({ controllers: [WhatsAppController], providers: [WhatsAppService] })
export class WhatsAppModule {}
