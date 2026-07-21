import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Req,
  UnauthorizedException,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
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
import { balanceOf } from '../common/ledger';
import {
  WhatsAppIntent,
  classifyMessage,
  menuChoice,
  menuText,
  pickNumber,
} from '../common/whatsapp-intents';
import { LicenceService } from '../licence/licence.service';
import { SmsModule, SmsService } from '../sms/sms.module';

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

/** What the assistant remembers between two messages. Deliberately this small. */
interface BotState {
  pending?: WhatsAppIntent;
  handedOff?: boolean;
}

@Injectable()
export class WhatsAppService {
  private provider: WhatsAppProvider;

  constructor(
    private db: PrismaService,
    private licence: LicenceService,
    private sms: SmsService,
  ) {
    const { WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TOKEN } = process.env;
    const configured = WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_TOKEN;
    // Same reasoning as SmsService: a mock that reports success in production tells a school its
    // reply reached a parent when nothing was sent. A reply inside the 24-hour window is often
    // answering a worried question, so silently dropping it is worse than refusing to start.
    if (
      !configured &&
      process.env.NODE_ENV === 'production' &&
      process.env.ALLOW_MOCK_SMS !== 'true'
    ) {
      throw new Error(
        'No WhatsApp provider configured. Set WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_TOKEN, or ALLOW_MOCK_SMS=true to accept that no reply will be delivered.',
      );
    }
    this.provider = configured
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

      // A message after the old window closed starts a fresh conversation, so the assistant's
      // memory — including a hand-off to staff — resets rather than silencing the bot forever.
      const previous = await this.db.whatsAppConversation.findUnique({
        where: { schoolId_phone: { schoolId, phone } },
        select: { windowExpiresAt: true },
      });
      const freshWindow = !previous?.windowExpiresAt || previous.windowExpiresAt < now;

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
          ...(freshWindow ? { botState: Prisma.DbNull } : {}),
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

      // The assistant answers inside the same webhook handling, best-effort: a bot failure must
      // never make Meta retry the inbound message, so nothing here is allowed to throw out.
      try {
        await this.maybeAutoReply(schoolId, conv.id, body);
      } catch (e) {
        console.error('[whatsapp:bot] auto-reply failed', e);
      }

      return { conversationId: conv.id, windowExpiresAt: expires };
    });
  }

  // ── The assistant (FEATURES.md §12) ────────────────────────────────

  /** Send as the bot: no sentById, and the window rules hold exactly as for a human reply. */
  private async sendBot(conv: { id: string; phone: string; schoolId: string }, body: string) {
    const sent = await this.provider.send(conv.phone, body);
    await this.db.whatsAppMessage.create({
      data: {
        schoolId: conv.schoolId,
        conversationId: conv.id,
        direction: 'OUTBOUND',
        body,
        externalId: sent.externalId ?? null,
      },
    });
    await this.db.whatsAppConversation.update({
      where: { id: conv.id },
      data: { lastOutboundAt: new Date() },
    });
  }

  private async setBotState(convId: string, state: BotState) {
    await this.db.whatsAppConversation.update({
      where: { id: convId },
      data: { botState: state as object },
    });
  }

  /**
   * The set-list assistant. Every answer comes from live records; a parent only ever gets their
   * own children's information (the phone number IS the identity — an unrecognised number gets
   * no ward data attached, ever); anything off the list goes to a person rather than being
   * guessed at; and once a person asks for a person, the bot stays silent for the window.
   */
  private async maybeAutoReply(schoolId: string, convId: string, text: string) {
    if (!this.licence.entitlements().includes('comms.whatsapp.chatbot')) return;

    const conv = await this.db.whatsAppConversation.findUniqueOrThrow({
      where: { id: convId },
      include: { guardian: true },
    });
    const state: BotState = (conv.botState as BotState) ?? {};
    if (state.handedOff) return;

    const school = await this.db.school.findUniqueOrThrow({ where: { id: schoolId } });

    // Identity first. An unknown number gets pointed at the office, never at a child.
    if (!conv.guardian) {
      await this.sendBot(
        conv,
        [
          `Hello — this is ${school.name}'s assistant.`,
          `This number isn't linked to a family here yet, so I can't share any child's information with it.`,
          `If you're a parent at ${school.name}, ask the office to add this number${school.phone ? `, or call ${school.phone}` : ''}.`,
        ].join(' '),
      );
      return;
    }

    const links = await this.db.studentGuardian.findMany({
      where: { guardianId: conv.guardian.id, student: { status: 'ACTIVE' } },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            classId: true,
            classRoom: { select: { name: true, classTeacherId: true } },
          },
        },
      },
    });
    const wards = links.map((l) => l.student);
    const firstName = conv.guardian.firstName;

    // A bare number can be answering a ward prompt.
    let intent: WhatsAppIntent | null = null;
    let ward: (typeof wards)[number] | null = null;
    if (state.pending) {
      const n = pickNumber(text, wards.length);
      if (n !== null) {
        intent = state.pending;
        ward = wards[n - 1];
        await this.setBotState(convId, { ...state, pending: undefined });
      }
    }
    if (!intent) intent = menuChoice(text) ?? classifyMessage(text);

    if (intent === 'HUMAN') {
      await this.setBotState(convId, { handedOff: true });
      await this.sendBot(
        conv,
        `No problem, ${firstName} — I've passed this to the ${school.name} office. Someone will reply here as soon as they can.`,
      );
      return;
    }
    if (intent === 'MENU' || intent === 'UNKNOWN') {
      const prefix =
        intent === 'UNKNOWN'
          ? `Sorry ${firstName}, that's outside what I can answer — reply 7 and a person will help.\n\n`
          : `Hello ${firstName}! `;
      await this.sendBot(conv, prefix + menuText(school.name));
      return;
    }
    if (intent === 'NOTICES') {
      await this.sendBot(conv, await this.noticesAnswer(schoolId));
      return;
    }

    // Everything left is about one child. With several, ask which — by name, numbered.
    if (wards.length === 0) {
      await this.sendBot(
        conv,
        `${firstName}, this number isn't linked to any current pupil at ${school.name} — ask the office to check the link.`,
      );
      return;
    }
    if (!ward && wards.length === 1) ward = wards[0];
    if (!ward) {
      await this.setBotState(convId, { ...state, pending: intent });
      await this.sendBot(
        conv,
        `Which child, ${firstName}?\n` +
          wards
            .map(
              (w, i) =>
                `${i + 1}. ${w.firstName} ${w.lastName}${w.classRoom ? ` (${w.classRoom.name})` : ''}`,
            )
            .join('\n') +
          '\n\nReply with the number.',
      );
      return;
    }

    switch (intent) {
      case 'BALANCE':
        await this.sendBot(conv, await this.balanceAnswer(schoolId, ward, school.currency));
        return;
      case 'RESULTS':
        await this.sendBot(conv, await this.resultsAnswer(schoolId, ward));
        return;
      case 'ATTENDANCE':
        await this.sendBot(conv, await this.attendanceAnswer(schoolId, ward));
        return;
      case 'REPORT_ABSENCE':
        await this.sendBot(conv, await this.absenceAnswer(schoolId, ward, text, conv.guardian));
        return;
      case 'PICKUP_CHANGE':
        await this.sendBot(
          conv,
          await this.pickupChangeAnswer(schoolId, ward, text, conv.guardian),
        );
        return;
    }
  }

  private money(currency: string, n: number) {
    return `${currency} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private async balanceAnswer(
    schoolId: string,
    ward: { id: string; firstName: string },
    currency: string,
  ) {
    const entries = await this.db.ledgerEntry.findMany({
      where: { schoolId, studentId: ward.id },
      orderBy: { createdAt: 'desc' },
    });
    const balance = balanceOf(entries);
    const recent = entries
      .slice(0, 3)
      .map((e) => {
        const label =
          e.type === 'INVOICE' ? 'billed' : e.type === 'PAYMENT' ? 'paid' : e.type.toLowerCase();
        return `• ${e.createdAt.toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })}: ${label} ${this.money(currency, Number(e.amount))}`;
      })
      .join('\n');
    const headline =
      balance > 0
        ? `${ward.firstName}'s balance is ${this.money(currency, balance)}.`
        : `${ward.firstName}'s account is fully paid — nothing is owing.`;
    return `${headline}${recent ? `\n\nRecent activity:\n${recent}` : ''}\n\nThe full statement is in the family portal.`;
  }

  private async resultsAnswer(schoolId: string, ward: { id: string; firstName: string }) {
    const report = await this.db.termReport.findFirst({
      where: { schoolId, studentId: ward.id, publishedAt: { not: null } },
      orderBy: { publishedAt: 'desc' },
    });
    if (!report) {
      return `${ward.firstName}'s next terminal report hasn't been released yet. You'll get a text the moment it is published.`;
    }
    const term = await this.db.term.findUnique({
      where: { id: report.termId },
      include: { academicYear: { select: { name: true } } },
    });
    const position =
      report.classPosition && report.classSize
        ? ` Position ${report.classPosition} of ${report.classSize}.`
        : '';
    return (
      `${ward.firstName}'s ${term?.name ?? 'terminal'} report (${term?.academicYear.name ?? ''}) is out: ` +
      `overall total ${Number(report.overallTotal).toFixed(1)}.${position}\n\n` +
      `Sign in to the family portal with this phone number to read and download it.`
    );
  }

  private async attendanceAnswer(schoolId: string, ward: { id: string; firstName: string }) {
    const term = await this.db.term.findFirst({
      where: { isCurrent: true, academicYear: { schoolId, isCurrent: true } },
    });
    const counts = await this.db.attendanceRecord.groupBy({
      by: ['status'],
      where: {
        studentId: ward.id,
        ...(term ? { date: { gte: term.startDate, lte: term.endDate } } : {}),
      },
      _count: true,
    });
    const by = Object.fromEntries(counts.map((c) => [c.status, c._count])) as Record<
      string,
      number
    >;
    const total = counts.reduce((s, c) => s + c._count, 0);
    if (total === 0) return `No attendance has been marked for ${ward.firstName} this term yet.`;
    return (
      `${ward.firstName} this term: present ${by.PRESENT ?? 0}, late ${by.LATE ?? 0}, ` +
      `absent ${by.ABSENT ?? 0}, excused ${by.EXCUSED ?? 0} — out of ${total} marked days.`
    );
  }

  private async absenceAnswer(
    schoolId: string,
    ward: {
      id: string;
      firstName: string;
      classRoom: { name: string; classTeacherId: string | null } | null;
    },
    text: string,
    guardian: { id: string; firstName: string; lastName: string },
  ) {
    // Tell the class teacher, when there is one with a phone on file. Deduped per child per
    // day, so a worried parent messaging twice does not text the teacher twice.
    const stamp = new Date().toISOString().slice(0, 10);
    const teacher = ward.classRoom?.classTeacherId
      ? await this.db.user.findFirst({
          where: { id: ward.classRoom.classTeacherId, schoolId },
          select: { phone: true },
        })
      : null;
    if (teacher?.phone) {
      await this.sms.sendToPhones({
        schoolId,
        phones: [teacher.phone],
        body: `${guardian.firstName} ${guardian.lastName} says ${ward.firstName} (${ward.classRoom?.name}) is absent today: "${text.slice(0, 120)}"`,
        batchId: `WABOT-ABS-${stamp}-${ward.id}`,
      });
    }
    await this.db.audit(schoolId, null, 'whatsapp.bot.absence', 'Student', ward.id, {
      reportedBy: guardian.id,
    });
    return (
      `Sorry to hear it — I've noted ${ward.firstName} as away today and told the class teacher. ` +
      `Wishing them a quick recovery.`
    );
  }

  private async pickupChangeAnswer(
    schoolId: string,
    ward: { id: string; firstName: string },
    text: string,
    guardian: { id: string },
  ) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await this.db.dismissalRequest.create({
      data: {
        schoolId,
        studentId: ward.id,
        guardianId: guardian.id,
        forDate: today,
        details: `Via WhatsApp: ${text.slice(0, 400)}`,
      },
    });
    await this.db.audit(schoolId, null, 'whatsapp.bot.dismissal', 'Student', ward.id);
    return (
      `Noted — I've logged that for the office to approve. Nothing changes at the gate until ` +
      `they confirm, and you'll get a text either way.`
    );
  }

  private async noticesAnswer(schoolId: string) {
    const [notices, events] = await Promise.all([
      this.db.announcement.findMany({
        where: { schoolId, audience: { in: ['ALL', 'GUARDIANS'] } },
        orderBy: { publishedAt: 'desc' },
        take: 3,
      }),
      this.db.calendarEvent.findMany({
        where: { schoolId, startsAt: { gte: new Date() } },
        orderBy: { startsAt: 'asc' },
        take: 3,
      }),
    ]);
    const parts: string[] = [];
    if (notices.length > 0) {
      parts.push('Latest notices:\n' + notices.map((n) => `• ${n.title}`).join('\n'));
    }
    if (events.length > 0) {
      parts.push(
        'Coming up:\n' +
          events
            .map(
              (e) =>
                `• ${e.startsAt.toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })} — ${e.title}`,
            )
            .join('\n'),
      );
    }
    if (parts.length === 0) return 'Nothing is on the notice board or calendar just now.';
    return parts.join('\n\n') + '\n\nThe full board is in the family portal.';
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

  /**
   * Meta's inbound callback.
   *
   * Signature-verified, which it previously was not. An unauthenticated webhook here is worse
   * than it looks: besides letting anyone inject messages into any school's inbox attributed to
   * any number, it sets `windowExpiresAt` — and that window is the ONE checkpoint enforcing
   * "the school never opens a conversation". Forge an inbound message and you have forced the
   * door open. See common/whatsapp-window.ts.
   */
  @Public()
  @Post('webhook/:schoolId')
  async inbound(
    @Param('schoolId') schoolId: string,
    @Body() payload: unknown,
    @Req() req: { rawBody?: Buffer },
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!appSecret) {
      // Fail closed. An unverifiable callback is not a callback we can act on.
      throw new BadRequestException('WhatsApp callbacks are not configured');
    }
    const body = req.rawBody ?? Buffer.from(JSON.stringify(payload));
    const expected = 'sha256=' + createHmac('sha256', appSecret).update(body).digest('hex');
    const given = signature ?? '';
    // Constant-time: a length mismatch would otherwise leak through the comparison itself.
    if (
      given.length !== expected.length ||
      !timingSafeEqual(Buffer.from(given), Buffer.from(expected))
    ) {
      throw new UnauthorizedException('Bad signature');
    }
    return this.handleInbound(schoolId, payload);
  }

  private async handleInbound(schoolId: string, payload: unknown) {
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

@Module({ imports: [SmsModule], controllers: [WhatsAppController], providers: [WhatsAppService] })
export class WhatsAppModule {}
