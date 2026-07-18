import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { IsArray, IsNumber, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { reportCardPdf, ReportCardData, broadsheetPdf, BroadsheetData } from '../common/pdf';
import { toCsv, toXlsx } from '../common/export';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

class ScoreEntryDto {
  @IsString() studentId: string;
  @IsString() componentId: string;
  @IsNumber() @Min(0) @Max(100) rawScore: number;
}

class SaveScoresDto {
  @IsString() termId: string;
  @IsString() subjectId: string;
  @IsString() classId: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScoreEntryDto)
  entries: ScoreEntryDto[];
}

class GenerateReportsDto {
  @IsString() classId: string;
  @IsString() termId: string;
}

interface Band {
  min: number;
  max: number;
  grade: string;
  remark: string;
}

const SBA_WEIGHT = 30;
const EXAM_WEIGHT = 70;

@Injectable()
export class AssessmentService {
  constructor(private db: PrismaService) {}

  components(auth: AuthUser) {
    return this.db.assessmentComponent.findMany({
      where: { schoolId: auth.schoolId },
      orderBy: { order: 'asc' },
    });
  }

  async scoreMatrix(auth: AuthUser, classId: string, subjectId: string, termId: string) {
    const [students, components, scores] = await Promise.all([
      this.db.student.findMany({
        where: { schoolId: auth.schoolId, classId, status: 'ACTIVE' },
        orderBy: { lastName: 'asc' },
        select: { id: true, admissionNo: true, firstName: true, lastName: true },
      }),
      this.components(auth),
      this.db.score.findMany({
        where: { schoolId: auth.schoolId, subjectId, termId, student: { classId } },
      }),
    ]);
    const byKey = new Map(scores.map((s) => [`${s.studentId}:${s.componentId}`, s.rawScore]));
    return {
      components,
      rows: students.map((st) => ({
        studentId: st.id,
        admissionNo: st.admissionNo,
        name: `${st.firstName} ${st.lastName}`,
        scores: Object.fromEntries(
          components.map((c) => [c.id, byKey.get(`${st.id}:${c.id}`) ?? null]),
        ),
      })),
    };
  }

  async saveScores(auth: AuthUser, dto: SaveScoresDto) {
    const components = await this.components(auth);
    const compById = new Map(components.map((c) => [c.id, c]));
    let saved = 0;
    for (const e of dto.entries) {
      const comp = compById.get(e.componentId);
      if (!comp) throw new BadRequestException(`Unknown component ${e.componentId}`);
      if (e.rawScore > comp.maxScore) {
        throw new BadRequestException(
          `Score ${e.rawScore} exceeds max ${comp.maxScore} for ${comp.name}`,
        );
      }
      await this.db.score.upsert({
        where: {
          studentId_subjectId_termId_componentId: {
            studentId: e.studentId,
            subjectId: dto.subjectId,
            termId: dto.termId,
            componentId: e.componentId,
          },
        },
        update: { rawScore: e.rawScore, enteredById: auth.sub },
        create: {
          schoolId: auth.schoolId,
          studentId: e.studentId,
          subjectId: dto.subjectId,
          termId: dto.termId,
          componentId: e.componentId,
          rawScore: e.rawScore,
          enteredById: auth.sub,
        },
      });
      saved++;
    }
    await this.db.audit(auth.schoolId, auth.sub, 'scores.save', 'Subject', dto.subjectId, {
      termId: dto.termId,
      count: saved,
    });
    return { saved };
  }

  /** Standard competition ranking (ties share a position) over id→total pairs, highest first. */
  private rank(entries: { id: string; total: number }[]): Map<string, number> {
    const sorted = [...entries].sort((a, b) => b.total - a.total);
    const map = new Map<string, number>();
    sorted.forEach((e, i) => {
      const pos = i > 0 && sorted[i - 1].total === e.total ? map.get(sorted[i - 1].id)! : i + 1;
      map.set(e.id, pos);
    });
    return map;
  }

  /**
   * Core class-results computation shared by report generation and the broadsheet.
   * GES/NaCCA use SBA→30, exam→70; the grading scheme (per the class's level, falling back to
   * GES) decides the grade/band label. Early-years levels are observation-scale: no exam
   * weighting, no class positions.
   */
  private async computeClassResults(auth: AuthUser, classId: string, termId: string) {
    const [classRoom, students, components, subjects, scores, term] = await Promise.all([
      this.db.classRoom.findFirst({
        where: { id: classId, schoolId: auth.schoolId },
        include: { level: { include: { gradingScheme: true } } },
      }),
      this.db.student.findMany({
        where: { schoolId: auth.schoolId, classId, status: 'ACTIVE' },
        orderBy: { lastName: 'asc' },
      }),
      this.components(auth),
      this.db.subject.findMany({
        where: { schoolId: auth.schoolId },
        orderBy: [{ isCore: 'desc' }, { name: 'asc' }],
      }),
      this.db.score.findMany({
        where: { schoolId: auth.schoolId, termId, student: { classId } },
      }),
      this.db.term.findFirst({ where: { id: termId } }),
    ]);
    if (!term) throw new NotFoundException('Term not found');
    if (!classRoom) throw new NotFoundException('Class not found');

    const scheme =
      classRoom.level.gradingScheme ??
      (await this.db.gradingScheme.findFirst({
        where: { schoolId: auth.schoolId, kind: 'GES_CLASSIC' },
      }));
    if (!scheme) throw new BadRequestException('No grading scheme configured for this level');
    const earlyYears = scheme.kind === 'EARLY_YEARS';
    const bands = scheme.bands as unknown as Band[];
    const gradeFor = (total: number) =>
      bands.find((b) => total >= b.min && total <= b.max) ?? bands[bands.length - 1];

    const sbaComponents = components.filter((c) => !c.isExam);
    const examComponent = components.find((c) => c.isExam);
    const sbaMax = sbaComponents.reduce((a, c) => a + c.maxScore, 0);
    const scoreKey = new Map(
      scores.map((s) => [`${s.studentId}:${s.subjectId}:${s.componentId}`, s.rawScore]),
    );

    // per-subject totals for every student
    type SubjectLine = {
      subjectId: string;
      subject: string;
      sba30: number;
      exam70: number;
      total: number;
    };
    const perStudent = new Map<string, SubjectLine[]>();
    for (const st of students) {
      const lines: SubjectLine[] = [];
      for (const sub of subjects) {
        let sbaRaw = 0;
        let hasAny = false;
        for (const c of sbaComponents) {
          const v = scoreKey.get(`${st.id}:${sub.id}:${c.id}`);
          if (v != null) {
            sbaRaw += v;
            hasAny = true;
          }
        }
        const examRaw = examComponent
          ? scoreKey.get(`${st.id}:${sub.id}:${examComponent.id}`)
          : undefined;
        if (!hasAny && examRaw == null) continue;
        // Early-years: total is a straight percentage of the observation components (no 30/70 split).
        const sba30 = earlyYears
          ? sbaMax > 0
            ? (sbaRaw / sbaMax) * 100
            : 0
          : sbaMax > 0
            ? (sbaRaw / sbaMax) * SBA_WEIGHT
            : 0;
        const exam70 =
          earlyYears || !examComponent || examRaw == null
            ? 0
            : (examRaw / examComponent.maxScore) * EXAM_WEIGHT;
        lines.push({
          subjectId: sub.id,
          subject: sub.name,
          sba30: Math.round(sba30 * 10) / 10,
          exam70: Math.round(exam70 * 10) / 10,
          total: Math.round((earlyYears ? sba30 : sba30 + exam70) * 10) / 10,
        });
      }
      perStudent.set(st.id, lines);
    }

    // subject positions across the class
    const subjectRanks = new Map<string, Map<string, number>>(); // subjectId -> studentId -> position
    for (const sub of subjects) {
      const entries = students
        .map((st) => ({
          id: st.id,
          total: perStudent.get(st.id)?.find((l) => l.subjectId === sub.id)?.total,
        }))
        .filter((e): e is { id: string; total: number } => e.total != null);
      subjectRanks.set(sub.id, this.rank(entries));
    }

    // overall class position
    const overall = students
      .map((st) => ({
        id: st.id,
        total: Math.round((perStudent.get(st.id) ?? []).reduce((a, l) => a + l.total, 0) * 10) / 10,
      }))
      .sort((a, b) => b.total - a.total);
    const overallRank = this.rank(overall);

    return {
      classRoom,
      term,
      students,
      subjects,
      scheme,
      earlyYears,
      gradeFor,
      perStudent,
      subjectRanks,
      overall,
      overallRank,
    };
  }

  /** Compute and persist terminal reports for a class+term. */
  async generateReports(auth: AuthUser, dto: GenerateReportsDto) {
    const { students, earlyYears, gradeFor, perStudent, subjectRanks, overall, overallRank } =
      await this.computeClassResults(auth, dto.classId, dto.termId);

    // attendance
    const attendance = await this.db.attendanceRecord.groupBy({
      by: ['studentId', 'status'],
      where: { schoolId: auth.schoolId, termId: dto.termId, student: { classId: dto.classId } },
      _count: true,
    });
    const attTotals = new Map<string, { present: number; total: number }>();
    for (const a of attendance) {
      const cur = attTotals.get(a.studentId) ?? { present: 0, total: 0 };
      cur.total += a._count;
      if (a.status === 'PRESENT' || a.status === 'LATE') cur.present += a._count;
      attTotals.set(a.studentId, cur);
    }

    let generated = 0;
    for (const st of students) {
      const lines = (perStudent.get(st.id) ?? []).map((l) => {
        const g = gradeFor(l.total);
        return {
          ...l,
          grade: g.grade,
          remark: g.remark,
          position: earlyYears ? null : (subjectRanks.get(l.subjectId)?.get(st.id) ?? null),
        };
      });
      if (lines.length === 0) continue;
      const att = attTotals.get(st.id) ?? { present: 0, total: 0 };
      await this.db.termReport.upsert({
        where: { studentId_termId: { studentId: st.id, termId: dto.termId } },
        update: {
          lines,
          overallTotal: overall.find((o) => o.id === st.id)?.total ?? 0,
          classPosition: earlyYears ? null : (overallRank.get(st.id) ?? null),
          classSize: students.length,
          attendancePresent: att.present,
          attendanceTotal: att.total,
          generatedAt: new Date(),
        },
        create: {
          schoolId: auth.schoolId,
          studentId: st.id,
          termId: dto.termId,
          classId: dto.classId,
          lines,
          overallTotal: overall.find((o) => o.id === st.id)?.total ?? 0,
          classPosition: earlyYears ? null : (overallRank.get(st.id) ?? null),
          classSize: students.length,
          attendancePresent: att.present,
          attendanceTotal: att.total,
        },
      });
      generated++;
    }
    await this.db.audit(auth.schoolId, auth.sub, 'reports.generate', 'ClassRoom', dto.classId, {
      termId: dto.termId,
      generated,
    });
    return { generated, classSize: students.length };
  }

  async listReports(auth: AuthUser, classId: string, termId: string) {
    const reports = await this.db.termReport.findMany({
      where: { schoolId: auth.schoolId, classId, termId },
      include: { student: { select: { firstName: true, lastName: true, admissionNo: true } } },
      orderBy: { classPosition: 'asc' },
    });
    return reports.map((r) => ({
      studentId: r.studentId,
      name: `${r.student.firstName} ${r.student.lastName}`,
      admissionNo: r.student.admissionNo,
      overallTotal: r.overallTotal,
      classPosition: r.classPosition,
      classSize: r.classSize,
      publishedAt: r.publishedAt,
    }));
  }

  async reportCard(auth: AuthUser, studentId: string, termId: string) {
    const report = await this.db.termReport.findFirst({
      where: { schoolId: auth.schoolId, studentId, termId },
      include: {
        student: {
          include: { classRoom: { include: { level: { include: { gradingScheme: true } } } } },
        },
      },
    });
    if (!report) throw new NotFoundException('Report not generated yet');
    const scheme =
      report.student.classRoom?.level.gradingScheme ??
      (await this.db.gradingScheme.findFirst({
        where: { schoolId: auth.schoolId, kind: 'GES_CLASSIC' },
      }));
    const term = await this.db.term.findFirst({
      where: { id: termId },
      include: { academicYear: { select: { name: true } } },
    });
    const school = await this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } });
    return {
      schemeKind: scheme?.kind ?? 'GES_CLASSIC',
      schemeName: scheme?.name ?? 'GES Classic',
      school: {
        name: school.name,
        motto: school.motto,
        address: school.address,
        phone: school.phone,
      },
      student: {
        name: `${report.student.firstName} ${report.student.lastName}`,
        admissionNo: report.student.admissionNo,
        className: report.student.classRoom?.name,
        gender: report.student.gender,
      },
      term: {
        name: term?.name,
        year: term?.academicYear.name,
        nextTermBegins: term?.nextTermBegins,
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
      generatedAt: report.generatedAt,
    };
  }

  async reportCardPdf(auth: AuthUser, studentId: string, termId: string) {
    const card = await this.reportCard(auth, studentId, termId);
    return reportCardPdf(card as unknown as ReportCardData);
  }

  /** Broadsheet / tabulation sheet: students × subjects with totals, positions and class ranking. */
  async broadsheet(auth: AuthUser, classId: string, termId: string): Promise<BroadsheetData> {
    const r = await this.computeClassResults(auth, classId, termId);
    const school = await this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } });
    const rows = r.students
      .map((st) => {
        const lines = r.perStudent.get(st.id) ?? [];
        return {
          admissionNo: st.admissionNo,
          name: `${st.firstName} ${st.lastName}`,
          cells: r.subjects.map((sub) => ({
            total: lines.find((l) => l.subjectId === sub.id)?.total ?? null,
          })),
          overallTotal: r.overall.find((o) => o.id === st.id)?.total ?? 0,
          position: r.earlyYears ? null : (r.overallRank.get(st.id) ?? null),
        };
      })
      .sort(
        (a, b) => (a.position ?? 9999) - (b.position ?? 9999) || b.overallTotal - a.overallTotal,
      );
    return {
      schoolName: school.name,
      className: r.classRoom.name,
      termName: r.term.name,
      earlyYears: r.earlyYears,
      subjects: r.subjects.map((s) => ({ id: s.id, name: s.name, code: s.code })),
      rows,
    };
  }

  /** Broadsheet as a downloadable file in the requested format. */
  async broadsheetFile(auth: AuthUser, classId: string, termId: string, format: string) {
    const data = await this.broadsheet(auth, classId, termId);
    const base = `broadsheet-${data.className}-${data.termName ?? ''}`
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '');
    const headers = ['Adm. No.', 'Name', ...data.subjects.map((s) => s.name), 'Total', 'Position'];
    const tableRows = data.rows.map((row) => [
      row.admissionNo,
      row.name,
      ...row.cells.map((c) => c.total ?? ''),
      row.overallTotal,
      row.position ?? '',
    ]);
    if (format === 'csv') {
      return { buffer: toCsv(headers, tableRows), type: 'text/csv', filename: `${base}.csv` };
    }
    if (format === 'xlsx') {
      return {
        buffer: await toXlsx('Broadsheet', headers, tableRows),
        type: XLSX_MIME,
        filename: `${base}.xlsx`,
      };
    }
    if (format === 'pdf') {
      return {
        buffer: await broadsheetPdf(data),
        type: 'application/pdf',
        filename: `${base}.pdf`,
      };
    }
    throw new BadRequestException('format must be csv, xlsx or pdf');
  }
}

@Controller('assessment')
export class AssessmentController {
  constructor(private svc: AssessmentService) {}

  @Get('components')
  components(@CurrentUser() user: AuthUser) {
    return this.svc.components(user);
  }

  @Get('scores')
  scores(
    @CurrentUser() user: AuthUser,
    @Query('classId') classId: string,
    @Query('subjectId') subjectId: string,
    @Query('termId') termId: string,
  ) {
    return this.svc.scoreMatrix(user, classId, subjectId, termId);
  }

  @Post('scores')
  @Roles('OWNER', 'HEAD', 'TEACHER')
  saveScores(@CurrentUser() user: AuthUser, @Body() dto: SaveScoresDto) {
    return this.svc.saveScores(user, dto);
  }

  @Post('reports/generate')
  @Roles('OWNER', 'HEAD', 'TEACHER')
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateReportsDto) {
    return this.svc.generateReports(user, dto);
  }

  @Get('reports')
  list(
    @CurrentUser() user: AuthUser,
    @Query('classId') classId: string,
    @Query('termId') termId: string,
  ) {
    return this.svc.listReports(user, classId, termId);
  }

  @Get('reports/:studentId/:termId')
  card(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Param('termId') termId: string,
  ) {
    return this.svc.reportCard(user, studentId, termId);
  }

  @Get('broadsheet')
  broadsheet(
    @CurrentUser() user: AuthUser,
    @Query('classId') classId: string,
    @Query('termId') termId: string,
  ) {
    return this.svc.broadsheet(user, classId, termId);
  }

  @Get('broadsheet/export')
  async broadsheetExport(
    @CurrentUser() user: AuthUser,
    @Query('classId') classId: string,
    @Query('termId') termId: string,
    @Query('format') format = 'xlsx',
  ) {
    const { buffer, type, filename } = await this.svc.broadsheetFile(user, classId, termId, format);
    return new StreamableFile(buffer, {
      type,
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get('reports/:studentId/:termId/pdf')
  async cardPdf(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Param('termId') termId: string,
  ) {
    const buf = await this.svc.reportCardPdf(user, studentId, termId);
    return new StreamableFile(buf, {
      type: 'application/pdf',
      disposition: `attachment; filename="report-${studentId}-${termId}.pdf"`,
    });
  }
}

@Module({ controllers: [AssessmentController], providers: [AssessmentService] })
export class AssessmentModule {}
