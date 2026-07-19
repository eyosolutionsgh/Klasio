import {
  BadRequestException,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  StreamableFile,
  UnauthorizedException,
  UseGuards,
  createParamDecorator,
} from '@nestjs/common';
import { Body } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import * as jwt from 'jsonwebtoken';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService, withTenant } from '../prisma/prisma.service';
import { FeesModule, FeesService } from '../fees/fees.module';
import { PaymentsModule, PaymentsService } from '../payments/payments.module';
import { CalendarModule, CalendarService } from '../calendar/calendar.module';
import { ResourcesModule, ResourcesService, ResourceScope } from '../resources/resources.module';
import { Public } from '../common/auth';
import { maskMsisdn, normalizeMsisdn } from '../common/phone';
import { reportCardPdf, ReportCardData } from '../common/pdf';
import { balanceOf } from '../common/ledger';

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_PER_HOUR = 5;
/** Guardians pay per SMS, so a long session avoids charging them to re-authenticate weekly. */
const SESSION_DAYS = 30;

const JWT_SECRET = () => process.env.JWT_SECRET ?? 'dev-secret-do-not-use-in-prod';

/**
 * A guardian session. `kind` keeps it strictly separate from a staff token — the staff guard
 * refuses anything with kind 'guardian' and this guard refuses anything without it, so neither
 * token can ever be replayed against the other's routes.
 */
export interface GuardianUser {
  sub: string; // guardianId
  schoolId: string;
  kind: 'guardian';
  name: string;
}

export const CurrentGuardian = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): GuardianUser => ctx.switchToHttp().getRequest().guardian,
);

@Injectable()
export class GuardianGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Missing token');
    let payload: GuardianUser;
    try {
      payload = jwt.verify(token, JWT_SECRET()) as GuardianUser;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    // A staff token must never open guardian routes, and vice versa.
    if (payload.kind !== 'guardian') throw new UnauthorizedException('Not a guardian session');
    req.guardian = payload;
    return true;
  }
}

class RequestOtpDto {
  @IsString() @MinLength(6) phone: string;
}
class VerifyOtpDto {
  @IsString() @MinLength(6) phone: string;
  @IsString() @MinLength(4) code: string;
}

const hashCode = (phone: string, code: string) =>
  createHash('sha256').update(`${phone}:${code}`).digest('hex');

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

@Injectable()
export class GuardianService {
  constructor(
    private db: PrismaService,
    private fees: FeesService,
    private payments: PaymentsService,
    private calendar: CalendarService,
    private resources: ResourcesService,
  ) {}

  /**
   * Issue a sign-in code. Always reports success, whether or not the number is registered —
   * otherwise this endpoint becomes a way to test which phone numbers belong to parents at
   * a given school.
   */
  async requestOtp(rawPhone: string) {
    const phone = normalizeMsisdn(rawPhone);
    const generic = { sent: true, expiresInMinutes: OTP_TTL_MINUTES };
    if (!phone) return generic;

    // No tenant yet: a phone number is how we find out which school the caller belongs to.
    // This must come first — the throttle counters below are tenant-scoped, and running them
    // before the school is known would read zero and silently disable throttling.
    const guardian = await this.db.system.guardian.findFirst({
      where: { phone: { contains: phone.slice(-9) } },
      orderBy: { createdAt: 'desc' },
    });
    if (!guardian) return generic;

    return withTenant(guardian.schoolId, async () => {
      const since = new Date(Date.now() - 60 * 60_000);
      const recent = await this.db.guardianOtp.count({
        where: { phone, createdAt: { gte: since } },
      });
      if (recent >= OTP_MAX_PER_HOUR) return generic;

      const last = await this.db.guardianOtp.findFirst({
        where: { phone },
        orderBy: { createdAt: 'desc' },
      });
      if (last && Date.now() - last.createdAt.getTime() < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
        return generic;
      }

      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await this.db.guardianOtp.create({
        data: {
          schoolId: guardian.schoolId,
          guardianId: guardian.id,
          phone,
          codeHash: hashCode(phone, code),
          expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
        },
      });

      const school = await this.db.school.findUniqueOrThrow({ where: { id: guardian.schoolId } });
      const body = `${code} is your ${school.name} code. It expires in ${OTP_TTL_MINUTES} minutes. Never share it.`;
      // Reuses the school's SMS credits/sender; in dev the mock provider prints it to the log.
      await this.db.smsMessage.create({
        data: {
          schoolId: guardian.schoolId,
          to: phone,
          body,
          status: 'SENT',
          provider: 'otp',
          cost: 1,
          createdById: 'system',
        },
      });
      // Development only. A sign-in code in a log file is a sign-in code anyone with log access
      // can use — request one for a known parent's number and you are that parent.
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[guardian OTP] ${maskMsisdn(phone)} → ${code}`);
      }
      return generic;
    });
  }

  async verifyOtp(rawPhone: string, code: string) {
    const phone = normalizeMsisdn(rawPhone);
    if (!phone) throw new UnauthorizedException('That code is not valid');

    // Same reason as requestOtp: resolve the school before touching tenant-scoped rows.
    const owner = await this.db.system.guardian.findFirst({
      where: { phone: { contains: phone.slice(-9) } },
      orderBy: { createdAt: 'desc' },
    });
    if (!owner) throw new UnauthorizedException('That code is not valid');

    return withTenant(owner.schoolId, () => this.verifyOtpScoped(phone, code));
  }

  private async verifyOtpScoped(phone: string, code: string) {
    const otp = await this.db.guardianOtp.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new UnauthorizedException('That code has expired — request a new one');
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException('Too many attempts — request a new code');
    }

    if (!safeEq(otp.codeHash, hashCode(phone, code.trim()))) {
      await this.db.guardianOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('That code is not valid');
    }

    // Burn the code so it cannot be reused.
    await this.db.guardianOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    const guardian = await this.db.guardian.findUniqueOrThrow({ where: { id: otp.guardianId } });
    const payload: GuardianUser = {
      sub: guardian.id,
      schoolId: guardian.schoolId,
      kind: 'guardian',
      name: `${guardian.firstName} ${guardian.lastName}`,
    };
    await this.db.audit(guardian.schoolId, null, 'guardian.login', 'Guardian', guardian.id);
    return {
      token: jwt.sign(payload, JWT_SECRET(), { expiresIn: `${SESSION_DAYS}d` }),
      guardian: { name: payload.name },
    };
  }

  // ── Ward-scoped reads ──────────────────────────────────────────────

  /**
   * Resolve a ward the caller is actually allowed to see. Custody-blocked links are excluded:
   * a guardian flagged BLOCKED must not reach the child's records through the portal.
   */
  private async ward(auth: GuardianUser, studentId: string) {
    const link = await this.db.studentGuardian.findFirst({
      where: {
        studentId,
        guardianId: auth.sub,
        custodyFlag: { not: 'BLOCKED' },
        student: { schoolId: auth.schoolId },
      },
      include: { student: { include: { classRoom: { select: { name: true } } } } },
    });
    if (!link) throw new ForbiddenException('That is not your ward');
    return link.student;
  }

  /**
   * A receipt for one of the caller's own wards. `ward()` proves the child is theirs and not
   * custody-blocked; the studentId is then passed down so the payment must also belong to that
   * child — a guardian cannot fetch a receipt by guessing another family's reference.
   */
  async wardReceiptPdf(auth: GuardianUser, studentId: string, reference: string) {
    const student = await this.ward(auth, studentId);
    return this.fees.receiptPdf(auth.schoolId, reference, student.id);
  }

  /**
   * A guardian telling the school that today's arrangement is changing. It is a request, not an
   * instruction: nothing about the pickup rules changes until the front office approves it.
   */
  /**
   * Let a parent settle a bill from the portal.
   *
   * `ward()` is the whole security boundary here: it proves the child belongs to this guardian
   * and is not custody-BLOCKED. Everything downstream trusts that, so it must stay first.
   *
   * The amount is deliberately not taken from the client. A guardian may choose to pay less than
   * the full balance, but never more than is owed, and never against another child.
   */
  async checkout(
    auth: GuardianUser,
    studentId: string,
    body: { amount?: number; channel?: 'MOMO' | 'CARD'; phone?: string },
  ) {
    await this.ward(auth, studentId);
    const owed = await this.payments.outstandingFor(studentId);
    if (!(owed > 0)) throw new BadRequestException('There is nothing outstanding on this account');
    const amount = body.amount ?? owed;
    if (amount <= 0) throw new BadRequestException('Enter an amount to pay');
    if (amount > owed) {
      throw new BadRequestException(
        `That is more than is owed — the balance is ${owed.toFixed(2)}`,
      );
    }
    return this.payments.guardianCheckout(auth.schoolId, {
      studentId,
      amount,
      channel: body.channel ?? 'MOMO',
      phone: body.phone,
    });
  }

  async requestDismissalChange(
    auth: GuardianUser,
    studentId: string,
    forDate: string,
    details: string,
  ) {
    const student = await this.ward(auth, studentId);
    const req = await this.db.dismissalRequest.create({
      data: {
        schoolId: auth.schoolId,
        studentId: student.id,
        guardianId: auth.sub,
        forDate: new Date(forDate),
        details,
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'pickup.dismissal.request',
      'Student',
      student.id,
      {
        forDate,
      },
    );
    return { id: req.id, status: req.status };
  }

  async myDismissalRequests(auth: GuardianUser) {
    const requests = await this.db.dismissalRequest.findMany({
      where: { guardianId: auth.sub, schoolId: auth.schoolId },
      include: { student: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return requests.map((r) => ({
      id: r.id,
      student: `${r.student.firstName} ${r.student.lastName}`,
      forDate: r.forDate,
      details: r.details,
      status: r.status,
      decisionNote: r.decisionNote,
    }));
  }

  async me(auth: GuardianUser) {
    const [links, school] = await Promise.all([
      this.db.studentGuardian.findMany({
        where: {
          guardianId: auth.sub,
          custodyFlag: { not: 'BLOCKED' },
          student: { schoolId: auth.schoolId },
        },
        include: { student: { include: { classRoom: { select: { name: true } } } } },
      }),
      this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } }),
    ]);
    return {
      guardian: { name: auth.name },
      school: { name: school.name, phone: school.phone, currency: school.currency },
      wards: links.map((l) => ({
        id: l.student.id,
        name: `${l.student.firstName} ${l.student.lastName}`,
        admissionNo: l.student.admissionNo,
        className: l.student.classRoom?.name ?? null,
        status: l.student.status,
      })),
    };
  }

  /** Bills, payments and attendance for one ward — read-only. */
  async wardOverview(auth: GuardianUser, studentId: string) {
    const student = await this.ward(auth, studentId);
    const [ledger, attendance] = await Promise.all([
      this.db.ledgerEntry.findMany({
        where: { studentId },
        orderBy: { createdAt: 'desc' },
        include: { receipt: { select: { number: true } } },
      }),
      this.db.attendanceRecord.groupBy({
        by: ['status'],
        where: { studentId },
        _count: true,
      }),
    ]);
    const balance = balanceOf(ledger);
    return {
      student: {
        name: `${student.firstName} ${student.lastName}`,
        admissionNo: student.admissionNo,
        className: student.classRoom?.name ?? null,
      },
      feeBalance: Math.round(balance * 100) / 100,
      ledger: ledger.slice(0, 30).map((e) => ({
        id: e.id,
        type: e.type,
        amount: Number(e.amount),
        method: e.method,
        reference: e.reference,
        receiptNumber: e.receipt?.number ?? null,
        createdAt: e.createdAt,
      })),
      attendance: attendance.reduce(
        (acc, a) => ({ ...acc, [a.status]: a._count }),
        {} as Record<string, number>,
      ),
    };
  }

  /** Only published reports are ever visible to a guardian. */
  async wardReports(auth: GuardianUser, studentId: string) {
    await this.ward(auth, studentId);
    const reports = await this.db.termReport.findMany({
      where: { studentId, publishedAt: { not: null } },
      orderBy: { generatedAt: 'desc' },
    });
    const terms = await this.db.term.findMany({
      where: { id: { in: reports.map((r) => r.termId) } },
      include: { academicYear: { select: { name: true } } },
    });
    const termById = new Map(terms.map((t) => [t.id, t]));
    return reports.map((r) => ({
      termId: r.termId,
      term: termById.get(r.termId)?.name ?? '',
      year: termById.get(r.termId)?.academicYear.name ?? '',
      overallTotal: r.overallTotal,
      classPosition: r.classPosition,
      classSize: r.classSize,
      publishedAt: r.publishedAt,
    }));
  }

  private async publishedCard(auth: GuardianUser, studentId: string, termId: string) {
    const student = await this.ward(auth, studentId);
    const report = await this.db.termReport.findFirst({
      where: { studentId, termId, schoolId: auth.schoolId, publishedAt: { not: null } },
    });
    if (!report) throw new NotFoundException('That report has not been published');

    const [school, term, level] = await Promise.all([
      this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } }),
      this.db.term.findFirst({
        where: { id: termId },
        include: { academicYear: { select: { name: true } } },
      }),
      this.db.classRoom.findFirst({
        where: { id: report.classId },
        include: { level: { include: { gradingScheme: true } } },
      }),
    ]);
    const scheme =
      level?.level.gradingScheme ??
      (await this.db.gradingScheme.findFirst({
        where: { schoolId: auth.schoolId, kind: 'GES_CLASSIC' },
      }));
    return {
      schemeKind: scheme?.kind ?? 'GES_CLASSIC',
      template: school.reportTemplate,
      school: {
        name: school.name,
        motto: school.motto,
        address: school.address,
        phone: school.phone,
      },
      student: {
        name: `${student.firstName} ${student.lastName}`,
        admissionNo: student.admissionNo,
        className: student.classRoom?.name ?? null,
      },
      term: {
        name: term?.name,
        year: term?.academicYear.name,
        nextTermBegins: term?.nextTermBegins ?? null,
      },
      lines: report.lines,
      overallTotal: report.overallTotal,
      classPosition: report.classPosition,
      classSize: report.classSize,
      attendance: { present: report.attendancePresent, total: report.attendanceTotal },
      conduct: report.conduct,
      interest: report.interest,
      teacherRemark: report.teacherRemark,
      headRemark: report.headRemark,
    };
  }

  reportCard(auth: GuardianUser, studentId: string, termId: string) {
    return this.publishedCard(auth, studentId, termId);
  }

  async reportCardPdf(auth: GuardianUser, studentId: string, termId: string) {
    const card = await this.publishedCard(auth, studentId, termId);
    return reportCardPdf(card as unknown as ReportCardData);
  }

  async announcements(auth: GuardianUser) {
    const notices = await this.db.announcement.findMany({
      where: { schoolId: auth.schoolId, audience: { in: ['ALL', 'GUARDIANS'] } },
      orderBy: { publishedAt: 'desc' },
      take: 30,
    });
    return notices.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      publishedAt: n.publishedAt,
    }));
  }

  /**
   * The classes and levels the caller's own wards sit in. Custody-blocked links are left out
   * here for the same reason as everywhere else: that guardian is not part of the child's
   * school life, so the child's class shelf is not theirs to read either.
   */
  private async scope(auth: GuardianUser): Promise<ResourceScope> {
    const links = await this.db.studentGuardian.findMany({
      where: {
        guardianId: auth.sub,
        custodyFlag: { not: 'BLOCKED' },
        student: { schoolId: auth.schoolId },
      },
      select: { student: { select: { classId: true, classRoom: { select: { levelId: true } } } } },
    });
    const classIds = links.map((l) => l.student.classId).filter((id): id is string => !!id);
    const levelIds = links
      .map((l) => l.student.classRoom?.levelId)
      .filter((id): id is string => !!id);
    return { classIds, levelIds };
  }

  /** Whole-school and guardian-facing events only — never anything written for staff. */
  async calendarEvents(auth: GuardianUser) {
    const { levelIds } = await this.scope(auth);
    return this.calendar.feed(auth.schoolId, 'GUARDIANS', levelIds);
  }

  async learningResources(auth: GuardianUser) {
    return this.resources.feed(auth.schoolId, await this.scope(auth));
  }

  /** Re-checks the scope on the way out, so a guessed id fetches nothing. */
  async resourceFile(auth: GuardianUser, id: string) {
    return this.resources.download(
      auth.schoolId,
      id,
      { guardianId: auth.sub },
      await this.scope(auth),
    );
  }
}

@Controller('guardian')
export class GuardianAuthController {
  constructor(private svc: GuardianService) {}

  @Post('auth/request-otp')
  @Public()
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.svc.requestOtp(dto.phone);
  }

  @Post('auth/verify')
  @Public()
  verify(@Body() dto: VerifyOtpDto) {
    if (!dto.code?.trim()) throw new BadRequestException('Enter the code');
    return this.svc.verifyOtp(dto.phone, dto.code);
  }
}

/** Everything here is read-only and scoped to the caller's own wards. */
@Controller('guardian')
@Public() // bypasses the staff guard; GuardianGuard authenticates instead
@UseGuards(GuardianGuard)
export class GuardianPortalController {
  constructor(private svc: GuardianService) {}

  @Get('me')
  me(@CurrentGuardian() g: GuardianUser) {
    return this.svc.me(g);
  }

  @Get('wards/:studentId')
  ward(@CurrentGuardian() g: GuardianUser, @Param('studentId') studentId: string) {
    return this.svc.wardOverview(g, studentId);
  }

  @Get('wards/:studentId/reports')
  reports(@CurrentGuardian() g: GuardianUser, @Param('studentId') studentId: string) {
    return this.svc.wardReports(g, studentId);
  }

  @Get('wards/:studentId/reports/:termId')
  report(
    @CurrentGuardian() g: GuardianUser,
    @Param('studentId') studentId: string,
    @Param('termId') termId: string,
  ) {
    return this.svc.reportCard(g, studentId, termId);
  }

  @Post('wards/:studentId/checkout')
  checkout(
    @CurrentGuardian() g: GuardianUser,
    @Param('studentId') studentId: string,
    @Body() body: { amount?: number; channel?: 'MOMO' | 'CARD'; phone?: string },
  ) {
    return this.svc.checkout(g, studentId, body);
  }

  @Post('wards/:studentId/dismissal-requests')
  requestDismissal(
    @CurrentGuardian() g: GuardianUser,
    @Param('studentId') studentId: string,
    @Body() body: { forDate: string; details: string },
  ) {
    return this.svc.requestDismissalChange(g, studentId, body.forDate, body.details);
  }

  @Get('dismissal-requests')
  myDismissals(@CurrentGuardian() g: GuardianUser) {
    return this.svc.myDismissalRequests(g);
  }

  @Get('wards/:studentId/receipts/:reference/pdf')
  async receiptPdf(
    @CurrentGuardian() g: GuardianUser,
    @Param('studentId') studentId: string,
    @Param('reference') reference: string,
  ) {
    const buf = await this.svc.wardReceiptPdf(g, studentId, reference);
    return new StreamableFile(buf, {
      type: 'application/pdf',
      disposition: `attachment; filename="receipt-${reference}.pdf"`,
    });
  }

  @Get('wards/:studentId/reports/:termId/pdf')
  async reportPdf(
    @CurrentGuardian() g: GuardianUser,
    @Param('studentId') studentId: string,
    @Param('termId') termId: string,
  ) {
    const buf = await this.svc.reportCardPdf(g, studentId, termId);
    return new StreamableFile(buf, {
      type: 'application/pdf',
      disposition: `attachment; filename="report-${termId}.pdf"`,
    });
  }

  @Get('notices')
  notices(@CurrentGuardian() g: GuardianUser) {
    return this.svc.announcements(g);
  }

  @Get('calendar')
  calendar(@CurrentGuardian() g: GuardianUser) {
    return this.svc.calendarEvents(g);
  }

  @Get('resources')
  resources(@CurrentGuardian() g: GuardianUser) {
    return this.svc.learningResources(g);
  }

  @Get('resources/:id/file')
  async resourceFile(@CurrentGuardian() g: GuardianUser, @Param('id') id: string) {
    const { buffer, resource } = await this.svc.resourceFile(g, id);
    return new StreamableFile(buffer, {
      type: resource.mimeType,
      disposition: `attachment; filename="${resource.filename.replace(/"/g, '')}"`,
    });
  }
}

@Module({
  imports: [FeesModule, PaymentsModule, CalendarModule, ResourcesModule],
  controllers: [GuardianAuthController, GuardianPortalController],
  providers: [GuardianService, GuardianGuard],
})
export class GuardianModule {}
