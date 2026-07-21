/**
 * Connect Klasio to other systems (FEATURES.md §18, platform.api).
 *
 * Two halves. Staff manage keys: minted once, shown once, stored as a SHA-256 hash with only a
 * recognisable prefix kept. Outside systems present `x-api-key` against a small READ-ONLY
 * surface under /integration/v1 — deliberately its own controller with its own check, so no
 * careless edit can ever let a key reach the staff API. Outside systems observe Klasio; they
 * never write a mark or a ledger row.
 */
import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { createHash, createHmac, randomBytes } from 'crypto';
import { PrismaService, withTenant } from '../prisma/prisma.service';
import {
  AuthUser,
  CurrentUser,
  Public,
  RequireEntitlement,
  RequirePermission,
} from '../common/auth';
import { balanceOf } from '../common/ledger';
import { asResponse } from '../common/http';

const hash = (key: string) => createHash('sha256').update(key).digest('hex');

class CreateKeyDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
}

class CreateWebhookDto {
  @IsString() @MinLength(8) @MaxLength(500) url: string;
  /** Empty or absent means every event, which is what most schools want. */
  @IsOptional() @IsArray() @IsString({ each: true }) events?: string[];
}

/** Authenticates `x-api-key` and pins the request to the key's school. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private db: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const key: string | undefined = req.headers['x-api-key'];
    if (!key) throw new UnauthorizedException('Provide an x-api-key header');
    // The lookup is by hash under db.system (no tenant is established yet); everything the
    // route then reads runs inside the key's own school.
    const row = await this.db.system.apiKey.findUnique({ where: { keyHash: hash(key) } });
    if (!row || row.revokedAt) throw new UnauthorizedException('That key is not valid');
    req.apiSchoolId = row.schoolId;
    // Best-effort freshness stamp; a failed update must not fail the read.
    this.db.system.apiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return true;
  }
}

@Injectable()
export class IntegrationsService {
  constructor(private db: PrismaService) {}

  async keys(auth: AuthUser) {
    const rows = await this.db.apiKey.findMany({
      where: { schoolId: auth.schoolId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      revoked: !!k.revokedAt,
    }));
  }

  /** Mint a key. The clear value is returned ONCE, here, and never stored. */
  async createKey(auth: AuthUser, dto: CreateKeyDto) {
    const key = `eyo_${randomBytes(24).toString('base64url')}`;
    await this.db.apiKey.create({
      data: {
        schoolId: auth.schoolId,
        name: dto.name.trim(),
        keyHash: hash(key),
        prefix: key.slice(0, 8),
        createdById: auth.sub,
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'integrations.key.create',
      'School',
      auth.schoolId,
      {
        name: dto.name,
      },
    );
    return { key, note: 'Shown once — store it now. Klasio keeps only a hash.' };
  }

  async revokeKey(auth: AuthUser, id: string) {
    const row = await this.db.apiKey.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!row) throw new NotFoundException('Key not found');
    await this.db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'integrations.key.revoke',
      'School',
      auth.schoolId,
      {
        name: row.name,
      },
    );
    return { ok: true };
  }

  // ── The read-only surface an outside system sees ───────────────────

  async externalStudents(schoolId: string) {
    return withTenant(schoolId, async () => {
      const students = await this.db.student.findMany({
        where: { schoolId, status: 'ACTIVE' },
        select: {
          admissionNo: true,
          firstName: true,
          lastName: true,
          gender: true,
          classRoom: { select: { name: true } },
        },
        orderBy: { admissionNo: 'asc' },
      });
      return students.map((s) => ({
        admissionNo: s.admissionNo,
        firstName: s.firstName,
        lastName: s.lastName,
        gender: s.gender,
        className: s.classRoom?.name ?? null,
      }));
    });
  }

  async externalFeesSummary(schoolId: string) {
    return withTenant(schoolId, async () => {
      const entries = await this.db.ledgerEntry.findMany({
        where: { schoolId },
        select: { id: true, type: true, amount: true, reversedId: true, studentId: true },
      });
      const byStudent = new Map<string, typeof entries>();
      for (const e of entries) {
        byStudent.set(e.studentId, [...(byStudent.get(e.studentId) ?? []), e]);
      }
      let outstanding = 0;
      let families = 0;
      for (const es of byStudent.values()) {
        const bal = balanceOf(es);
        if (bal > 0) {
          outstanding += bal;
          families++;
        }
      }
      return {
        studentsWithBalance: families,
        totalOutstanding: Math.round(outstanding * 100) / 100,
      };
    });
  }

  // ── Outbound webhooks ──────────────────────────────────────────────

  /**
   * Events a school can subscribe to. A closed list rather than anything the code happens to
   * emit, so adding an internal event never silently starts posting a school's data outwards.
   */
  static readonly EVENTS = [
    'payment.recorded',
    'student.enrolled',
    'student.exited',
    'reports.published',
    'attendance.marked',
  ] as const;

  async webhooks(auth: AuthUser) {
    const rows = await this.db.webhook.findMany({
      where: { schoolId: auth.schoolId },
      orderBy: { createdAt: 'desc' },
    });
    // The secret is shown once, at creation, and never again — like the API keys above.
    return rows.map((w) => ({
      id: w.id,
      url: w.url,
      events: w.events.length ? w.events : ['(all)'],
      active: w.active,
      lastStatus: w.lastStatus,
      lastError: w.lastError,
      lastSentAt: w.lastSentAt,
      createdAt: w.createdAt,
    }));
  }

  async createWebhook(auth: AuthUser, dto: CreateWebhookDto) {
    let url: URL;
    try {
      url = new URL(dto.url);
    } catch {
      throw new BadRequestException('That is not a valid URL');
    }
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      // A school's data leaving over plain HTTP is not a trade-off worth offering; localhost is
      // allowed because that is where a school's own on-box integration actually listens.
      throw new BadRequestException('Webhook URLs must be https');
    }
    const unknown = (dto.events ?? []).filter(
      (e) => !IntegrationsService.EVENTS.includes(e as (typeof IntegrationsService.EVENTS)[number]),
    );
    if (unknown.length) throw new BadRequestException(`Unknown event: ${unknown.join(', ')}`);

    const secret = randomBytes(24).toString('base64url');
    const row = await this.db.webhook.create({
      data: {
        schoolId: auth.schoolId,
        url: dto.url,
        events: dto.events ?? [],
        secret,
        createdById: auth.sub,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'webhook.create', 'Webhook', row.id, {
      url: dto.url,
    });
    // Shown once. Losing it means creating a new webhook, which is the correct cost.
    return { id: row.id, url: row.url, secret };
  }

  async deleteWebhook(auth: AuthUser, id: string) {
    const row = await this.db.webhook.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!row) throw new NotFoundException('Not found');
    await this.db.webhook.delete({ where: { id } });
    await this.db.audit(auth.schoolId, auth.sub, 'webhook.delete', 'Webhook', id);
    return { deleted: true };
  }

  /**
   * Post an event to every endpoint a school has subscribed for it.
   *
   * Deliberately fire-and-forget from the caller's point of view: a school's own endpoint being
   * slow or down must never fail the payment that triggered it. The outcome is recorded on the
   * webhook row so a dead endpoint is visible in Settings rather than only in logs the school
   * cannot read.
   *
   * Signed like the gateways sign theirs — HMAC-SHA256 over the exact bytes sent — so a receiver
   * can tell a real delivery from anyone who guessed the URL.
   */
  async dispatch(schoolId: string, event: string, payload: Record<string, unknown>) {
    const hooks = await this.db.system.webhook.findMany({
      where: { schoolId, active: true },
    });
    const targets = hooks.filter((h) => h.events.length === 0 || h.events.includes(event));
    if (targets.length === 0) return { sent: 0 };

    const body = JSON.stringify({
      event,
      schoolId,
      sentAt: new Date().toISOString(),
      data: payload,
    });
    let sent = 0;
    for (const hook of targets) {
      const signature = createHmac('sha256', hook.secret).update(body).digest('hex');
      try {
        const res = asResponse(
          await fetch(hook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Klasio-Event': event,
              'X-Klasio-Signature': `sha256=${signature}`,
            },
            body,
            signal: AbortSignal.timeout(8000),
          }),
        );
        await this.db.system.webhook.update({
          where: { id: hook.id },
          data: {
            lastStatus: res.status,
            lastError: res.ok ? null : `HTTP ${res.status}`,
            lastSentAt: new Date(),
          },
        });
        if (res.ok) sent++;
      } catch (e) {
        await this.db.system.webhook.update({
          where: { id: hook.id },
          data: { lastStatus: null, lastError: String(e).slice(0, 200), lastSentAt: new Date() },
        });
      }
    }
    return { sent };
  }
}

@Controller('integrations')
@RequireEntitlement('platform.api')
export class IntegrationsController {
  constructor(private svc: IntegrationsService) {}

  @Get('keys')
  @RequirePermission('school.settings')
  keys(@CurrentUser() user: AuthUser) {
    return this.svc.keys(user);
  }

  @Post('keys')
  @RequirePermission('school.settings')
  createKey(@CurrentUser() user: AuthUser, @Body() dto: CreateKeyDto) {
    return this.svc.createKey(user, dto);
  }

  @Delete('keys/:id')
  @RequirePermission('school.settings')
  revokeKey(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.revokeKey(user, id);
  }

  @Get('events')
  @RequirePermission('school.settings')
  events() {
    return IntegrationsService.EVENTS;
  }

  @Get('webhooks')
  @RequirePermission('school.settings')
  webhooks(@CurrentUser() user: AuthUser) {
    return this.svc.webhooks(user);
  }

  @Post('webhooks')
  @RequirePermission('school.settings')
  createWebhook(@CurrentUser() user: AuthUser, @Body() dto: CreateWebhookDto) {
    return this.svc.createWebhook(user, dto);
  }

  @Delete('webhooks/:id')
  @RequirePermission('school.settings')
  deleteWebhook(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteWebhook(user, id);
  }
}

/** What another system may read, with a key. Nothing here writes. */
@Controller('integration/v1')
@Public() // bypasses the staff guard; ApiKeyGuard authenticates instead
@UseGuards(ApiKeyGuard)
export class ExternalApiController {
  constructor(private svc: IntegrationsService) {}

  @Get('students')
  students(@Req() req: { apiSchoolId: string }) {
    return this.svc.externalStudents(req.apiSchoolId);
  }

  @Get('fees/summary')
  feesSummary(@Req() req: { apiSchoolId: string }) {
    return this.svc.externalFeesSummary(req.apiSchoolId);
  }
}

@Module({
  controllers: [IntegrationsController, ExternalApiController],
  providers: [IntegrationsService, ApiKeyGuard],
  // Exported so the modules that raise events can dispatch them. Nothing here imports back into
  // those modules, so this stays a one-way dependency.
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
