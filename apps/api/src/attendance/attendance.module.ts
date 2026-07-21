import { Body, Controller, Get, Injectable, Module, Post, Query } from '@nestjs/common';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AttendanceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isStaleReplay, parseRecordedAt } from '../common/replay';
import { hasEntitlement } from '../common/entitlements';
import { SmsModule, SmsService } from '../sms/sms.module';
import { AuthUser, CurrentUser, RequireEntitlement, RequirePermission } from '../common/auth';
import { renderMessage } from '../common/templates';
import { PageQuery, dateWindow, pageArgs, toPage } from '../common/list-query';

class AttendanceEntryDto {
  @IsString() studentId: string;
  @IsEnum(AttendanceStatus) status: AttendanceStatus;
}

/** One row of the chronic-absence list, before it is paged. */
interface ChronicRow {
  studentId: string;
  name: string;
  admissionNo: string;
  className: string;
  absent: number;
  total: number;
  rate: number;
}

/**
 * How the chronic-absence list may be ordered.
 *
 * Comparators rather than a Prisma `orderBy`, because this list has no table behind it. Chronic
 * absence is a ratio of two counts across a term, and neither `absent / total >= 0.1` nor the
 * resulting rate is a column the database can filter or sort on — the aggregation has to happen in
 * memory first, so the sort does too. It is still an allowlist for the same reason the Prisma ones
 * are: `sort` arrives off a query string, and an unchecked value would index into this object.
 */
const CHRONIC_SORTS: Record<string, (a: ChronicRow, b: ChronicRow) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  admissionNo: (a, b) => a.admissionNo.localeCompare(b.admissionNo),
  className: (a, b) => a.className.localeCompare(b.className),
  absent: (a, b) => a.absent - b.absent,
  total: (a, b) => a.total - b.total,
  rate: (a, b) => a.rate - b.rate,
};

/**
 * Filters for the term's attendance patterns. `from`/`to` narrow which marked days are counted —
 * see `trends`, where the window applies to the register's own date.
 */
class TrendsDto extends PageQuery {
  @IsString() termId: string;
  @IsOptional() @IsString() classId?: string;
}

class MarkAttendanceDto {
  @IsString() classId: string;
  @IsDateString() date: string;
  /**
   * When the teacher actually marked this, not when it reached us.
   *
   * Sent by the offline queue on replay. Without it a register marked at 09:00 and replayed at
   * 11:00 silently overwrote a correction the office made at 10:00.
   */
  @IsOptional() @IsDateString() recordedAt?: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  entries: AttendanceEntryDto[];
}

@Injectable()
export class AttendanceService {
  constructor(
    private db: PrismaService,
    private sms: SmsService,
  ) {}

  private async currentTermId(schoolId: string): Promise<string | null> {
    const term = await this.db.term.findFirst({
      where: { isCurrent: true, academicYear: { schoolId, isCurrent: true } },
    });
    return term?.id ?? null;
  }

  async roster(auth: AuthUser, classId: string, date: string) {
    const day = new Date(date);
    const [students, existing] = await Promise.all([
      this.db.student.findMany({
        where: { schoolId: auth.schoolId, classId, status: 'ACTIVE' },
        orderBy: { lastName: 'asc' },
        select: { id: true, admissionNo: true, firstName: true, lastName: true, gender: true },
      }),
      this.db.attendanceRecord.findMany({ where: { classId, date: day } }),
    ]);
    const byStudent = new Map(existing.map((r) => [r.studentId, r.status]));
    return students.map((s) => ({
      id: s.id,
      admissionNo: s.admissionNo,
      name: `${s.firstName} ${s.lastName}`,
      gender: s.gender,
      status: byStudent.get(s.id) ?? null,
    }));
  }

  async mark(auth: AuthUser, dto: MarkAttendanceDto) {
    const termId = await this.currentTermId(auth.schoolId);
    if (!termId) throw new Error('No current term configured');
    const day = new Date(dto.date);
    const recordedAt = parseRecordedAt(dto.recordedAt);

    // What the server already holds for this day, so a stale replay cannot undo a correction
    // made while the device was offline. See common/replay.ts.
    const existing = await this.db.attendanceRecord.findMany({
      where: { studentId: { in: dto.entries.map((e) => e.studentId) }, date: day },
      select: { studentId: true, updatedAt: true },
    });
    const lastTouched = new Map(existing.map((e) => [e.studentId, e.updatedAt]));

    let saved = 0;
    let superseded = 0;
    for (const entry of dto.entries) {
      if (isStaleReplay(recordedAt, lastTouched.get(entry.studentId))) {
        superseded++;
        continue;
      }
      await this.db.attendanceRecord.upsert({
        where: { studentId_date: { studentId: entry.studentId, date: day } },
        update: { status: entry.status, markedById: auth.sub },
        create: {
          schoolId: auth.schoolId,
          studentId: entry.studentId,
          classId: dto.classId,
          termId,
          date: day,
          status: entry.status,
          markedById: auth.sub,
        },
      });
      saved++;
    }
    await this.db.audit(auth.schoolId, auth.sub, 'attendance.mark', 'ClassRoom', dto.classId, {
      date: dto.date,
      count: saved,
      // Recorded so a teacher asking why their marks "did not save" has an answer on file.
      ...(superseded > 0 ? { superseded } : {}),
    });
    // Marking the register is Basic; texting guardians about it is Medium. The route itself
    // cannot be gated — every school must be able to mark attendance — so the check lives
    // here, on the alert alone.
    const alerts = hasEntitlement(auth.tier, 'comms.absence-alerts')
      ? await this.alertAbsences(auth, dto, day)
      : { alerted: 0 };
    return { saved, superseded, ...alerts };
  }

  /**
   * Tell a guardian, the same morning, that their child is not in school — the single most
   * valuable message this system sends.
   *
   * Registers get corrected (a child marked absent turns up late), so the alert is keyed to the
   * child and the day: re-marking the same register never sends twice, and a status corrected
   * away from ABSENT before the first send simply never alerts.
   */
  private async alertAbsences(auth: AuthUser, dto: MarkAttendanceDto, day: Date) {
    const absentIds = dto.entries.filter((e) => e.status === 'ABSENT').map((e) => e.studentId);
    if (absentIds.length === 0) return { alerted: 0 };

    const students = await this.db.student.findMany({
      where: { id: { in: absentIds }, schoolId: auth.schoolId },
      include: {
        guardians: {
          where: { isPrimary: true, custodyFlag: { not: 'BLOCKED' } },
          include: { guardian: { select: { phone: true } } },
        },
      },
    });
    const school = await this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } });
    const stamp = day.toISOString().slice(0, 10);

    let alerted = 0;
    for (const st of students) {
      const phone = st.guardians[0]?.guardian.phone;
      if (!phone) continue;
      const batchId = `ABS-${stamp}-${st.id}`;
      if (await this.sms.alreadySent(auth.schoolId, batchId)) continue;
      const res = await this.sms.sendToPhones({
        schoolId: auth.schoolId,
        createdById: auth.sub,
        phones: [phone],
        body: await renderMessage(this.db, auth.schoolId, 'ABSENCE_ALERT', {
          school: school.name,
          student: `${st.firstName} ${st.lastName}`,
          date: stamp,
        }),
        batchId,
      });
      alerted += res.sent;
    }
    return { alerted };
  }

  /**
   * Term-wide attendance, by class and by child. Chronic absence is what a daily register cannot
   * show: a child missing one day a week looks unremarkable every single morning.
   */
  async trends(auth: AuthUser, q: TrendsDto) {
    const { skip, take, page, perPage } = pageArgs(q);
    // The window narrows which registers are counted, not which children are listed: "how did
    // attendance look in the fortnight after half term" is the question this answers.
    const marked_on = dateWindow(q);
    const records = await this.db.attendanceRecord.findMany({
      where: {
        schoolId: auth.schoolId,
        termId: q.termId,
        ...(marked_on ? { date: marked_on } : {}),
        ...(q.classId ? { student: { classId: q.classId } } : {}),
      },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            admissionNo: true,
            classRoom: { select: { id: true, name: true } },
          },
        },
      },
    });

    const present = (st: string) => st === 'PRESENT' || st === 'LATE';
    const byClass = new Map<string, { name: string; present: number; total: number }>();
    const byStudent = new Map<
      string,
      { name: string; admissionNo: string; className: string; absent: number; total: number }
    >();

    for (const r of records) {
      const cls = r.student.classRoom;
      if (cls) {
        const c = byClass.get(cls.id) ?? { name: cls.name, present: 0, total: 0 };
        c.total++;
        if (present(r.status)) c.present++;
        byClass.set(cls.id, c);
      }
      const s = byStudent.get(r.studentId) ?? {
        name: `${r.student.firstName} ${r.student.lastName}`,
        admissionNo: r.student.admissionNo,
        className: cls?.name ?? '—',
        absent: 0,
        total: 0,
      };
      s.total++;
      if (r.status === 'ABSENT') s.absent++;
      byStudent.set(r.studentId, s);
    }

    const marked = records.length;
    const overall = marked ? records.filter((r) => present(r.status)).length / marked : 0;

    // The common definition: missing a tenth or more of sessions. Needs a meaningful sample,
    // so a child with three marked days cannot be flagged on one absence.
    const CHRONIC_RATE = 0.1;
    const MIN_DAYS = 10;
    const chronic: ChronicRow[] = [...byStudent.entries()]
      .filter(([, v]) => v.total >= MIN_DAYS && v.absent / v.total >= CHRONIC_RATE)
      .map(([studentId, v]) => ({
        studentId,
        ...v,
        rate: Math.round((v.absent / v.total) * 1000) / 10,
      }));

    // Worst first by default: this list exists to be acted on from the top, and a page of it
    // ordered by name would bury the child in most trouble somewhere in the middle.
    const asked = q.sort ? CHRONIC_SORTS[q.sort] : undefined;
    // An unrecognised `sort` falls back to the endpoint's own order rather than throwing, exactly
    // as `orderBy` does for the Prisma-backed lists — a stale bookmark should show the list.
    const compare = asked ?? CHRONIC_SORTS.rate;
    const direction = asked ? (q.order === 'desc' ? -1 : 1) : -1;
    chronic.sort((a, b) => compare(a, b) * direction);

    return {
      markedRecords: marked,
      overallRate: Math.round(overall * 1000) / 10,
      threshold: { rate: CHRONIC_RATE * 100, minDays: MIN_DAYS },
      classes: [...byClass.entries()]
        .map(([id, v]) => ({
          classId: id,
          name: v.name,
          rate: v.total ? Math.round((v.present / v.total) * 1000) / 10 : 0,
          marked: v.total,
        }))
        .sort((a, b) => a.rate - b.rate),
      /**
       * Paged, unlike the class summary above it.
       *
       * The by-class breakdown is bounded by how many classes a school has and is read whole; the
       * chronic list is a roll of children and in a large school runs to hundreds. It used to be
       * returned entire, so the page rendered every row — and a reader had no count to check the
       * table against. The envelope carries the total, so "17 children" is now stated rather than
       * inferred from how far the table scrolls.
       */
      chronic: toPage(chronic.slice(skip, skip + take), chronic.length, { page, perPage }),
    };
  }

  async summary(auth: AuthUser, date: string) {
    const day = new Date(date);
    const grouped = await this.db.attendanceRecord.groupBy({
      by: ['status'],
      where: { schoolId: auth.schoolId, date: day },
      _count: true,
    });
    const activeStudents = await this.db.student.count({
      where: { schoolId: auth.schoolId, status: 'ACTIVE' },
    });
    const counts = grouped.reduce(
      (acc, g) => ({ ...acc, [g.status]: g._count }),
      {} as Record<string, number>,
    );
    return { date, activeStudents, counts };
  }
}

@Controller('attendance')
export class AttendanceController {
  constructor(private svc: AttendanceService) {}

  @Get('roster')
  @RequirePermission('attendance.view')
  roster(
    @CurrentUser() user: AuthUser,
    @Query('classId') classId: string,
    @Query('date') date: string,
  ) {
    return this.svc.roster(user, classId, date);
  }

  // Term-wide patterns are the Medium "attendance dashboards" feature; the daily register
  // itself stays Basic.
  @Get('trends')
  @RequireEntitlement('attendance.dashboards')
  @RequirePermission('attendance.dashboards')
  trends(@CurrentUser() user: AuthUser, @Query() query: TrendsDto) {
    return this.svc.trends(user, query);
  }

  @Get('summary')
  @RequirePermission('attendance.view')
  summary(@CurrentUser() user: AuthUser, @Query('date') date: string) {
    return this.svc.summary(user, date);
  }

  @Post('mark')
  @RequirePermission('attendance.mark')
  mark(@CurrentUser() user: AuthUser, @Body() dto: MarkAttendanceDto) {
    return this.svc.mark(user, dto);
  }
}

@Module({
  imports: [SmsModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
