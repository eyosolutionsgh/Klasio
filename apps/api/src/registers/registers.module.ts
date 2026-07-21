/**
 * The books a school keeps on a shelf, and an inspection asks to see.
 *
 * NaSIA licences and inspects private schools, and the inspection is largely a request for
 * ledgers: the admission register, the attendance registers, the log book, the visitors book, the
 * discipline book, the record of vetted lesson notes. Klasio already held the roll, the register
 * and the marks — so a school ran the software for everything a parent sees, and still kept six
 * hardback books for everything an inspector sees.
 *
 * These are the six that were missing. They are deliberately plain: dated, attributed, and easy
 * to print. A log book entry's value is not that it is structured, it is that nobody can quietly
 * change what Tuesday said.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
} from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/auth';
import { PageQuery, dateWindow, pageArgs, toPage } from '../common/list-query';
import { toCsv, Cell } from '../common/export';

const LOG_KINDS = ['GENERAL', 'VISIT', 'INCIDENT', 'ABSENCE', 'MAINTENANCE'] as const;
const OUTCOMES = ['RECORDED', 'WARNED', 'PARENT_INFORMED', 'SUSPENDED', 'RESOLVED'] as const;

class LogEntryDto {
  @IsOptional() @IsDateString() entryDate?: string;
  @IsOptional() @IsIn(LOG_KINDS) kind?: (typeof LOG_KINDS)[number];
  @IsString() @MinLength(3) body: string;
}

class DutyDto {
  @IsString() userId: string;
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
  @IsOptional() @IsString() note?: string;
}

class LessonNoteDto {
  @IsDateString() weekOf: string;
  @IsString() @MinLength(3) title: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() subjectId?: string;
}

class VetDto {
  @IsIn(['APPROVED', 'RETURNED']) status: 'APPROVED' | 'RETURNED';
  @IsOptional() @IsString() comment?: string;
}

class DisciplineDto {
  @IsString() studentId: string;
  @IsDateString() occurredOn: string;
  @IsString() @MinLength(5) description: string;
  @IsOptional() @IsString() actionTaken?: string;
  @IsOptional() @IsIn(OUTCOMES) outcome?: (typeof OUTCOMES)[number];
  @IsOptional() @IsDateString() guardianInformedAt?: string;
}

class VisitorDto {
  @IsString() @MinLength(2) name: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() organisation?: string;
  @IsString() @MinLength(2) purpose: string;
  @IsOptional() @IsString() toSee?: string;
  @IsOptional() @IsString() badgeNo?: string;
}

class FeedingDto {
  @IsString() studentId: string;
  @IsOptional() @IsDateString() onDate?: string;
  @IsNumber() @IsPositive() amount: number;
}

class ListDto extends PageQuery {}

/** Midnight, so a day's records group by the day rather than the moment. */
const day = (d?: string) => {
  const x = d ? new Date(d) : new Date();
  x.setHours(0, 0, 0, 0);
  return x;
};

@Injectable()
export class RegistersService {
  constructor(private db: PrismaService) {}

  // ── Log book ───────────────────────────────────────────────────────

  async writeLog(auth: AuthUser, dto: LogEntryDto) {
    const entry = await this.db.logBookEntry.create({
      data: {
        schoolId: auth.schoolId,
        entryDate: day(dto.entryDate),
        kind: dto.kind ?? 'GENERAL',
        body: dto.body.trim(),
        authorId: auth.sub,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'logbook.write', 'LogBookEntry', entry.id);
    return entry;
  }

  async logBook(auth: AuthUser, q: ListDto) {
    const { skip, take, page, perPage } = pageArgs(q);
    const window = dateWindow(q);
    const where = {
      schoolId: auth.schoolId,
      ...(window ? { entryDate: window } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.logBookEntry.findMany({
        where,
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      this.db.logBookEntry.count({ where }),
    ]);
    const authors = await this.db.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } },
      select: { id: true, name: true },
    });
    const byId = new Map(authors.map((a) => [a.id, a.name]));
    return toPage(
      rows.map((r) => ({ ...r, authorName: byId.get(r.authorId) ?? 'Unknown' })),
      total,
      { page, perPage },
    );
  }

  // ── Duty roster ────────────────────────────────────────────────────

  async setDuty(auth: AuthUser, dto: DutyDto) {
    const user = await this.db.user.findFirst({
      where: { id: dto.userId, schoolId: auth.schoolId },
    });
    if (!user) throw new NotFoundException('That member of staff is not on this school');
    const start = day(dto.startDate);
    const end = day(dto.endDate);
    if (end < start) throw new BadRequestException('A duty turn cannot end before it starts');

    const row = await this.db.dutyRoster.create({
      data: {
        schoolId: auth.schoolId,
        userId: dto.userId,
        startDate: start,
        endDate: end,
        note: dto.note?.trim() || null,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'duty.assign', 'DutyRoster', row.id, {
      userId: dto.userId,
    });
    return row;
  }

  async duty(auth: AuthUser, q: ListDto) {
    const { skip, take, page, perPage } = pageArgs(q);
    const where = { schoolId: auth.schoolId };
    const [rows, total] = await Promise.all([
      this.db.dutyRoster.findMany({
        where,
        include: { user: { select: { name: true } } },
        orderBy: { startDate: 'desc' },
        skip,
        take,
      }),
      this.db.dutyRoster.count({ where }),
    ]);
    return toPage(
      rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        name: r.user.name,
        startDate: r.startDate,
        endDate: r.endDate,
        note: r.note,
      })),
      total,
      { page, perPage },
    );
  }

  /** Who is on duty right now — what the front desk and the log book both want to know. */
  async onDutyToday(auth: AuthUser) {
    const today = day();
    const rows = await this.db.dutyRoster.findMany({
      where: { schoolId: auth.schoolId, startDate: { lte: today }, endDate: { gte: today } },
      include: { user: { select: { name: true } } },
    });
    return rows.map((r) => ({ userId: r.userId, name: r.user.name, note: r.note }));
  }

  async removeDuty(auth: AuthUser, id: string) {
    const row = await this.db.dutyRoster.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!row) throw new NotFoundException('Not found');
    await this.db.dutyRoster.delete({ where: { id } });
    await this.db.audit(auth.schoolId, auth.sub, 'duty.remove', 'DutyRoster', id);
    return { removed: true };
  }

  // ── Lesson-note vetting ────────────────────────────────────────────

  async submitNote(auth: AuthUser, dto: LessonNoteDto) {
    const note = await this.db.lessonNote.create({
      data: {
        schoolId: auth.schoolId,
        teacherId: auth.sub,
        classId: dto.classId || null,
        subjectId: dto.subjectId || null,
        weekOf: day(dto.weekOf),
        title: dto.title.trim(),
        body: dto.body?.trim() || null,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'lessonnote.submit', 'LessonNote', note.id);
    return note;
  }

  /**
   * A teacher sees their own notes; a vetter sees everyone's.
   *
   * Not a filter the caller passes, because "show me everybody's" would then be a query parameter
   * anyone could type.
   */
  async lessonNotes(auth: AuthUser, q: ListDto & { status?: string }) {
    const mayVet = auth.permissions?.includes('registers.vet_notes') ?? false;
    const { skip, take, page, perPage } = pageArgs(q);
    const where: Prisma.LessonNoteWhereInput = {
      schoolId: auth.schoolId,
      ...(mayVet ? {} : { teacherId: auth.sub }),
      ...(q.status && ['SUBMITTED', 'APPROVED', 'RETURNED'].includes(q.status)
        ? { status: q.status as 'SUBMITTED' | 'APPROVED' | 'RETURNED' }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.lessonNote.findMany({
        where,
        include: { teacher: { select: { name: true } } },
        orderBy: [{ weekOf: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      this.db.lessonNote.count({ where }),
    ]);
    return toPage(
      rows.map((r) => ({
        id: r.id,
        teacherName: r.teacher.name,
        weekOf: r.weekOf,
        title: r.title,
        body: r.body,
        status: r.status,
        comment: r.comment,
        vettedAt: r.vettedAt,
      })),
      total,
      { page, perPage },
    );
  }

  async vetNote(auth: AuthUser, id: string, dto: VetDto) {
    const note = await this.db.lessonNote.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!note) throw new NotFoundException('Not found');
    if (note.teacherId === auth.sub) {
      // The whole point of vetting is that somebody else read it.
      throw new ForbiddenException('Someone else must vet your own lesson notes');
    }
    if (dto.status === 'RETURNED' && !dto.comment?.trim()) {
      // "Redo it" with no reason is not vetting; it is a bounce.
      throw new BadRequestException('Say what needs changing when returning lesson notes');
    }
    const updated = await this.db.lessonNote.update({
      where: { id },
      data: {
        status: dto.status,
        comment: dto.comment?.trim() || null,
        vettedById: auth.sub,
        vettedAt: new Date(),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'lessonnote.vet', 'LessonNote', id, {
      status: dto.status,
    });
    return updated;
  }

  // ── Discipline book ────────────────────────────────────────────────

  async recordDiscipline(auth: AuthUser, dto: DisciplineDto) {
    const student = await this.db.student.findFirst({
      where: { id: dto.studentId, schoolId: auth.schoolId },
    });
    if (!student) throw new NotFoundException('Student not found');
    const entry = await this.db.disciplineEntry.create({
      data: {
        schoolId: auth.schoolId,
        studentId: dto.studentId,
        occurredOn: day(dto.occurredOn),
        description: dto.description.trim(),
        actionTaken: dto.actionTaken?.trim() || null,
        outcome: dto.outcome ?? 'RECORDED',
        guardianInformedAt: dto.guardianInformedAt ? new Date(dto.guardianInformedAt) : null,
        recordedById: auth.sub,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'discipline.record', 'Student', dto.studentId, {
      outcome: entry.outcome,
    });
    return entry;
  }

  async discipline(auth: AuthUser, q: ListDto & { studentId?: string }) {
    const { skip, take, page, perPage } = pageArgs(q);
    const window = dateWindow(q);
    const where = {
      schoolId: auth.schoolId,
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(window ? { occurredOn: window } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.disciplineEntry.findMany({
        where,
        include: {
          student: { select: { firstName: true, lastName: true, admissionNo: true } },
        },
        orderBy: { occurredOn: 'desc' },
        skip,
        take,
      }),
      this.db.disciplineEntry.count({ where }),
    ]);
    return toPage(
      rows.map((r) => ({
        id: r.id,
        studentId: r.studentId,
        studentName: `${r.student.firstName} ${r.student.lastName}`,
        admissionNo: r.student.admissionNo,
        occurredOn: r.occurredOn,
        description: r.description,
        actionTaken: r.actionTaken,
        outcome: r.outcome,
        guardianInformedAt: r.guardianInformedAt,
      })),
      total,
      { page, perPage },
    );
  }

  // ── Visitors book ──────────────────────────────────────────────────

  async signIn(auth: AuthUser, dto: VisitorDto) {
    const row = await this.db.visitorLog.create({
      data: {
        schoolId: auth.schoolId,
        name: dto.name.trim(),
        phone: dto.phone?.trim() || null,
        organisation: dto.organisation?.trim() || null,
        purpose: dto.purpose.trim(),
        toSee: dto.toSee?.trim() || null,
        badgeNo: dto.badgeNo?.trim() || null,
        recordedById: auth.sub,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'visitor.signin', 'VisitorLog', row.id);
    return row;
  }

  async signOut(auth: AuthUser, id: string) {
    const row = await this.db.visitorLog.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!row) throw new NotFoundException('Not found');
    if (row.departedAt) return row;
    return this.db.visitorLog.update({ where: { id }, data: { departedAt: new Date() } });
  }

  async visitors(auth: AuthUser, q: ListDto) {
    const { skip, take, page, perPage } = pageArgs(q);
    const window = dateWindow(q);
    const where = { schoolId: auth.schoolId, ...(window ? { arrivedAt: window } : {}) };
    const [rows, total] = await Promise.all([
      this.db.visitorLog.findMany({ where, orderBy: { arrivedAt: 'desc' }, skip, take }),
      this.db.visitorLog.count({ where }),
    ]);
    return toPage(rows, total, { page, perPage });
  }

  /** The book, printable, for the afternoon an inspector asks for it. */
  async visitorsExport(auth: AuthUser) {
    const rows = await this.db.visitorLog.findMany({
      where: { schoolId: auth.schoolId },
      orderBy: { arrivedAt: 'asc' },
    });
    const headers = ['Arrived', 'Name', 'Organisation', 'Phone', 'To see', 'Purpose', 'Departed'];
    const body: Cell[][] = rows.map((r) => [
      r.arrivedAt.toISOString().replace('T', ' ').slice(0, 16),
      r.name,
      r.organisation ?? '',
      r.phone ?? '',
      r.toSee ?? '',
      r.purpose,
      r.departedAt ? r.departedAt.toISOString().replace('T', ' ').slice(0, 16) : 'STILL ON SITE',
    ]);
    return toCsv(headers, body);
  }

  // ── Daily feeding money ────────────────────────────────────────────

  /**
   * Take one child's feeding money for one day.
   *
   * Upserted on child-and-day, because a second collection is a correction rather than a second
   * lunch. Deliberately *not* a ledger entry: putting it on the child's account would make every
   * unpaid lunch an arrear that follows the family into next term, which is not what a school
   * means by feeding money.
   */
  async collectFeeding(auth: AuthUser, dto: FeedingDto) {
    const student = await this.db.student.findFirst({
      where: { id: dto.studentId, schoolId: auth.schoolId },
    });
    if (!student) throw new NotFoundException('Student not found');
    const on = day(dto.onDate);
    const row = await this.db.feedingRecord.upsert({
      where: { studentId_onDate: { studentId: dto.studentId, onDate: on } },
      create: {
        schoolId: auth.schoolId,
        studentId: dto.studentId,
        onDate: on,
        amount: new Prisma.Decimal(dto.amount),
        collectedById: auth.sub,
      },
      update: { amount: new Prisma.Decimal(dto.amount), collectedById: auth.sub },
    });
    return { id: row.id, amount: Number(row.amount), onDate: row.onDate };
  }

  /**
   * A day's collection for one class: who paid, who has not, and what the total should be.
   *
   * The unpaid half is the point — the person carrying the tin needs the list of names, not a
   * figure.
   */
  async feedingDay(auth: AuthUser, classId: string, onDate?: string) {
    const on = day(onDate);
    const [students, paid] = await Promise.all([
      this.db.student.findMany({
        where: { schoolId: auth.schoolId, classId, status: 'ACTIVE' },
        select: { id: true, firstName: true, lastName: true, admissionNo: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
      this.db.feedingRecord.findMany({ where: { schoolId: auth.schoolId, onDate: on } }),
    ]);
    const byStudent = new Map(paid.map((p) => [p.studentId, Number(p.amount)]));
    const rows = students.map((s) => ({
      studentId: s.id,
      name: `${s.firstName} ${s.lastName}`,
      admissionNo: s.admissionNo,
      amount: byStudent.get(s.id) ?? null,
    }));
    return {
      onDate: on,
      rows,
      collected: rows.reduce((sum, r) => sum + (r.amount ?? 0), 0),
      paidCount: rows.filter((r) => r.amount !== null).length,
      unpaidCount: rows.filter((r) => r.amount === null).length,
    };
  }
}

@Controller('registers')
export class RegistersController {
  constructor(private svc: RegistersService) {}

  @Post('logbook')
  @RequirePermission('registers.logbook')
  writeLog(@CurrentUser() user: AuthUser, @Body() dto: LogEntryDto) {
    return this.svc.writeLog(user, dto);
  }

  @Get('logbook')
  @RequirePermission('registers.logbook')
  logBook(@CurrentUser() user: AuthUser, @Query() q: ListDto) {
    return this.svc.logBook(user, q);
  }

  @Post('duty')
  @RequirePermission('registers.duty')
  setDuty(@CurrentUser() user: AuthUser, @Body() dto: DutyDto) {
    return this.svc.setDuty(user, dto);
  }

  @Get('duty')
  @RequirePermission('registers.logbook')
  duty(@CurrentUser() user: AuthUser, @Query() q: ListDto) {
    return this.svc.duty(user, q);
  }

  @Get('duty/today')
  @RequirePermission('registers.logbook')
  onDuty(@CurrentUser() user: AuthUser) {
    return this.svc.onDutyToday(user);
  }

  @Delete('duty/:id')
  @RequirePermission('registers.duty')
  removeDuty(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.removeDuty(user, id);
  }

  @Post('lesson-notes')
  @RequirePermission('registers.lesson_notes')
  submitNote(@CurrentUser() user: AuthUser, @Body() dto: LessonNoteDto) {
    return this.svc.submitNote(user, dto);
  }

  @Get('lesson-notes')
  @RequirePermission('registers.lesson_notes')
  lessonNotes(@CurrentUser() user: AuthUser, @Query() q: ListDto & { status?: string }) {
    return this.svc.lessonNotes(user, q);
  }

  @Patch('lesson-notes/:id/vet')
  @RequirePermission('registers.vet_notes')
  vetNote(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VetDto) {
    return this.svc.vetNote(user, id, dto);
  }

  @Post('discipline')
  @RequirePermission('registers.discipline')
  recordDiscipline(@CurrentUser() user: AuthUser, @Body() dto: DisciplineDto) {
    return this.svc.recordDiscipline(user, dto);
  }

  @Get('discipline')
  @RequirePermission('registers.discipline')
  discipline(@CurrentUser() user: AuthUser, @Query() q: ListDto & { studentId?: string }) {
    return this.svc.discipline(user, q);
  }

  @Post('visitors')
  @RequirePermission('registers.visitors')
  signIn(@CurrentUser() user: AuthUser, @Body() dto: VisitorDto) {
    return this.svc.signIn(user, dto);
  }

  @Patch('visitors/:id/out')
  @RequirePermission('registers.visitors')
  signOut(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.signOut(user, id);
  }

  @Get('visitors')
  @RequirePermission('registers.visitors')
  visitors(@CurrentUser() user: AuthUser, @Query() q: ListDto) {
    return this.svc.visitors(user, q);
  }

  @Get('visitors/export')
  @RequirePermission('registers.visitors')
  async visitorsExport(@CurrentUser() user: AuthUser) {
    return new StreamableFile(await this.svc.visitorsExport(user), {
      type: 'text/csv',
      disposition: 'attachment; filename="visitors-book.csv"',
    });
  }

  @Post('feeding')
  @RequirePermission('registers.feeding')
  collectFeeding(@CurrentUser() user: AuthUser, @Body() dto: FeedingDto) {
    return this.svc.collectFeeding(user, dto);
  }

  @Get('feeding')
  @RequirePermission('registers.feeding')
  feedingDay(
    @CurrentUser() user: AuthUser,
    @Query('classId') classId: string,
    @Query('onDate') onDate?: string,
  ) {
    return this.svc.feedingDay(user, classId, onDate);
  }
}

@Module({ controllers: [RegistersController], providers: [RegistersService] })
export class RegistersModule {}
