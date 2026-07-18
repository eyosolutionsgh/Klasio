import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
} from '@nestjs/common';
import { IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequireEntitlement, RequirePermission } from '../common/auth';

type Audience = 'ALL' | 'CLASS' | 'LEVEL' | 'CUSTOM';

class SendSmsDto {
  @IsString() @MinLength(1) @MaxLength(640) body: string;
  @IsIn(['ALL', 'CLASS', 'LEVEL', 'CUSTOM']) audience: Audience;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() levelId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) recipients?: string[];
}

interface SmsResult {
  ok: boolean;
  ref?: string;
  error?: string;
}
interface SmsProvider {
  name: string;
  send(to: string, body: string, sender: string): Promise<SmsResult>;
}

/** Dev/offline fallback: logs the message and reports success without spending credits at a gateway. */
class MockSmsProvider implements SmsProvider {
  name = 'mock';
  async send(to: string, body: string): Promise<SmsResult> {
    console.log(`[SMS mock] → ${to}: ${body}`);
    return { ok: true, ref: `mock-${to}` };
  }
}

/**
 * Nalo Solutions gateway. Uses the classic query-string send API; the exact parameter/response
 * contract is finalized once live credentials are provided. Falls back to mock when creds absent.
 */
class NaloSmsProvider implements SmsProvider {
  name = 'nalo';
  constructor(
    private cfg: { endpoint: string; username: string; password: string; source: string },
  ) {}

  async send(to: string, body: string, sender: string): Promise<SmsResult> {
    const url = new URL(this.cfg.endpoint);
    url.searchParams.set('username', this.cfg.username);
    url.searchParams.set('password', this.cfg.password);
    url.searchParams.set('type', '0');
    url.searchParams.set('destination', to);
    url.searchParams.set('dlr', '1');
    url.searchParams.set('source', sender || this.cfg.source);
    url.searchParams.set('message', body);
    try {
      const res = await fetch(url, { method: 'GET' });
      const text = (await res.text()).trim();
      // Nalo returns "1701|<destination>|<message-id>" on a successful submission.
      const ok = res.ok && text.startsWith('1701');
      return ok ? { ok: true, ref: text } : { ok: false, error: text || `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'network error' };
    }
  }
}

/** Ghana MSISDN normalization: strip spaces/+, map leading 0 to 233. */
function normalizeMsisdn(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return null;
  if (digits.startsWith('233')) return digits;
  if (digits.startsWith('0')) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits;
}

@Injectable()
export class SmsService {
  private provider: SmsProvider;
  constructor(private db: PrismaService) {
    const { NALO_SMS_ENDPOINT, NALO_SMS_USERNAME, NALO_SMS_PASSWORD, NALO_SMS_SOURCE } =
      process.env;
    this.provider =
      NALO_SMS_ENDPOINT && NALO_SMS_USERNAME && NALO_SMS_PASSWORD
        ? new NaloSmsProvider({
            endpoint: NALO_SMS_ENDPOINT,
            username: NALO_SMS_USERNAME,
            password: NALO_SMS_PASSWORD,
            source: NALO_SMS_SOURCE ?? '',
          })
        : new MockSmsProvider();
  }

  /** Resolve the distinct guardian phone numbers for the requested audience. */
  private async resolveRecipients(auth: AuthUser, dto: SendSmsDto): Promise<string[]> {
    if (dto.audience === 'CUSTOM') {
      return [
        ...new Set((dto.recipients ?? []).map(normalizeMsisdn).filter((x): x is string => !!x)),
      ];
    }
    const where: {
      schoolId: string;
      status: 'ACTIVE';
      classId?: string;
      classRoom?: { levelId: string };
    } = { schoolId: auth.schoolId, status: 'ACTIVE' };
    if (dto.audience === 'CLASS') {
      if (!dto.classId) throw new BadRequestException('classId required for CLASS audience');
      where.classId = dto.classId;
    }
    if (dto.audience === 'LEVEL') {
      if (!dto.levelId) throw new BadRequestException('levelId required for LEVEL audience');
      where.classRoom = { levelId: dto.levelId };
    }
    const students = await this.db.student.findMany({
      where,
      select: {
        guardians: {
          where: { isPrimary: true },
          select: { guardian: { select: { phone: true } } },
        },
      },
    });
    const phones = students
      .flatMap((s) => s.guardians.map((g) => g.guardian.phone))
      .map(normalizeMsisdn)
      .filter((x): x is string => !!x);
    return [...new Set(phones)];
  }

  /**
   * Send to an explicit list of numbers on behalf of the school, for messages the system raises
   * itself (absence alerts, results notices, fee reminders) rather than a staff broadcast.
   *
   * Credit is the school's, so a run stops at whatever credit is left rather than failing
   * outright — a partial notification is worth more than none, and the caller is told.
   */
  async sendToPhones(opts: {
    schoolId: string;
    createdById: string;
    phones: string[];
    body: string;
    batchId: string;
  }) {
    const recipients = [
      ...new Set(opts.phones.map(normalizeMsisdn).filter((x): x is string => !!x)),
    ];
    if (recipients.length === 0) return { sent: 0, failed: 0, skipped: 0 };

    const school = await this.db.school.findUniqueOrThrow({ where: { id: opts.schoolId } });
    const affordable = recipients.slice(0, school.smsCredits);
    const skipped = recipients.length - affordable.length;
    const sender = school.smsSenderId ?? 'SCHOOL';

    let sent = 0;
    let failed = 0;
    for (const to of affordable) {
      const result = await this.provider.send(to, opts.body, sender);
      if (result.ok) sent++;
      else failed++;
      await this.db.smsMessage.create({
        data: {
          schoolId: opts.schoolId,
          to,
          body: opts.body,
          status: result.ok ? 'SENT' : 'FAILED',
          provider: this.provider.name,
          providerRef: result.ref ?? null,
          cost: 1,
          batchId: opts.batchId,
          error: result.error ?? null,
          createdById: opts.createdById,
        },
      });
    }
    if (sent > 0) {
      await this.db.school.update({
        where: { id: opts.schoolId },
        data: { smsCredits: { decrement: sent } },
      });
    }
    return { sent, failed, skipped };
  }

  /** Has this batch already gone out? Keeps automatic alerts to one per subject per day. */
  async alreadySent(schoolId: string, batchId: string) {
    const existing = await this.db.smsMessage.findFirst({ where: { schoolId, batchId } });
    return !!existing;
  }

  async send(auth: AuthUser, dto: SendSmsDto) {
    const recipients = await this.resolveRecipients(auth, dto);
    if (recipients.length === 0) throw new BadRequestException('No recipients matched');

    const school = await this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } });
    if (school.smsCredits < recipients.length) {
      throw new BadRequestException(
        `Insufficient SMS credits: need ${recipients.length}, have ${school.smsCredits}`,
      );
    }
    const sender = school.smsSenderId ?? 'SCHOOL';
    const batchId = `SMS-${Date.now()}`;

    let sent = 0;
    let failed = 0;
    for (const to of recipients) {
      const result = await this.provider.send(to, dto.body, sender);
      if (result.ok) sent++;
      else failed++;
      await this.db.smsMessage.create({
        data: {
          schoolId: auth.schoolId,
          to,
          body: dto.body,
          status: result.ok ? 'SENT' : 'FAILED',
          provider: this.provider.name,
          providerRef: result.ref ?? null,
          cost: 1,
          batchId,
          error: result.error ?? null,
          createdById: auth.sub,
        },
      });
    }
    // Debit only successful sends.
    const updated = await this.db.school.update({
      where: { id: auth.schoolId },
      data: { smsCredits: { decrement: sent } },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'sms.send', 'School', auth.schoolId, {
      audience: dto.audience,
      recipients: recipients.length,
      sent,
      failed,
      batchId,
    });
    return {
      batchId,
      recipients: recipients.length,
      sent,
      failed,
      creditsRemaining: updated.smsCredits,
    };
  }

  async messages(auth: AuthUser) {
    const messages = await this.db.smsMessage.findMany({
      where: { schoolId: auth.schoolId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return messages.map((m) => ({
      id: m.id,
      to: m.to,
      body: m.body,
      status: m.status,
      provider: m.provider,
      batchId: m.batchId,
      error: m.error,
      createdAt: m.createdAt,
    }));
  }

  async balance(auth: AuthUser) {
    const school = await this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } });
    return {
      credits: school.smsCredits,
      senderId: school.smsSenderId,
      provider: this.provider.name,
    };
  }
}

@Controller('sms')
export class SmsController {
  constructor(private svc: SmsService) {}

  @Get('balance')
  @RequireEntitlement('comms.sms')
  @RequirePermission('comms.sms')
  balance(@CurrentUser() user: AuthUser) {
    return this.svc.balance(user);
  }

  @Get('messages')
  @RequireEntitlement('comms.sms')
  @RequirePermission('comms.sms')
  messages(@CurrentUser() user: AuthUser) {
    return this.svc.messages(user);
  }

  @Post('send')
  @RequireEntitlement('comms.sms')
  @RequirePermission('comms.sms')
  send(@CurrentUser() user: AuthUser, @Body() dto: SendSmsDto) {
    return this.svc.send(user, dto);
  }
}

@Module({ controllers: [SmsController], providers: [SmsService], exports: [SmsService] })
export class SmsModule {}
