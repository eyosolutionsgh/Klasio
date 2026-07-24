/**
 * LMS (lms.core) — the staff side.
 *
 * A step beyond the document library: a teacher publishes a lesson to a class for a subject, sets
 * an assignment with a due date, and grades what pupils submit from home. Class, subject and pupil
 * are scalar ids scoped in code and by RLS. The pupil-facing half — reading lessons and submitting
 * work — lives in the student portal, on the student guard.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsDateString,
  IsInt,
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
  RequireAnyPermission,
  RequireEntitlement,
  RequirePermission,
} from '../common/auth';

class LessonDto {
  @IsString() classId: string;
  @IsString() subjectId: string;
  @IsString() @MinLength(2) @MaxLength(160) title: string;
  @IsString() @MinLength(1) @MaxLength(20000) content: string;
}

class AssignmentDto {
  @IsString() classId: string;
  @IsString() subjectId: string;
  @IsString() @MinLength(2) @MaxLength(160) title: string;
  @IsString() @MinLength(1) @MaxLength(20000) instructions: string;
  @IsDateString() dueAt: string;
  @IsOptional() @IsInt() @Min(1) @Max(1000) points?: number;
}

class GradeDto {
  @IsInt() @Min(0) @Max(1000) score: number;
  @IsOptional() @IsString() @MaxLength(2000) feedback?: string;
}

@Injectable()
export class LmsService {
  constructor(private db: PrismaService) {}

  private name(s: { firstName: string; lastName: string }) {
    return `${s.firstName} ${s.lastName}`;
  }

  private async assertClassSubject(auth: AuthUser, classId: string, subjectId: string) {
    const [cls, subject] = await Promise.all([
      this.db.classRoom.findFirst({ where: { id: classId, schoolId: auth.schoolId } }),
      this.db.subject.findFirst({ where: { id: subjectId, schoolId: auth.schoolId } }),
    ]);
    if (!cls) throw new NotFoundException('Class not found');
    if (!subject) throw new NotFoundException('Subject not found');
  }

  /** Lessons and assignments for one class, newest first, with each assignment's submission tally. */
  async forClass(auth: AuthUser, classId: string, subjectId?: string) {
    const cls = await this.db.classRoom.findFirst({
      where: { id: classId, schoolId: auth.schoolId },
    });
    if (!cls) throw new NotFoundException('Class not found');
    const where = { schoolId: auth.schoolId, classId, ...(subjectId ? { subjectId } : {}) };

    const [lessons, assignments, subjects, roster] = await Promise.all([
      this.db.lesson.findMany({ where, orderBy: { createdAt: 'desc' } }),
      this.db.assignment.findMany({
        where,
        orderBy: { dueAt: 'desc' },
        include: { _count: { select: { submissions: true } } },
      }),
      this.db.subject.findMany({
        where: { schoolId: auth.schoolId },
        select: { id: true, name: true },
      }),
      this.db.student.count({ where: { schoolId: auth.schoolId, classId, status: 'ACTIVE' } }),
    ]);
    const subjectName = new Map(subjects.map((s) => [s.id, s.name]));

    const graded = await this.db.submission.groupBy({
      by: ['assignmentId'],
      where: {
        schoolId: auth.schoolId,
        assignmentId: { in: assignments.map((a) => a.id) },
        score: { not: null },
      },
      _count: true,
    });
    const gradedBy = new Map(graded.map((g) => [g.assignmentId, g._count]));

    return {
      className: cls.name,
      roster,
      lessons: lessons.map((l) => ({
        id: l.id,
        title: l.title,
        subject: subjectName.get(l.subjectId) ?? '—',
        content: l.content,
        createdAt: l.createdAt,
      })),
      assignments: assignments.map((a) => ({
        id: a.id,
        title: a.title,
        subject: subjectName.get(a.subjectId) ?? '—',
        dueAt: a.dueAt,
        points: a.points,
        submissions: a._count.submissions,
        graded: gradedBy.get(a.id) ?? 0,
        overdue: a.dueAt < new Date(),
      })),
    };
  }

  async createLesson(auth: AuthUser, dto: LessonDto) {
    await this.assertClassSubject(auth, dto.classId, dto.subjectId);
    const lesson = await this.db.lesson.create({
      data: {
        schoolId: auth.schoolId,
        classId: dto.classId,
        subjectId: dto.subjectId,
        title: dto.title.trim(),
        content: dto.content,
        createdById: auth.sub,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'lms.lesson.create', 'Lesson', lesson.id, {
      title: lesson.title,
    });
    return lesson;
  }

  async deleteLesson(auth: AuthUser, id: string) {
    const lesson = await this.db.lesson.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!lesson) throw new NotFoundException('Lesson not found');
    await this.db.lesson.delete({ where: { id } });
    return { deleted: true };
  }

  async createAssignment(auth: AuthUser, dto: AssignmentDto) {
    await this.assertClassSubject(auth, dto.classId, dto.subjectId);
    const assignment = await this.db.assignment.create({
      data: {
        schoolId: auth.schoolId,
        classId: dto.classId,
        subjectId: dto.subjectId,
        title: dto.title.trim(),
        instructions: dto.instructions,
        dueAt: new Date(dto.dueAt),
        points: dto.points ?? 100,
        createdById: auth.sub,
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'lms.assignment.create',
      'Assignment',
      assignment.id,
      {
        title: assignment.title,
      },
    );
    return assignment;
  }

  async deleteAssignment(auth: AuthUser, id: string) {
    const assignment = await this.db.assignment.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    await this.db.assignment.delete({ where: { id } });
    return { deleted: true };
  }

  /** One assignment's submissions, with the pupils' names and who has not turned it in. */
  async submissions(auth: AuthUser, assignmentId: string) {
    const assignment = await this.db.assignment.findFirst({
      where: { id: assignmentId, schoolId: auth.schoolId },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    const [subs, roster] = await Promise.all([
      this.db.submission.findMany({
        where: { schoolId: auth.schoolId, assignmentId },
        orderBy: { submittedAt: 'asc' },
      }),
      this.db.student.findMany({
        where: { schoolId: auth.schoolId, classId: assignment.classId, status: 'ACTIVE' },
        select: { id: true, firstName: true, lastName: true, admissionNo: true },
      }),
    ]);
    const studentById = new Map(roster.map((s) => [s.id, s]));
    const submittedIds = new Set(subs.map((s) => s.studentId));

    return {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        points: assignment.points,
        dueAt: assignment.dueAt,
      },
      submissions: subs.map((s) => {
        const st = studentById.get(s.studentId);
        return {
          id: s.id,
          studentId: s.studentId,
          name: st ? this.name(st) : 'Unknown',
          admissionNo: st?.admissionNo ?? null,
          text: s.text,
          submittedAt: s.submittedAt,
          score: s.score,
          feedback: s.feedback,
        };
      }),
      notSubmitted: roster
        .filter((s) => !submittedIds.has(s.id))
        .map((s) => ({ studentId: s.id, name: this.name(s) })),
    };
  }

  async grade(auth: AuthUser, submissionId: string, dto: GradeDto) {
    const sub = await this.db.submission.findFirst({
      where: { id: submissionId, schoolId: auth.schoolId },
      include: { assignment: { select: { points: true } } },
    });
    if (!sub) throw new NotFoundException('Submission not found');
    if (dto.score > sub.assignment.points) {
      throw new NotFoundException(
        `Score cannot exceed the ${sub.assignment.points} marks on offer`,
      );
    }
    const updated = await this.db.submission.update({
      where: { id: submissionId },
      data: {
        score: dto.score,
        feedback: dto.feedback?.trim() || null,
        gradedById: auth.sub,
        gradedAt: new Date(),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'lms.grade', 'Submission', submissionId, {
      score: dto.score,
    });
    return updated;
  }
}

@Controller('lms')
@RequireEntitlement('lms.core')
export class LmsController {
  constructor(private svc: LmsService) {}

  @Get()
  @RequireAnyPermission('lms.view', 'lms.manage')
  forClass(
    @CurrentUser() user: AuthUser,
    @Query('classId') classId: string,
    @Query('subjectId') subjectId?: string,
  ) {
    return this.svc.forClass(user, classId, subjectId);
  }

  @Post('lessons')
  @RequirePermission('lms.manage')
  createLesson(@CurrentUser() user: AuthUser, @Body() dto: LessonDto) {
    return this.svc.createLesson(user, dto);
  }

  @Delete('lessons/:id')
  @RequirePermission('lms.manage')
  deleteLesson(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteLesson(user, id);
  }

  @Post('assignments')
  @RequirePermission('lms.manage')
  createAssignment(@CurrentUser() user: AuthUser, @Body() dto: AssignmentDto) {
    return this.svc.createAssignment(user, dto);
  }

  @Delete('assignments/:id')
  @RequirePermission('lms.manage')
  deleteAssignment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteAssignment(user, id);
  }

  @Get('assignments/:id/submissions')
  @RequireAnyPermission('lms.view', 'lms.manage')
  submissions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.submissions(user, id);
  }

  @Post('submissions/:id/grade')
  @RequirePermission('lms.manage')
  grade(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: GradeDto) {
    return this.svc.grade(user, id, dto);
  }
}

@Module({
  controllers: [LmsController],
  providers: [LmsService],
})
export class LmsModule {}
