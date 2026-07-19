import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
  createParamDecorator,
} from '@nestjs/common';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { createHash } from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import type { NoticeLevel, Prisma, Tier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { publicToken } from '../common/crypto';

/**
 * EYO itself — the vendor — rather than any one school.
 *
 * Every other principal in this API belongs to a school and is fenced into it by row-level
 * security. This one is the opposite: it exists precisely to see across tenants, which is why it
 * gets its own table, its own signing secret, its own guard, and no `schoolId` at all. The blast
 * radius of confusing it with a school principal is every school at once, so nothing about it is
 * shared with them beyond the HTTP server.
 */

/**
 * Its own secret, so a leaked school-token secret cannot mint vendor authority.
 *
 * Refused outright in production rather than falling back. The fallback string is public in this
 * repository, and the 8-hour session below is no protection against knowing it: with the key,
 * any platform token ever observed — a proxy log, a browser history entry, a token pasted into a
 * bug report — can be re-signed with a fresh expiry forever. There is no jti and no session
 * table to revoke against, so the only defence is that the key is actually secret.
 */
export const platformJwtSecret = () => {
  const secret = process.env.PLATFORM_JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PLATFORM_JWT_SECRET must be set — it authenticates EYO across every school.');
  }
  return 'dev-platform-secret-do-not-use-in-prod';
};

/** Short. A session that can suspend every school in the country should not last a month. */
const SESSION = '8h';

/** How long an unaccepted invitation stays usable. */
const INVITE_DAYS = 30;

export interface PlatformUser {
  sub: string;
  kind: 'platform';
  name: string;
  email: string;
}

export function signPlatformToken(payload: PlatformUser): string {
  return jwt.sign(payload, platformJwtSecret(), { expiresIn: SESSION });
}

/** Invitation tokens are stored hashed; the plaintext is shown once and never again. */
export const hashInviteToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Authenticates the vendor.
 *
 * A positive check, mirroring `GuardianGuard`: the token must *say* it is a platform token, and
 * be signed with the platform secret. A staff or guardian token fails both tests.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private db: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Missing token');

    let payload: PlatformUser;
    try {
      payload = jwt.verify(token, platformJwtSecret()) as PlatformUser;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload?.kind !== 'platform') throw new UnauthorizedException('Not a platform session');

    // Re-read the account every request, for the same reason the staff guard does: a vendor
    // account that has been switched off must stop working now, not in eight hours.
    const admin = await this.db.system.platformAdmin.findUnique({
      where: { id: payload.sub },
      select: { id: true, active: true, name: true, email: true },
    });
    if (!admin?.active) throw new UnauthorizedException('This account is no longer active');

    req.platform = { sub: admin.id, kind: 'platform', name: admin.name, email: admin.email };
    return true;
  }
}

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PlatformUser => ctx.switchToHttp().getRequest().platform,
);

class PlatformLoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
}

class InviteDto {
  @IsString() @MinLength(2) @MaxLength(120) schoolName: string;
  @IsEmail() email: string;
  @IsOptional() @IsIn(['BASIC', 'MEDIUM', 'ADVANCED']) tier?: Tier;
  @IsOptional() @IsInt() @Min(1) @Max(365) expiresInDays?: number;
}

class SuspendDto {
  // A suspension a school cannot understand is one they cannot fix, so the reason is required.
  @IsString() @MinLength(4) @MaxLength(300) reason: string;
}

class ContactDto {
  @IsString() @MinLength(2) @MaxLength(120) subject: string;
  @IsString() @MinLength(2) @MaxLength(4000) body: string;
  @IsOptional() @IsIn(['INFO', 'WARNING']) level?: NoticeLevel;
}

class SchoolQueryDto {
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsIn(['all', 'active', 'suspended']) status?: 'all' | 'active' | 'suspended';
}

@Injectable()
export class PlatformService {
  constructor(private db: PrismaService) {}

  /**
   * Every read here is cross-tenant and therefore goes through `db.system`, the owner connection
   * that row-level security does not apply to. That is the whole point of this module and also
   * its main hazard: a tenant-scoped client would silently return an empty list rather than
   * fail, which reads like "no schools yet". Keeping all of it behind this one service is what
   * keeps `db.system` use "few and obvious", as prisma.service.ts asks.
   */

  private async record(
    admin: PlatformUser,
    action: string,
    school?: { id: string; name: string } | null,
    detail?: Prisma.InputJsonValue,
  ) {
    await this.db.system.platformAuditLog.create({
      data: {
        adminId: admin.sub,
        action,
        schoolId: school?.id ?? null,
        schoolName: school?.name ?? null,
        detail: detail ?? undefined,
      },
    });
  }

  async login(dto: PlatformLoginDto) {
    const admin = await this.db.system.platformAdmin.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    // One message for both failures, so this cannot be used to discover who works at EYO.
    const bad = new UnauthorizedException('Invalid email or password');
    if (!admin || !admin.active) throw bad;
    if (!(await bcrypt.compare(dto.password, admin.passwordHash))) throw bad;

    await this.db.system.platformAdmin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    const payload: PlatformUser = {
      sub: admin.id,
      kind: 'platform',
      name: admin.name,
      email: admin.email,
    };
    return { token: signPlatformToken(payload), admin: { name: admin.name, email: admin.email } };
  }

  /** Every school on the platform, with the numbers a vendor actually asks about. */
  async schools(query: SchoolQueryDto) {
    const status = query.status ?? 'all';
    const where: Prisma.SchoolWhereInput = {
      ...(status === 'active' ? { suspendedAt: null } : {}),
      ...(status === 'suspended' ? { NOT: { suspendedAt: null } } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              { email: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const schools = await this.db.system.school.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        phone: true,
        region: true,
        tier: true,
        suspendedAt: true,
        suspendedReason: true,
        createdAt: true,
        subscription: { select: { status: true, periodEnd: true, amount: true, currency: true } },
        _count: { select: { students: true, users: true } },
      },
    });

    return schools.map((s) => ({
      ...s,
      amount: s.subscription ? Number(s.subscription.amount) : null,
      studentCount: s._count.students,
      staffCount: s._count.users,
      suspended: s.suspendedAt !== null,
    }));
  }

  /** One school in more depth, including what EYO has said to it. */
  async school(id: string) {
    const school = await this.db.system.school.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        phone: true,
        address: true,
        region: true,
        website: true,
        tier: true,
        currency: true,
        suspendedAt: true,
        suspendedReason: true,
        createdAt: true,
        subscription: {
          select: {
            tier: true,
            status: true,
            amount: true,
            currency: true,
            periodStart: true,
            periodEnd: true,
          },
        },
        users: {
          where: { role: 'OWNER' },
          select: { id: true, name: true, email: true, active: true },
        },
        _count: { select: { students: true, users: true } },
      },
    });
    if (!school) throw new NotFoundException('No such school');

    const [notices, actions] = await Promise.all([
      this.db.system.platformNotice.findMany({
        where: { schoolId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          subject: true,
          body: true,
          level: true,
          readAt: true,
          createdAt: true,
          sentBy: { select: { name: true } },
        },
      }),
      this.db.system.platformAuditLog.findMany({
        where: { schoolId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          action: true,
          detail: true,
          createdAt: true,
          admin: { select: { name: true } },
        },
      }),
    ]);

    return {
      ...school,
      suspended: school.suspendedAt !== null,
      amount: school.subscription ? Number(school.subscription.amount) : null,
      owners: school.users,
      studentCount: school._count.students,
      staffCount: school._count.users,
      notices,
      actions,
    };
  }

  /**
   * Provision a school by inviting its owner.
   *
   * EYO does not create the account itself: the school's proprietor sets their own password and
   * enters their own school's details, and this only decides *that* they may. The token is
   * returned once, here, and stored only as a hash.
   */
  async invite(admin: PlatformUser, dto: InviteDto) {
    const email = dto.email.toLowerCase();

    // An address that already runs a school cannot accept an invitation — `User.email` is unique
    // across every tenant, so the acceptance would fail at the last step instead of the first.
    const existing = await this.db.system.user.findUnique({
      where: { email },
      select: { schoolId: true },
    });
    if (existing) {
      throw new BadRequestException('That email address already has an account on the platform');
    }
    const openInvite = await this.db.system.schoolInvitation.findFirst({
      where: { email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (openInvite) {
      throw new BadRequestException('That address already has an invitation outstanding');
    }

    const token = publicToken(24);
    const days = dto.expiresInDays ?? INVITE_DAYS;
    const invitation = await this.db.system.schoolInvitation.create({
      data: {
        schoolName: dto.schoolName.trim(),
        email,
        tokenHash: hashInviteToken(token),
        tier: dto.tier ?? 'BASIC',
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        createdById: admin.sub,
      },
      select: { id: true, schoolName: true, email: true, expiresAt: true, tier: true },
    });
    await this.record(admin, 'invitation.issue', null, {
      schoolName: invitation.schoolName,
      email,
      tier: invitation.tier,
    });

    // Shown once. There is no endpoint that can produce it again — reissuing means a new one.
    return { ...invitation, token };
  }

  async invitations() {
    const rows = await this.db.system.schoolInvitation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        schoolName: true,
        email: true,
        tier: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        createdAt: true,
        createdBy: { select: { name: true } },
        school: { select: { id: true, name: true } },
      },
    });
    const now = Date.now();
    return rows.map((r) => ({
      ...r,
      state: r.acceptedAt
        ? ('ACCEPTED' as const)
        : r.revokedAt
          ? ('REVOKED' as const)
          : r.expiresAt.getTime() < now
            ? ('EXPIRED' as const)
            : ('OPEN' as const),
    }));
  }

  async revokeInvitation(admin: PlatformUser, id: string) {
    const invite = await this.db.system.schoolInvitation.findUnique({ where: { id } });
    if (!invite) throw new NotFoundException('No such invitation');
    if (invite.acceptedAt) {
      throw new BadRequestException(
        'That invitation has already been used — suspend the school instead',
      );
    }
    await this.db.system.schoolInvitation.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await this.record(admin, 'invitation.revoke', null, {
      schoolName: invite.schoolName,
      email: invite.email,
    });
    return { revoked: true };
  }

  /**
   * Close a school's doors without touching a single row of its data.
   *
   * Suspension is not a downgrade and not a deletion: the tier stays, the records stay, and
   * lifting it puts the school back exactly as it was. What stops is sign-in — and, because the
   * staff guard re-reads the school on every request, any session already open.
   */
  async suspend(admin: PlatformUser, id: string, dto: SuspendDto) {
    const school = await this.db.system.school.findUnique({
      where: { id },
      select: { id: true, name: true, suspendedAt: true },
    });
    if (!school) throw new NotFoundException('No such school');
    if (school.suspendedAt) throw new BadRequestException('That school is already suspended');

    await this.db.system.school.update({
      where: { id },
      data: { suspendedAt: new Date(), suspendedReason: dto.reason.trim() },
    });
    await this.record(admin, 'school.suspend', school, { reason: dto.reason.trim() });
    return { suspended: true };
  }

  async restore(admin: PlatformUser, id: string) {
    const school = await this.db.system.school.findUnique({
      where: { id },
      select: { id: true, name: true, suspendedAt: true },
    });
    if (!school) throw new NotFoundException('No such school');
    if (!school.suspendedAt) throw new BadRequestException('That school is not suspended');

    await this.db.system.school.update({
      where: { id },
      data: { suspendedAt: null, suspendedReason: null },
    });
    await this.record(admin, 'school.restore', school, { suspendedSince: school.suspendedAt });
    return { restored: true };
  }

  /**
   * Say something to one school, inside the product.
   *
   * Not an `Announcement`: those are the school's own voice, written by its head, and a vendor
   * notice sitting in that list would either read as the school's own words or be deleted by
   * them. Not SMS either — that spends the school's own credits, which is an indefensible way to
   * deliver a message about their bill.
   */
  async contact(admin: PlatformUser, id: string, dto: ContactDto) {
    const school = await this.db.system.school.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!school) throw new NotFoundException('No such school');

    const notice = await this.db.system.platformNotice.create({
      data: {
        schoolId: id,
        subject: dto.subject.trim(),
        body: dto.body.trim(),
        level: dto.level ?? 'INFO',
        sentById: admin.sub,
      },
      select: { id: true, subject: true, level: true, createdAt: true },
    });
    await this.record(admin, 'school.contact', school, {
      subject: notice.subject,
      level: notice.level,
    });
    return notice;
  }

  /** The vendor's own recent activity, newest first. */
  async activity() {
    return this.db.system.platformAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        action: true,
        schoolId: true,
        schoolName: true,
        detail: true,
        createdAt: true,
        admin: { select: { name: true } },
      },
    });
  }
}

/**
 * Marked `@Public()` so the global staff guard steps aside, then guarded by `PlatformGuard`
 * instead — the same arrangement the student portal uses. `@Public()` here means "not a *staff*
 * session", never "unauthenticated": every route below except login carries the guard.
 */
@Controller('platform')
@Public()
export class PlatformController {
  constructor(private svc: PlatformService) {}

  @Post('auth/login')
  login(@Body() dto: PlatformLoginDto) {
    return this.svc.login(dto);
  }

  @Get('me')
  @UseGuards(PlatformGuard)
  me(@CurrentAdmin() admin: PlatformUser) {
    return { admin: { name: admin.name, email: admin.email } };
  }

  @Get('schools')
  @UseGuards(PlatformGuard)
  schools(@Query() query: SchoolQueryDto) {
    return this.svc.schools(query);
  }

  @Get('schools/:id')
  @UseGuards(PlatformGuard)
  school(@Param('id') id: string) {
    return this.svc.school(id);
  }

  @Post('schools/:id/suspend')
  @UseGuards(PlatformGuard)
  suspend(@CurrentAdmin() admin: PlatformUser, @Param('id') id: string, @Body() dto: SuspendDto) {
    return this.svc.suspend(admin, id, dto);
  }

  @Post('schools/:id/restore')
  @UseGuards(PlatformGuard)
  restore(@CurrentAdmin() admin: PlatformUser, @Param('id') id: string) {
    return this.svc.restore(admin, id);
  }

  @Post('schools/:id/contact')
  @UseGuards(PlatformGuard)
  contact(@CurrentAdmin() admin: PlatformUser, @Param('id') id: string, @Body() dto: ContactDto) {
    return this.svc.contact(admin, id, dto);
  }

  @Get('invitations')
  @UseGuards(PlatformGuard)
  invitations() {
    return this.svc.invitations();
  }

  @Post('invitations')
  @UseGuards(PlatformGuard)
  invite(@CurrentAdmin() admin: PlatformUser, @Body() dto: InviteDto) {
    return this.svc.invite(admin, dto);
  }

  @Post('invitations/:id/revoke')
  @UseGuards(PlatformGuard)
  revoke(@CurrentAdmin() admin: PlatformUser, @Param('id') id: string) {
    return this.svc.revokeInvitation(admin, id);
  }

  @Get('activity')
  @UseGuards(PlatformGuard)
  activity() {
    return this.svc.activity();
  }
}

/**
 * The school's side of the vendor's messages.
 *
 * Ordinary staff authentication — this is the one part of the feature that belongs to the
 * school, and it reads through the tenant-scoped client like everything else they own.
 */
@Injectable()
export class NoticesService {
  constructor(private db: PrismaService) {}

  list(schoolId: string) {
    return this.db.platformNotice.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, subject: true, body: true, level: true, readAt: true, createdAt: true },
    });
  }

  async acknowledge(schoolId: string, id: string) {
    const notice = await this.db.platformNotice.findFirst({ where: { id, schoolId } });
    if (!notice) throw new NotFoundException('No such notice');
    if (notice.readAt) return { acknowledged: true };
    await this.db.platformNotice.update({ where: { id }, data: { readAt: new Date() } });
    return { acknowledged: true };
  }
}

@Controller('notices')
export class NoticesController {
  constructor(private svc: NoticesService) {}

  @Get()
  list(@CurrentUser() auth: AuthUser) {
    return this.svc.list(auth.schoolId);
  }

  @Patch(':id/acknowledge')
  acknowledge(@CurrentUser() auth: AuthUser, @Param('id') id: string) {
    return this.svc.acknowledge(auth.schoolId, id);
  }
}

@Module({
  controllers: [PlatformController, NoticesController],
  providers: [PlatformService, PlatformGuard, NoticesService],
  exports: [NoticesService],
})
export class PlatformModule {}
