/**
 * Computer-based tests and question banks (FEATURES.md §5, exams.cbt).
 *
 * Banks hold multiple-choice questions per subject and level; an exam is composed from a bank
 * for one class and auto-marked on submission. Every candidate answers the same paper (the
 * bank's first N questions), the correct answers never travel to the student, and marks can be
 * posted into the ordinary gradebook as an assessment component — from where they flow into
 * terminal reports like any hand-entered score.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthUser,
  CurrentUser,
  Public,
  RequireEntitlement,
  RequirePermission,
} from '../common/auth';
import { LicenceService } from '../licence/licence.service';
import {
  CurrentStudent,
  StudentGuard,
  StudentPortalModule,
  StudentUser,
} from '../student-portal/student-portal.module';

/** How long past the clock a submission is still taken — slow networks, not slow pupils. */
const GRACE_SECONDS = 120;

class BankDto {
  @IsString() subjectId: string;
  @IsString() levelId: string;
  @IsString() @MinLength(2) @MaxLength(120) name: string;
}

class QuestionDto {
  @IsString() @MinLength(5) @MaxLength(1000) text: string;
  @IsArray() @ArrayMinSize(2) @IsString({ each: true }) options: string[];
  @IsInt() @Min(0) correctIndex: number;
  @IsOptional() @IsString() @MaxLength(1000) explanation?: string;
}

class ExamDto {
  @IsString() @MinLength(2) @MaxLength(140) title: string;
  @IsString() bankId: string;
  @IsString() classId: string;
  @IsInt() @Min(1) @Max(300) durationMinutes: number;
  @IsInt() @Min(1) @Max(200) questionCount: number;
  /** Optional gradebook destination. */
  @IsOptional() @IsString() componentId?: string;
}

class SubmitDto {
  /** questionId → chosen option index. Decorated, or the whitelisting pipe strips it away. */
  @IsObject() answers: Record<string, number>;
}

@Injectable()
export class ExamsService {
  constructor(
    private db: PrismaService,
    private licence: LicenceService,
  ) {}

  // ── Banks & questions ──────────────────────────────────────────────

  async banks(auth: AuthUser) {
    const rows = await this.db.questionBank.findMany({
      where: { schoolId: auth.schoolId },
      include: {
        subject: { select: { name: true } },
        level: { select: { name: true } },
        _count: { select: { questions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((b) => ({
      id: b.id,
      name: b.name,
      subjectId: b.subjectId,
      subject: b.subject.name,
      levelId: b.levelId,
      level: b.level.name,
      questions: b._count.questions,
    }));
  }

  async createBank(auth: AuthUser, dto: BankDto) {
    const [subject, level] = await Promise.all([
      this.db.subject.findFirst({ where: { id: dto.subjectId, schoolId: auth.schoolId } }),
      this.db.level.findFirst({ where: { id: dto.levelId, schoolId: auth.schoolId } }),
    ]);
    if (!subject || !level) throw new NotFoundException('Pick a subject and level from the list');
    const bank = await this.db.questionBank.create({
      data: {
        schoolId: auth.schoolId,
        subjectId: dto.subjectId,
        levelId: dto.levelId,
        name: dto.name.trim(),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'exams.bank.create', 'QuestionBank', bank.id, {
      name: dto.name,
    });
    return { id: bank.id };
  }

  async deleteBank(auth: AuthUser, id: string) {
    const bank = await this.db.questionBank.findFirst({
      where: { id, schoolId: auth.schoolId },
      include: { _count: { select: { exams: true } } },
    });
    if (!bank) throw new NotFoundException('Bank not found');
    if (bank._count.exams > 0) {
      throw new BadRequestException('Exams have been set from this bank — it stays.');
    }
    await this.db.questionBank.delete({ where: { id } });
    return { deleted: true };
  }

  /** Staff view — WITH the answers. The student path never uses this. */
  async questions(auth: AuthUser, bankId: string) {
    const bank = await this.db.questionBank.findFirst({
      where: { id: bankId, schoolId: auth.schoolId },
    });
    if (!bank) throw new NotFoundException('Bank not found');
    return this.db.question.findMany({
      where: { bankId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        text: true,
        options: true,
        correctIndex: true,
        explanation: true,
      },
    });
  }

  async addQuestion(auth: AuthUser, bankId: string, dto: QuestionDto) {
    const bank = await this.db.questionBank.findFirst({
      where: { id: bankId, schoolId: auth.schoolId },
    });
    if (!bank) throw new NotFoundException('Bank not found');
    if (dto.correctIndex >= dto.options.length) {
      throw new BadRequestException('The correct answer must be one of the options');
    }
    const q = await this.db.question.create({
      data: {
        schoolId: auth.schoolId,
        bankId,
        text: dto.text.trim(),
        options: dto.options.map((o) => o.trim()),
        correctIndex: dto.correctIndex,
        explanation: dto.explanation?.trim(),
      },
    });
    return { id: q.id };
  }

  async deleteQuestion(auth: AuthUser, id: string) {
    const q = await this.db.question.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!q) throw new NotFoundException('Question not found');
    await this.db.question.delete({ where: { id } });
    return { deleted: true };
  }

  // ── Exams ──────────────────────────────────────────────────────────

  async exams(auth: AuthUser) {
    const rows = await this.db.cbtExam.findMany({
      where: { schoolId: auth.schoolId },
      include: {
        bank: { select: { name: true, subject: { select: { name: true } } } },
        _count: { select: { attempts: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const classes = await this.db.classRoom.findMany({
      where: { schoolId: auth.schoolId },
      select: { id: true, name: true },
    });
    const className = new Map(classes.map((c) => [c.id, c.name]));
    return rows.map((e) => ({
      id: e.id,
      title: e.title,
      bank: e.bank.name,
      subject: e.bank.subject.name,
      className: className.get(e.classId) ?? '—',
      durationMinutes: e.durationMinutes,
      questionCount: e.questionCount,
      status: e.status,
      attempts: e._count.attempts,
    }));
  }

  async createExam(auth: AuthUser, dto: ExamDto) {
    const [bank, cls] = await Promise.all([
      this.db.questionBank.findFirst({
        where: { id: dto.bankId, schoolId: auth.schoolId },
        include: { _count: { select: { questions: true } } },
      }),
      this.db.classRoom.findFirst({ where: { id: dto.classId, schoolId: auth.schoolId } }),
    ]);
    if (!bank) throw new NotFoundException('Bank not found');
    if (!cls) throw new NotFoundException('Class not found');
    if (bank._count.questions < dto.questionCount) {
      throw new BadRequestException(
        `The bank has ${bank._count.questions} question${bank._count.questions === 1 ? '' : 's'} — not enough for ${dto.questionCount}`,
      );
    }
    if (dto.componentId) {
      const component = await this.db.assessmentComponent.findFirst({
        where: { id: dto.componentId, schoolId: auth.schoolId },
      });
      if (!component) throw new NotFoundException('Assessment component not found');
    }
    const exam = await this.db.cbtExam.create({
      data: {
        schoolId: auth.schoolId,
        title: dto.title.trim(),
        bankId: dto.bankId,
        classId: dto.classId,
        durationMinutes: dto.durationMinutes,
        questionCount: dto.questionCount,
        componentId: dto.componentId ?? null,
        createdById: auth.sub,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'exams.exam.create', 'CbtExam', exam.id, {
      title: dto.title,
    });
    return { id: exam.id };
  }

  async setStatus(auth: AuthUser, id: string, status: 'OPEN' | 'CLOSED') {
    const exam = await this.db.cbtExam.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!exam) throw new NotFoundException('Exam not found');
    await this.db.cbtExam.update({ where: { id }, data: { status } });
    await this.db.audit(auth.schoolId, auth.sub, 'exams.exam.status', 'CbtExam', id, { status });
    return { ok: true, status };
  }

  async results(auth: AuthUser, id: string) {
    const exam = await this.db.cbtExam.findFirst({
      where: { id, schoolId: auth.schoolId },
      include: { bank: { select: { name: true } } },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    const [attempts, roll] = await Promise.all([
      this.db.cbtAttempt.findMany({
        where: { examId: id },
        include: {
          student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
        },
      }),
      this.db.student.count({
        where: { schoolId: auth.schoolId, classId: exam.classId, status: 'ACTIVE' },
      }),
    ]);
    return {
      id: exam.id,
      title: exam.title,
      status: exam.status,
      classSize: roll,
      attempts: attempts
        .map((a) => ({
          studentId: a.student.id,
          name: `${a.student.firstName} ${a.student.lastName}`,
          admissionNo: a.student.admissionNo,
          submittedAt: a.submittedAt,
          score: a.score,
          total: a.total,
        }))
        .sort((x, y) => (y.score ?? -1) - (x.score ?? -1)),
    };
  }

  /**
   * Post marks into the gradebook: each submitted score, scaled to the component's maxScore,
   * lands as an ordinary Score row for the current term — from where it feeds terminal reports
   * exactly like a hand-entered mark. Upserts, so re-posting refreshes rather than duplicates.
   */
  async postToGradebook(auth: AuthUser, id: string) {
    const exam = await this.db.cbtExam.findFirst({
      where: { id, schoolId: auth.schoolId },
      include: { bank: { select: { subjectId: true } } },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    if (!exam.componentId) {
      throw new BadRequestException('This exam has no gradebook component to post into');
    }
    const [component, term] = await Promise.all([
      this.db.assessmentComponent.findFirstOrThrow({ where: { id: exam.componentId } }),
      this.db.term.findFirst({
        where: { isCurrent: true, academicYear: { schoolId: auth.schoolId, isCurrent: true } },
      }),
    ]);
    if (!term) throw new BadRequestException('No current term to post into');

    const attempts = await this.db.cbtAttempt.findMany({
      where: { examId: id, submittedAt: { not: null } },
    });
    let posted = 0;
    for (const a of attempts) {
      if (a.score === null || a.total === null || a.total === 0) continue;
      const rawScore = Math.round((a.score / a.total) * component.maxScore * 10) / 10;
      await this.db.score.upsert({
        where: {
          studentId_subjectId_termId_componentId: {
            studentId: a.studentId,
            subjectId: exam.bank.subjectId,
            termId: term.id,
            componentId: component.id,
          },
        },
        create: {
          schoolId: auth.schoolId,
          studentId: a.studentId,
          subjectId: exam.bank.subjectId,
          termId: term.id,
          componentId: component.id,
          rawScore,
          enteredById: auth.sub,
        },
        update: { rawScore, enteredById: auth.sub },
      });
      posted++;
    }
    await this.db.audit(auth.schoolId, auth.sub, 'exams.post', 'CbtExam', id, { posted });
    return { posted };
  }

  // ── The pupil's side ───────────────────────────────────────────────

  private assertEntitled() {
    if (!this.licence.entitlements().includes('exams.cbt')) {
      throw new NotFoundException('Computer-based tests are not available');
    }
  }

  /** The paper, without its answers. Same first-N slice for every candidate. */
  private async paper(exam: { bankId: string; questionCount: number }) {
    const questions = await this.db.question.findMany({
      where: { bankId: exam.bankId },
      orderBy: { createdAt: 'asc' },
      take: exam.questionCount,
      select: { id: true, text: true, options: true },
    });
    return questions;
  }

  async myExams(student: StudentUser) {
    this.assertEntitled();
    const me = await this.db.student.findUniqueOrThrow({
      where: { id: student.sub },
      select: { classId: true },
    });
    if (!me.classId) return [];
    const exams = await this.db.cbtExam.findMany({
      where: {
        schoolId: student.schoolId,
        classId: me.classId,
        status: { in: ['OPEN', 'CLOSED'] },
      },
      include: { bank: { select: { subject: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    const attempts = await this.db.cbtAttempt.findMany({
      where: { studentId: student.sub, examId: { in: exams.map((e) => e.id) } },
    });
    const byExam = new Map(attempts.map((a) => [a.examId, a]));
    return exams.map((e) => {
      const attempt = byExam.get(e.id);
      return {
        id: e.id,
        title: e.title,
        subject: e.bank.subject.name,
        durationMinutes: e.durationMinutes,
        questionCount: e.questionCount,
        status: e.status,
        attempt: attempt
          ? {
              submittedAt: attempt.submittedAt,
              score: e.status === 'CLOSED' ? attempt.score : null,
              total: e.status === 'CLOSED' ? attempt.total : null,
            }
          : null,
      };
    });
  }

  /** Start (or resume) a sitting. The clock runs from the FIRST start — reopening resumes it. */
  async start(student: StudentUser, examId: string) {
    this.assertEntitled();
    const exam = await this.db.cbtExam.findFirst({
      where: { id: examId, schoolId: student.schoolId, status: 'OPEN' },
    });
    if (!exam) throw new NotFoundException('That exam is not open');
    const me = await this.db.student.findUniqueOrThrow({
      where: { id: student.sub },
      select: { classId: true },
    });
    if (me.classId !== exam.classId) throw new NotFoundException('That exam is not for your class');

    const attempt = await this.db.cbtAttempt.upsert({
      where: { examId_studentId: { examId, studentId: student.sub } },
      create: { schoolId: student.schoolId, examId, studentId: student.sub },
      update: {},
    });
    if (attempt.submittedAt) {
      throw new BadRequestException('You have already submitted this exam');
    }
    const endsAt = new Date(attempt.startedAt.getTime() + exam.durationMinutes * 60_000);
    return {
      attemptId: attempt.id,
      title: exam.title,
      startedAt: attempt.startedAt,
      endsAt,
      questions: await this.paper(exam),
    };
  }

  async submit(student: StudentUser, examId: string, dto: SubmitDto) {
    this.assertEntitled();
    const exam = await this.db.cbtExam.findFirst({
      where: { id: examId, schoolId: student.schoolId },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    const attempt = await this.db.cbtAttempt.findUnique({
      where: { examId_studentId: { examId, studentId: student.sub } },
    });
    if (!attempt) throw new BadRequestException('Start the exam first');
    if (attempt.submittedAt) {
      // Submitting twice returns the first result — a retried request must not look like cheating.
      return { score: attempt.score, total: attempt.total, alreadySubmitted: true };
    }
    const deadline =
      attempt.startedAt.getTime() + exam.durationMinutes * 60_000 + GRACE_SECONDS * 1000;
    if (Date.now() > deadline) {
      throw new BadRequestException('Time is up — this sitting can no longer be submitted');
    }

    const questions = await this.db.question.findMany({
      where: { bankId: exam.bankId },
      orderBy: { createdAt: 'asc' },
      take: exam.questionCount,
      select: { id: true, correctIndex: true },
    });
    const answers = dto.answers ?? {};
    const score = questions.filter((q) => answers[q.id] === q.correctIndex).length;

    await this.db.cbtAttempt.update({
      where: { id: attempt.id },
      data: { submittedAt: new Date(), answers, score, total: questions.length },
    });
    // Scores are shown once the exam is CLOSED — everyone hears together, like a real paper.
    return { submitted: true, total: questions.length };
  }
}

@Controller('exams')
@RequireEntitlement('exams.cbt')
export class ExamsController {
  constructor(private svc: ExamsService) {}

  @Get('banks')
  @RequirePermission('marks.view')
  banks(@CurrentUser() user: AuthUser) {
    return this.svc.banks(user);
  }

  @Post('banks')
  @RequirePermission('assessment.configure')
  createBank(@CurrentUser() user: AuthUser, @Body() dto: BankDto) {
    return this.svc.createBank(user, dto);
  }

  @Delete('banks/:id')
  @RequirePermission('assessment.configure')
  deleteBank(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteBank(user, id);
  }

  @Get('banks/:id/questions')
  @RequirePermission('marks.view')
  questions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.questions(user, id);
  }

  @Post('banks/:id/questions')
  @RequirePermission('assessment.configure')
  addQuestion(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: QuestionDto) {
    return this.svc.addQuestion(user, id, dto);
  }

  @Delete('questions/:id')
  @RequirePermission('assessment.configure')
  deleteQuestion(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteQuestion(user, id);
  }

  @Get()
  @RequirePermission('marks.view')
  exams(@CurrentUser() user: AuthUser) {
    return this.svc.exams(user);
  }

  @Post()
  @RequirePermission('assessment.configure')
  createExam(@CurrentUser() user: AuthUser, @Body() dto: ExamDto) {
    return this.svc.createExam(user, dto);
  }

  @Patch(':id/status')
  @RequirePermission('assessment.configure')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('status') status: 'OPEN' | 'CLOSED',
  ) {
    if (status !== 'OPEN' && status !== 'CLOSED') {
      throw new BadRequestException('status must be OPEN or CLOSED');
    }
    return this.svc.setStatus(user, id, status);
  }

  @Get(':id/results')
  @RequirePermission('marks.view')
  results(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.results(user, id);
  }

  @Post(':id/post')
  @RequirePermission('marks.enter')
  post(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.postToGradebook(user, id);
  }
}

/** The pupil's side rides the student session, not the staff guard. */
@Controller('student/cbt')
@Public()
@UseGuards(StudentGuard)
export class StudentExamsController {
  constructor(private svc: ExamsService) {}

  @Get()
  myExams(@CurrentStudent() s: StudentUser) {
    return this.svc.myExams(s);
  }

  @Post(':id/start')
  start(@CurrentStudent() s: StudentUser, @Param('id') id: string) {
    return this.svc.start(s, id);
  }

  @Post(':id/submit')
  submit(@CurrentStudent() s: StudentUser, @Param('id') id: string, @Body() dto: SubmitDto) {
    return this.svc.submit(s, id, dto);
  }
}

@Module({
  imports: [StudentPortalModule],
  controllers: [ExamsController, StudentExamsController],
  providers: [ExamsService],
  exports: [ExamsService],
})
export class ExamsModule {}
