import { Body, Controller, Get, Injectable, Module, Post, Query } from '@nestjs/common';
import { IsArray, IsDateString, IsEnum, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AttendanceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hasEntitlement } from '../common/entitlements';
import { SmsModule, SmsService } from '../sms/sms.module';
import { AuthUser, CurrentUser, RequireEntitlement, RequirePermission } from '../common/auth';

class AttendanceEntryDto {
  @IsString() studentId: string;
  @IsEnum(AttendanceStatus) status: AttendanceStatus;
}

class MarkAttendanceDto {
  @IsString() classId: string;
  @IsDateString() date: string;
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
    let saved = 0;
    for (const entry of dto.entries) {
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
    });
    // Marking the register is Basic; texting guardians about it is Medium. The route itself
    // cannot be gated — every school must be able to mark attendance — so the check lives
    // here, on the alert alone.
    const alerts = hasEntitlement(auth.tier, 'comms.absence-alerts')
      ? await this.alertAbsences(auth, dto, day)
      : { alerted: 0 };
    return { saved, ...alerts };
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
        body: `${school.name}: ${st.firstName} ${st.lastName} was marked absent today (${stamp}). Please contact the school if this is unexpected.`,
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
  async trends(auth: AuthUser, termId: string) {
    const records = await this.db.attendanceRecord.findMany({
      where: { schoolId: auth.schoolId, termId },
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
    const chronic = [...byStudent.entries()]
      .filter(([, v]) => v.total >= MIN_DAYS && v.absent / v.total >= CHRONIC_RATE)
      .map(([studentId, v]) => ({
        studentId,
        ...v,
        rate: Math.round((v.absent / v.total) * 1000) / 10,
      }))
      .sort((a, b) => b.rate - a.rate);

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
      chronic,
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
  trends(@CurrentUser() user: AuthUser, @Query('termId') termId: string) {
    return this.svc.trends(user, termId);
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
