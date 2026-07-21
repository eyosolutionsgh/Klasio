/**
 * Mock examinations — the series a candidate class sits several of, in one term.
 *
 * A JHS3 candidate sits three to six mocks in their final year: the school's own, the district's,
 * and whatever a private provider sells. Each produces a full set of subject marks and a BECE-style
 * aggregate, and each is reported to parents in BECE terms — "aggregate 14, up from 19".
 *
 * They are deliberately not terms and not assessment components. As terms they would each need a
 * fee structure, a register and report cards. As components they would be folded into the terminal
 * report, which is exactly what a mock must not do: it is a rehearsal, not part of the year's
 * record. So a series hangs off the academic year and keeps its own marks.
 *
 * The aggregate is the same computation the outlook screen uses (common/exam-analytics.ts) —
 * four cores plus the best two electives — so a mock and a projection can never disagree about
 * what an aggregate means.
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
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequireEntitlement, RequirePermission } from '../common/auth';
import { beceProjection } from '../common/exam-analytics';
import { toCsv, Cell } from '../common/export';

class CreateSeriesDto {
  @IsString() @MinLength(2) name: string;
  @IsOptional() @IsString() academicYearId?: string;
  @IsOptional() @IsDateString() sittingOn?: string;
  @IsOptional() @IsString() classId?: string;
}

class MockMarkDto {
  @IsString() studentId: string;
  @IsNumber() @Min(0) @Max(100) total: number;
}

class SaveMockMarksDto {
  @IsString() subjectId: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MockMarkDto)
  marks: MockMarkDto[];
}

@Injectable()
export class MocksService {
  constructor(private db: PrismaService) {}

  private async currentYear(schoolId: string) {
    const year = await this.db.academicYear.findFirst({ where: { schoolId, isCurrent: true } });
    if (!year) throw new BadRequestException('No current academic year');
    return year;
  }

  async createSeries(auth: AuthUser, dto: CreateSeriesDto) {
    const yearId = dto.academicYearId ?? (await this.currentYear(auth.schoolId)).id;
    const year = await this.db.academicYear.findFirst({
      where: { id: yearId, schoolId: auth.schoolId },
    });
    if (!year) throw new NotFoundException('Academic year not found');

    const existing = await this.db.mockSeries.findFirst({
      where: { schoolId: auth.schoolId, academicYearId: yearId, name: dto.name.trim() },
    });
    if (existing) throw new BadRequestException(`${dto.name} already exists for ${year.name}`);

    const series = await this.db.mockSeries.create({
      data: {
        schoolId: auth.schoolId,
        academicYearId: yearId,
        name: dto.name.trim(),
        sittingOn: dto.sittingOn ? new Date(dto.sittingOn) : null,
        classId: dto.classId || null,
        createdById: auth.sub,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'mocks.series.create', 'MockSeries', series.id, {
      name: series.name,
    });
    return series;
  }

  async listSeries(auth: AuthUser, academicYearId?: string) {
    const rows = await this.db.mockSeries.findMany({
      where: {
        schoolId: auth.schoolId,
        ...(academicYearId ? { academicYearId } : {}),
      },
      include: {
        academicYear: { select: { name: true } },
        _count: { select: { results: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      year: r.academicYear.name,
      sittingOn: r.sittingOn,
      classId: r.classId,
      marksRecorded: r._count.results,
    }));
  }

  async deleteSeries(auth: AuthUser, id: string) {
    const series = await this.db.mockSeries.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!series) throw new NotFoundException('Series not found');
    // Cascades the marks with it: a mock nobody is keeping is not a record worth orphaning.
    await this.db.mockSeries.delete({ where: { id } });
    await this.db.audit(auth.schoolId, auth.sub, 'mocks.series.delete', 'MockSeries', id, {
      name: series.name,
    });
    return { deleted: true };
  }

  /** One subject's column for a whole class, the way marks are actually entered. */
  async saveMarks(auth: AuthUser, seriesId: string, dto: SaveMockMarksDto) {
    const [series, subject] = await Promise.all([
      this.db.mockSeries.findFirst({ where: { id: seriesId, schoolId: auth.schoolId } }),
      this.db.subject.findFirst({ where: { id: dto.subjectId, schoolId: auth.schoolId } }),
    ]);
    if (!series) throw new NotFoundException('Series not found');
    if (!subject) throw new NotFoundException('Subject not found');

    // Every id has to belong to this school, or a hand-rolled request could file a mark against
    // a child elsewhere — the same rule marks entry follows.
    const roll = await this.db.student.findMany({
      where: {
        schoolId: auth.schoolId,
        id: { in: dto.marks.map((m) => m.studentId) },
      },
      select: { id: true },
    });
    const known = new Set(roll.map((s) => s.id));
    for (const m of dto.marks) {
      if (!known.has(m.studentId)) throw new NotFoundException('That student is not on this school');
    }

    let saved = 0;
    for (const m of dto.marks) {
      await this.db.mockResult.upsert({
        where: {
          seriesId_studentId_subjectId: {
            seriesId,
            studentId: m.studentId,
            subjectId: dto.subjectId,
          },
        },
        create: {
          schoolId: auth.schoolId,
          seriesId,
          studentId: m.studentId,
          subjectId: dto.subjectId,
          total: m.total,
        },
        update: { total: m.total },
      });
      saved++;
    }
    await this.db.audit(auth.schoolId, auth.sub, 'mocks.marks.save', 'MockSeries', seriesId, {
      subjectId: dto.subjectId,
      count: saved,
    });
    return { saved };
  }

  /**
   * The series' results: every candidate with their subject grades and BECE aggregate.
   *
   * Sorted by aggregate, best first, because that is the order a school reads a mock in — and
   * candidates with too few subjects marked sort last rather than appearing to have done badly.
   */
  async results(auth: AuthUser, seriesId: string) {
    const series = await this.db.mockSeries.findFirst({
      where: { id: seriesId, schoolId: auth.schoolId },
      include: { academicYear: { select: { name: true } } },
    });
    if (!series) throw new NotFoundException('Series not found');

    const [rows, subjects] = await Promise.all([
      this.db.mockResult.findMany({
        where: { schoolId: auth.schoolId, seriesId },
        include: {
          student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
        },
      }),
      this.db.subject.findMany({ where: { schoolId: auth.schoolId } }),
    ]);
    const subjectById = new Map(subjects.map((s) => [s.id, s]));

    const byStudent = new Map<
      string,
      { name: string; admissionNo: string; marks: { subject: string; isCore: boolean; total: number }[] }
    >();
    for (const r of rows) {
      const subject = subjectById.get(r.subjectId);
      if (!subject) continue;
      const entry = byStudent.get(r.studentId) ?? {
        name: `${r.student.lastName}, ${r.student.firstName}`,
        admissionNo: r.student.admissionNo,
        marks: [],
      };
      entry.marks.push({ subject: subject.name, isCore: subject.isCore, total: r.total });
      byStudent.set(r.studentId, entry);
    }

    const candidates = [...byStudent.entries()].map(([studentId, e]) => {
      const projection = beceProjection(e.marks);
      return {
        studentId,
        name: e.name,
        admissionNo: e.admissionNo,
        aggregate: projection.aggregate,
        gap: projection.gap,
        subjects: projection.subjects,
      };
    });

    // Best aggregate first; anyone without a computable one goes to the bottom, since "no
    // aggregate" means "not enough subjects marked", not "did badly".
    candidates.sort((a, b) => {
      if (a.aggregate === null && b.aggregate === null) return a.name.localeCompare(b.name);
      if (a.aggregate === null) return 1;
      if (b.aggregate === null) return -1;
      return a.aggregate - b.aggregate;
    });

    const withAggregate = candidates.filter((c) => c.aggregate !== null);
    return {
      series: { id: series.id, name: series.name, year: series.academicYear.name, sittingOn: series.sittingOn },
      candidates,
      /** The figure a head actually quotes at a staff meeting. */
      bestAggregate: withAggregate.length ? withAggregate[0].aggregate : null,
      averageAggregate: withAggregate.length
        ? Math.round(
            (withAggregate.reduce((s, c) => s + (c.aggregate ?? 0), 0) / withAggregate.length) * 10,
          ) / 10
        : null,
      candidatesWithAggregate: withAggregate.length,
      candidatesTotal: candidates.length,
    };
  }

  /**
   * Two series side by side — what a school looks at after the second mock.
   *
   * Movement is stated as improvement rather than raw difference, because a BECE aggregate goes
   * *down* as a candidate improves, and a table of negative numbers meaning "better" is the sort
   * of thing that gets read backwards in a staff meeting.
   */
  async compare(auth: AuthUser, fromId: string, toId: string) {
    const [from, to] = await Promise.all([this.results(auth, fromId), this.results(auth, toId)]);
    const before = new Map(from.candidates.map((c) => [c.studentId, c.aggregate]));

    const rows = to.candidates.map((c) => {
      const was = before.get(c.studentId) ?? null;
      return {
        studentId: c.studentId,
        name: c.name,
        admissionNo: c.admissionNo,
        was,
        now: c.aggregate,
        improvedBy: was !== null && c.aggregate !== null ? was - c.aggregate : null,
      };
    });
    return { from: from.series, to: to.series, rows };
  }

  async exportResults(auth: AuthUser, seriesId: string) {
    const data = await this.results(auth, seriesId);
    const headers = ['Admission No', 'Candidate', 'Aggregate', 'Note', 'Subject', 'Score', 'Grade'];
    const rows: Cell[][] = [];
    for (const c of data.candidates) {
      for (const s of c.subjects) {
        rows.push([
          c.admissionNo,
          c.name,
          c.aggregate ?? '',
          c.gap ?? '',
          s.subject,
          s.total,
          s.grade,
        ]);
      }
    }
    return {
      buffer: toCsv(headers, rows),
      filename: `${data.series.name.replace(/\s+/g, '-').toLowerCase()}-results.csv`,
    };
  }
}

@Controller('mocks')
@RequirePermission('marks.view')
@RequireEntitlement('exams.analytics')
export class MocksController {
  constructor(private svc: MocksService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('academicYearId') yearId?: string) {
    return this.svc.listSeries(user, yearId);
  }

  @Post()
  @RequirePermission('assessment.configure')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSeriesDto) {
    return this.svc.createSeries(user, dto);
  }

  @Delete(':id')
  @RequirePermission('assessment.configure')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteSeries(user, id);
  }

  @Post(':id/marks')
  @RequirePermission('marks.enter')
  saveMarks(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SaveMockMarksDto,
  ) {
    return this.svc.saveMarks(user, id, dto);
  }

  @Get(':id/results')
  results(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.results(user, id);
  }

  @Get(':id/results.csv')
  async exportResults(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const file = await this.svc.exportResults(user, id);
    return new StreamableFile(file.buffer, {
      type: 'text/csv',
      disposition: `attachment; filename="${file.filename}"`,
    });
  }

  /**
   * `GET /mocks/{mock2}/compare/{mock1}` reads as "how does mock 2 compare with mock 1", so the
   * series in the path root is the later one and supplies `now`. Passing these the other way
   * round silently reported the improvement backwards.
   */
  @Get(':id/compare/:otherId')
  compare(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('otherId') otherId: string,
  ) {
    return this.svc.compare(user, otherId, id);
  }
}

@Module({ controllers: [MocksController], providers: [MocksService] })
export class MocksModule {}
