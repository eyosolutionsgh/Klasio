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
  Post,
  Delete,
  Param,
  Body,
  StreamableFile,
  UnauthorizedException,
  UseGuards,
  createParamDecorator,
} from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Public, RequirePermission, jwtSecret } from '../common/auth';
import { CalendarModule, CalendarService } from '../calendar/calendar.module';
import { ResourcesModule, ResourcesService, ResourceScope } from '../resources/resources.module';
import { balanceOf } from '../common/ledger';
import { reportCardPdf } from '../common/pdf';
import { clearanceVerdict } from '../common/fee-clearance';
import { buildReportCard } from '../common/report-card';

/** Wrong PINs before the account is barred, and for how long. */
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MINUTES = 15;

const SESSION_DAYS = 30;
const BCRYPT_ROUNDS = 10;

/**
 * A signed-in student. Like the guardian portal, this is a different *kind* of principal from
 * staff: same secret, but the staff guard rejects it and vice versa.
 */
export interface StudentUser {
  sub: string;
  schoolId: string;
  kind: 'student';
  name: string;
}

class StudentLoginDto {
  @IsString() admissionNo: string;
  @IsString() @MinLength(4) pin: string;
}

class SubmitDto {
  @IsString() @MinLength(1) @MaxLength(20000) text: string;
}

@Injectable()
export class StudentGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Sign in to continue');
    try {
      const payload = jwt.verify(header.slice(7), jwtSecret()) as
        (StudentUser & { kind?: string }) | undefined;
      if (!payload || payload.kind !== 'student') {
        throw new UnauthorizedException('Not a student session');
      }
      req.student = payload;
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Your session has expired');
    }
  }
}

export const CurrentStudent = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): StudentUser => ctx.switchToHttp().getRequest().student,
);

@Injectable()
export class StudentPortalService {
  constructor(
    private db: PrismaService,
    private calendar: CalendarService,
    private resources: ResourcesService,
  ) {}

  /** Staff issue a PIN; it is shown once and stored hashed, like the gate pass PIN. */
  async issuePin(auth: AuthUser, studentId: string) {
    const student = await this.db.student.findFirst({
      where: { id: studentId, schoolId: auth.schoolId },
    });
    if (!student) throw new NotFoundException('Student not found');
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.student.update({
      where: { id: studentId },
      // A new PIN clears any lockout — otherwise the office's only remedy for a barred child
      // would still leave them barred.
      data: {
        portalPinHash: await bcrypt.hash(pin, BCRYPT_ROUNDS),
        portalPinFails: 0,
        portalLockedUntil: null,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'student.portal.pin', 'Student', studentId);
    return { admissionNo: student.admissionNo, pin };
  }

  async revokePin(auth: AuthUser, studentId: string) {
    const student = await this.db.student.findFirst({
      where: { id: studentId, schoolId: auth.schoolId },
    });
    if (!student) throw new NotFoundException('Student not found');
    await this.db.student.update({ where: { id: studentId }, data: { portalPinHash: null } });
    await this.db.audit(auth.schoolId, auth.sub, 'student.portal.revoke', 'Student', studentId);
    return { ok: true };
  }

  /**
   * Sign in with an admission number and PIN.
   *
   * The same message comes back for an unknown admission number and a wrong PIN, so the portal
   * cannot be used to discover who attends the school.
   */
  async login(dto: StudentLoginDto) {
    // No tenant yet — the admission number is what tells us the school.
    const student = await this.db.system.student.findFirst({
      where: { admissionNo: dto.admissionNo.trim(), status: 'ACTIVE' },
      include: {
        school: { select: { id: true, name: true } },
      },
    });
    const refuse = () => new UnauthorizedException('That admission number or PIN is not right');
    if (!student?.portalPinHash) throw refuse();

    /**
     * Slow down guessing.
     *
     * The PIN is six digits, which is a million combinations — minutes of scripted guessing
     * against an endpoint that had no attempt limit at all, and the account it opens belongs to a
     * child. Admission numbers are printed on report cards and ID cards, so the other half of the
     * credential is not secret either.
     *
     * A lockout rather than a delay, because the attacker controls the request rate and we do
     * not. It is deliberately short: a child locked out of their own results by a classmate
     * messing about should be able to get back in the same afternoon, and the school can always
     * issue a fresh PIN.
     */
    if (student.portalLockedUntil && student.portalLockedUntil > new Date()) {
      const minutes = Math.max(
        1,
        Math.ceil((student.portalLockedUntil.getTime() - Date.now()) / 60_000),
      );
      throw new UnauthorizedException(
        `Too many wrong tries. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask the school office for a new PIN.`,
      );
    }

    if (!(await bcrypt.compare(dto.pin, student.portalPinHash))) {
      const fails = student.portalPinFails + 1;
      await this.db.system.student.update({
        where: { id: student.id },
        data: {
          portalPinFails: fails,
          ...(fails >= PIN_MAX_ATTEMPTS
            ? { portalLockedUntil: new Date(Date.now() + PIN_LOCKOUT_MINUTES * 60_000) }
            : {}),
        },
      });
      throw refuse();
    }

    // A correct PIN clears the run of failures, so an honest child who mistypes twice and then
    // gets it right does not carry those attempts into next week.
    if (student.portalPinFails > 0 || student.portalLockedUntil) {
      await this.db.system.student.update({
        where: { id: student.id },
        data: { portalPinFails: 0, portalLockedUntil: null },
      });
    }

    const payload: StudentUser = {
      sub: student.id,
      schoolId: student.schoolId,
      kind: 'student',
      name: `${student.firstName} ${student.lastName}`,
    };
    const token = jwt.sign(payload, jwtSecret(), {
      expiresIn: `${SESSION_DAYS}d`,
    });
    return { token, student: { name: payload.name, school: student.school.name } };
  }

  /** The student's own record. Read-only, and only ever their own. */
  async me(auth: StudentUser) {
    const student = await this.db.student.findUniqueOrThrow({
      where: { id: auth.sub },
      include: {
        classRoom: { select: { name: true } },
        school: {
          select: {
            name: true,
            phone: true,
            currency: true,
            reportsRequireFeeClearance: true,
          },
        },
      },
    });
    const [attendance, reports, ledger, clearances] = await Promise.all([
      this.db.attendanceRecord.groupBy({
        by: ['status'],
        where: { studentId: auth.sub },
        _count: true,
      }),
      this.db.termReport.findMany({
        // Only what the school has released — same rule as the guardian portal.
        where: { studentId: auth.sub, publishedAt: { not: null } },
        orderBy: { generatedAt: 'desc' },
      }),
      this.db.ledgerEntry.findMany({ where: { studentId: auth.sub } }),
      this.db.feeClearance.findMany({ where: { studentId: auth.sub }, select: { termId: true } }),
    ]);

    const balance = balanceOf(ledger);
    // The pupil's own view obeys the same fee gate as their guardian's: a child must not be the
    // way around a policy their family is subject to.
    const clearedTerms = new Set(clearances.map((c) => c.termId));
    const verdictFor = (termId: string) =>
      clearanceVerdict({
        policyOn: student.school.reportsRequireFeeClearance,
        balance,
        cleared: clearedTerms.has(termId),
      });

    const terms = await this.db.term.findMany({
      where: { id: { in: reports.map((r) => r.termId) } },
      include: { academicYear: { select: { name: true } } },
    });
    const termById = new Map(terms.map((t) => [t.id, t]));

    return {
      student: {
        name: `${student.firstName} ${student.lastName}`,
        admissionNo: student.admissionNo,
        className: student.classRoom?.name ?? null,
      },
      school: student.school,
      feeBalance: Math.round(balance * 100) / 100,
      attendance: attendance.reduce(
        (acc, a) => ({ ...acc, [a.status]: a._count }),
        {} as Record<string, number>,
      ),
      reports: reports.map((r) => {
        const verdict = verdictFor(r.termId);
        return {
          termId: r.termId,
          term: termById.get(r.termId)?.name ?? '',
          year: termById.get(r.termId)?.academicYear.name ?? '',
          overallTotal: verdict.allowed ? Number(r.overallTotal) : null,
          classPosition: verdict.allowed ? r.classPosition : null,
          classSize: verdict.allowed ? r.classSize : null,
          held: !verdict.allowed,
          heldReason: verdict.allowed ? null : verdict.reason,
        };
      }),
    };
  }

  /**
   * The pupil's own published report as the same A4 PDF their guardian downloads. Mirrors the
   * guardian portal's publishedCard, scoped to the signed-in student — published only, because a
   * child must never see a report before the school releases it.
   */
  /**
   * The pupil's own published report, as the same A4 PDF their guardian downloads.
   *
   * Assembled by the shared builder (common/report-card.ts) so the two documents cannot drift:
   * a parent and their child comparing downloads on results day must see the same thing.
   */
  async reportCardPdf(auth: StudentUser, termId: string) {
    // Same fee gate as the family portal — a child must not be the way around a policy their
    // family is subject to — and checked here as well as on the list, since the URL is guessable.
    const [school, cleared, ledger] = await Promise.all([
      this.db.school.findUniqueOrThrow({
        where: { id: auth.schoolId },
        select: { reportsRequireFeeClearance: true },
      }),
      this.db.feeClearance.findUnique({
        where: { studentId_termId: { studentId: auth.sub, termId } },
      }),
      this.db.ledgerEntry.findMany({ where: { studentId: auth.sub } }),
    ]);
    const gate = clearanceVerdict({
      policyOn: school.reportsRequireFeeClearance,
      balance: balanceOf(ledger),
      cleared: !!cleared,
    });
    if (!gate.allowed) throw new ForbiddenException(gate.reason);

    const card = await buildReportCard(this.db, auth.schoolId, auth.sub, termId);
    if (!card) throw new NotFoundException('That report has not been published');
    return reportCardPdf(card);
  }

  async notices(auth: StudentUser) {
    const { classIds, levelIds } = await this.scope(auth);
    const riders = await this.db.transportRider.findMany({
      where: { studentId: auth.sub, student: { schoolId: auth.schoolId } },
      select: { routeId: true },
    });
    const notices = await this.db.announcement.findMany({
      where: {
        schoolId: auth.schoolId,
        audience: { in: ['ALL', 'STUDENTS'] },
        // Same rule as the guardian board: no class, level or route means the whole school.
        OR: [
          { classId: null, levelId: null, routeId: null },
          { classId: { in: classIds } },
          { levelId: { in: levelIds } },
          { routeId: { in: riders.map((r) => r.routeId) } },
        ],
      },
      orderBy: { publishedAt: 'desc' },
      take: 10,
    });
    return notices.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      publishedAt: n.publishedAt,
    }));
  }

  /** The pupil's own class and its level — the whole of what they may be shown. */
  private async scope(auth: StudentUser): Promise<ResourceScope> {
    const student = await this.db.student.findUniqueOrThrow({
      where: { id: auth.sub },
      select: { classId: true, classRoom: { select: { levelId: true } } },
    });
    return {
      classIds: student.classId ? [student.classId] : [],
      levelIds: student.classRoom ? [student.classRoom.levelId] : [],
    };
  }

  /** Whole-school and student-facing events only — staff and guardian items stay hidden. */
  async calendarEvents(auth: StudentUser) {
    const { levelIds } = await this.scope(auth);
    return this.calendar.feed(auth.schoolId, 'STUDENTS', levelIds);
  }

  async learningResources(auth: StudentUser) {
    return this.resources.feed(auth.schoolId, await this.scope(auth));
  }

  /** Re-checks the scope on the way out, so a guessed id fetches nothing. */
  async resourceFile(auth: StudentUser, id: string) {
    return this.resources.download(
      auth.schoolId,
      id,
      { studentId: auth.sub },
      await this.scope(auth),
    );
  }

  /** Lessons and assignments set to the pupil's class, each carrying the pupil's own submission. */
  async lms(auth: StudentUser) {
    const { classIds } = await this.scope(auth);
    if (classIds.length === 0) return { lessons: [], assignments: [] };
    const classId = classIds[0];
    const [lessons, assignments, subjects, mine] = await Promise.all([
      this.db.lesson.findMany({
        where: { schoolId: auth.schoolId, classId },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.assignment.findMany({
        where: { schoolId: auth.schoolId, classId },
        orderBy: { dueAt: 'asc' },
      }),
      this.db.subject.findMany({
        where: { schoolId: auth.schoolId },
        select: { id: true, name: true },
      }),
      this.db.submission.findMany({ where: { schoolId: auth.schoolId, studentId: auth.sub } }),
    ]);
    const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
    const mineByAssignment = new Map(mine.map((s) => [s.assignmentId, s]));
    return {
      lessons: lessons.map((l) => ({
        id: l.id,
        title: l.title,
        subject: subjectName.get(l.subjectId) ?? '—',
        content: l.content,
        createdAt: l.createdAt,
      })),
      assignments: assignments.map((a) => {
        const sub = mineByAssignment.get(a.id);
        return {
          id: a.id,
          title: a.title,
          subject: subjectName.get(a.subjectId) ?? '—',
          instructions: a.instructions,
          dueAt: a.dueAt,
          points: a.points,
          overdue: !sub && a.dueAt < new Date(),
          submission: sub
            ? {
                text: sub.text,
                submittedAt: sub.submittedAt,
                score: sub.score,
                feedback: sub.feedback,
              }
            : null,
        };
      }),
    };
  }

  /** Submit or resubmit work. Resubmission is allowed until it is graded, then the entry is locked. */
  async submitAssignment(auth: StudentUser, assignmentId: string, text: string) {
    const body = (text ?? '').trim();
    if (body.length < 1) throw new BadRequestException('Write your answer before submitting');
    const { classIds } = await this.scope(auth);
    const assignment = await this.db.assignment.findFirst({
      where: { id: assignmentId, schoolId: auth.schoolId, classId: { in: classIds } },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    const existing = await this.db.submission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId: auth.sub } },
    });
    if (existing?.score != null) throw new BadRequestException('This has already been graded');
    await this.db.submission.upsert({
      where: { assignmentId_studentId: { assignmentId, studentId: auth.sub } },
      create: { schoolId: auth.schoolId, assignmentId, studentId: auth.sub, text: body },
      update: { text: body, submittedAt: new Date() },
    });
    return { ok: true };
  }
}

@Controller('student')
@Public() // bypasses the staff guard; StudentGuard authenticates instead
export class StudentPortalController {
  constructor(private svc: StudentPortalService) {}

  /** Public in both senses — no session exists yet at sign-in. */
  @Post('auth/login')
  login(@Body() dto: StudentLoginDto) {
    return this.svc.login(dto);
  }

  @UseGuards(StudentGuard)
  @Get('me')
  me(@CurrentStudent() s: StudentUser) {
    return this.svc.me(s);
  }

  @UseGuards(StudentGuard)
  @Get('reports/:termId/pdf')
  async reportPdf(@CurrentStudent() s: StudentUser, @Param('termId') termId: string) {
    const buf = await this.svc.reportCardPdf(s, termId);
    return new StreamableFile(buf, {
      type: 'application/pdf',
      disposition: `attachment; filename="report-${termId}.pdf"`,
    });
  }

  @UseGuards(StudentGuard)
  @Get('notices')
  notices(@CurrentStudent() s: StudentUser) {
    return this.svc.notices(s);
  }

  @UseGuards(StudentGuard)
  @Get('calendar')
  calendar(@CurrentStudent() s: StudentUser) {
    return this.svc.calendarEvents(s);
  }

  @UseGuards(StudentGuard)
  @Get('resources')
  resources(@CurrentStudent() s: StudentUser) {
    return this.svc.learningResources(s);
  }

  @UseGuards(StudentGuard)
  @Get('resources/:id/file')
  async resourceFile(@CurrentStudent() s: StudentUser, @Param('id') id: string) {
    // Streamed, not buffered — a shared lesson video must not transit the heap per reader.
    return ResourcesService.asFile(await this.svc.resourceFile(s, id));
  }

  @UseGuards(StudentGuard)
  @Get('lms')
  lms(@CurrentStudent() s: StudentUser) {
    return this.svc.lms(s);
  }

  @UseGuards(StudentGuard)
  @Post('lms/assignments/:id/submit')
  submit(@CurrentStudent() s: StudentUser, @Param('id') id: string, @Body() dto: SubmitDto) {
    return this.svc.submitAssignment(s, id, dto.text);
  }
}

/** Staff-side: issuing and revoking a student's portal PIN. */
@Controller('students')
export class StudentPinController {
  constructor(private svc: StudentPortalService) {}

  @Post(':id/portal-pin')
  @RequirePermission('students.edit')
  issue(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.issuePin(user, id);
  }

  @Delete(':id/portal-pin')
  @RequirePermission('students.edit')
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.revokePin(user, id);
  }
}

@Module({
  imports: [CalendarModule, ResourcesModule],
  controllers: [StudentPortalController, StudentPinController],
  providers: [StudentPortalService, StudentGuard],
  exports: [StudentPortalService, StudentGuard],
})
export class StudentPortalModule {}

export { StudentLoginDto };
