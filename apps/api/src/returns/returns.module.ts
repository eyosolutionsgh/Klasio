import {
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequireEntitlement, RequirePermission } from '../common/auth';
import { toCsv, toXlsx, type Cell } from '../common/export';

/**
 * Termly statutory returns (docs/02 §2.10).
 *
 * Ghana Education Service and NaSIA both want the same handful of counts each term, and every
 * private school assembles them by hand from a register the day before they are due. Everything
 * here is derived from records the school already keeps — nothing is entered twice.
 *
 * Counts are computed, never stored. A return filed in March and re-run in June must reflect the
 * roll as it is now; caching it would quietly file stale numbers.
 */

interface LevelRow {
  level: string;
  category: string;
  male: number;
  female: number;
  total: number;
}

@Injectable()
export class ReturnsService {
  constructor(private db: PrismaService) {}

  private async term(auth: AuthUser, termId?: string) {
    const term = termId
      ? await this.db.term.findFirst({
          where: { id: termId, academicYear: { schoolId: auth.schoolId } },
          include: { academicYear: true },
        })
      : await this.db.term.findFirst({
          where: { isCurrent: true, academicYear: { schoolId: auth.schoolId, isCurrent: true } },
          include: { academicYear: true },
        });
    if (!term) throw new NotFoundException('No term selected and no current term set');
    return term;
  }

  /**
   * Enrolment by level and sex, staffing, attendance and results — the four blocks both
   * regulators ask for.
   */
  async summary(auth: AuthUser, termId?: string) {
    const term = await this.term(auth, termId);
    const school = await this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } });

    const levels = await this.db.level.findMany({
      where: { schoolId: auth.schoolId },
      orderBy: { order: 'asc' },
      include: { classes: { select: { id: true } } },
    });

    // Only ACTIVE pupils count toward a return. A withdrawn or graduated child is still on file
    // and would inflate the roll — the number a regulator is checking is who is in class now.
    const students = await this.db.student.findMany({
      where: { schoolId: auth.schoolId, status: 'ACTIVE' },
      select: { id: true, gender: true, classId: true },
    });

    const classToLevel = new Map<string, string>();
    for (const l of levels) for (const c of l.classes) classToLevel.set(c.id, l.id);

    const rows: LevelRow[] = levels.map((l) => {
      const inLevel = students.filter((s) => s.classId && classToLevel.get(s.classId) === l.id);
      const male = inLevel.filter((s) => s.gender === 'MALE').length;
      const female = inLevel.filter((s) => s.gender === 'FEMALE').length;
      return {
        level: l.name,
        category: l.category,
        male,
        female,
        // Not male + female: a record with no sex recorded still belongs on the roll, and
        // dropping it would make the totals disagree with the register.
        total: inLevel.length,
      };
    });

    const staff = await this.db.user.groupBy({
      by: ['role'],
      where: { schoolId: auth.schoolId, active: true },
      _count: { _all: true },
    });

    const attendance = await this.db.attendanceRecord.groupBy({
      by: ['status'],
      where: {
        schoolId: auth.schoolId,
        date: { gte: term.startDate, lte: term.endDate },
      },
      _count: { _all: true },
    });
    const attTotal = attendance.reduce((a, r) => a + r._count._all, 0);
    const present = attendance
      .filter((r) => r.status === 'PRESENT' || r.status === 'LATE')
      .reduce((a, r) => a + r._count._all, 0);

    const reports = await this.db.termReport.findMany({
      where: { schoolId: auth.schoolId, termId: term.id },
      select: { overallTotal: true, lines: true },
    });
    const averages = reports
      .map((r) => {
        const lines = Array.isArray(r.lines) ? (r.lines as unknown[]) : [];
        return lines.length > 0 ? Number(r.overallTotal) / lines.length : null;
      })
      .filter((n): n is number => n !== null);

    const round1 = (n: number) => Math.round(n * 10) / 10;

    return {
      school: {
        name: school.name,
        address: school.address,
        phone: school.phone,
        email: school.email,
        region: school.region,
        country: school.country,
      },
      term: { id: term.id, name: term.name, year: term.academicYear.name },
      enrolment: {
        byLevel: rows,
        male: rows.reduce((a, r) => a + r.male, 0),
        female: rows.reduce((a, r) => a + r.female, 0),
        total: rows.reduce((a, r) => a + r.total, 0),
      },
      staffing: {
        byRole: staff.map((s) => ({ role: s.role, count: s._count._all })),
        total: staff.reduce((a, s) => a + s._count._all, 0),
      },
      attendance: {
        markedDays: attTotal,
        presentRate: attTotal > 0 ? round1((present / attTotal) * 100) : null,
      },
      results: {
        reportsIssued: reports.length,
        averageScore:
          averages.length > 0
            ? round1(averages.reduce((a, n) => a + n, 0) / averages.length)
            : null,
      },
      generatedAt: new Date(),
    };
  }

  /**
   * The same figures as a file to attach to a submission.
   *
   * A flat sheet on purpose: the officer receiving it re-keys into their own template, and
   * nested blocks make that harder rather than easier.
   */
  async export(auth: AuthUser, format: 'csv' | 'xlsx', termId?: string) {
    const s = await this.summary(auth, termId);
    const headers = ['Section', 'Item', 'Detail', 'Male', 'Female', 'Total'];
    const rows: Cell[][] = [
      ...s.enrolment.byLevel.map((r) => [
        'Enrolment',
        r.level,
        r.category,
        r.male,
        r.female,
        r.total,
      ]),
      ['Enrolment', 'TOTAL', '', s.enrolment.male, s.enrolment.female, s.enrolment.total],
      ...s.staffing.byRole.map((r) => ['Staffing', r.role, '', '', '', r.count]),
      [
        'Attendance',
        'Attendance rate (%)',
        `${s.attendance.markedDays} records`,
        '',
        '',
        s.attendance.presentRate ?? '',
      ],
      [
        'Results',
        'Average score',
        `${s.results.reportsIssued} reports`,
        '',
        '',
        s.results.averageScore ?? '',
      ],
    ];

    const name = `returns-${s.term.year.replace(/\//g, '-')}-${s.term.name.replace(/\s+/g, '')}`;
    return format === 'csv'
      ? { buffer: toCsv(headers, rows), filename: `${name}.csv`, type: 'text/csv' }
      : {
          buffer: await toXlsx('Termly return', headers, rows),
          filename: `${name}.xlsx`,
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        };
  }
}

@Controller('returns')
@RequirePermission('returns.view')
@RequireEntitlement('platform.ges-returns')
export class ReturnsController {
  constructor(private svc: ReturnsService) {}

  @Get()
  summary(@CurrentUser() user: AuthUser, @Query('termId') termId?: string) {
    return this.svc.summary(user, termId);
  }

  @Get('export')
  async export(
    @CurrentUser() user: AuthUser,
    @Query('format') format: 'csv' | 'xlsx' = 'xlsx',
    @Query('termId') termId?: string,
  ) {
    const file = await this.svc.export(user, format === 'csv' ? 'csv' : 'xlsx', termId);
    return new StreamableFile(file.buffer, {
      type: file.type,
      disposition: `attachment; filename="${file.filename}"`,
    });
  }
}

@Module({ controllers: [ReturnsController], providers: [ReturnsService] })
export class ReturnsModule {}
