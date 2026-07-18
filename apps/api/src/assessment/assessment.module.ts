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
import { Prisma } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { GradingKind } from '@prisma/client';
import { Band, validateBands } from '../common/grading';
import { Type } from 'class-transformer';
import { storage } from '../common/storage';
import { SmsModule, SmsService } from '../sms/sms.module';
import { weighSubject } from '../common/weighting';
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

class UpdateReportDto {
  @IsOptional() @IsString() @MaxLength(500) teacherRemark?: string;
  @IsOptional() @IsString() @MaxLength(500) headRemark?: string;
  @IsOptional() @IsString() @MaxLength(120) conduct?: string;
  @IsOptional() @IsString() @MaxLength(120) interest?: string;
}

class ComponentDto {
  @IsString() @MinLength(2) name: string;
  @IsNumber() @Min(1) @Max(100) maxScore: number;
  @IsOptional() @IsIn(['CONTINUOUS', 'EXAM']) category?: 'CONTINUOUS' | 'EXAM';
  /** Null/omitted means every subject. */
  @IsOptional() @IsString() subjectId?: string;
  /** Null/omitted means every level. */
  @IsOptional() @IsString() levelId?: string;
  @IsOptional() @IsNumber() order?: number;
}

class GradingSchemeDto {
  @IsString() @MinLength(2) name: string;
  @IsIn(['GES_CLASSIC', 'NACCA_BANDS', 'EARLY_YEARS']) kind: GradingKind;
  @IsArray() bands: Band[];
}

class PublishReportsDto {
  @IsString() classId: string;
  @IsString() termId: string;
  /** false un-publishes (e.g. a mistake spotted after release). */
  @IsOptional() @IsBoolean() published?: boolean;
}

/** Fallbacks when a school has not set its own; the GES convention. */
const DEFAULT_SBA_WEIGHT = 30;
const DEFAULT_EXAM_WEIGHT = 70;

@Injectable()
export class AssessmentService {
  constructor(
    private db: PrismaService,
    private sms: SmsService,
  ) {}

  components(auth: AuthUser, subjectId?: string, levelId?: string) {
    return this.db.assessmentComponent.findMany({
      where: {
        schoolId: auth.schoolId,
        ...(subjectId ? { OR: [{ subjectId }, { subjectId: null }] } : {}),
        ...(levelId ? { AND: [{ OR: [{ levelId }, { levelId: null }] }] } : {}),
      },
      // Continuous work runs through the term and the exam closes it, so exams read last on the
      // sheet and the report card however late a component was added. Postgres sorts an enum by
      // its declared order, and AssessmentCategory declares CONTINUOUS before EXAM.
      orderBy: [{ category: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * The components that apply to one subject in one class: the school-wide ones plus anything
   * narrowed to this subject and/or this level. Marks entry and report generation both resolve
   * through here so a column can never appear in one and not the other.
   */
  async componentsFor(auth: AuthUser, subjectId: string, levelId: string | null) {
    return this.db.assessmentComponent.findMany({
      where: {
        schoolId: auth.schoolId,
        OR: [{ subjectId: null }, { subjectId }],
        AND: [{ OR: [{ levelId: null }, ...(levelId ? [{ levelId }] : [])] }],
      },
      // Continuous work runs through the term and the exam closes it, so exams read last on the
      // sheet and the report card however late a component was added. Postgres sorts an enum by
      // its declared order, and AssessmentCategory declares CONTINUOUS before EXAM.
      orderBy: [{ category: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  // ── Configuration: SBA components & grading schemes ────────────────

  async createComponent(auth: AuthUser, dto: ComponentDto) {
    // A teacher may add assessments for a subject they are marking, which is the whole point of
    // this being flexible. Adding one to *every* subject changes every report card in the
    // school, so that stays with the head.
    if (auth.role === 'TEACHER' && !dto.subjectId) {
      throw new BadRequestException(
        'Choose a subject for this assessment — only a head can add one to every subject',
      );
    }
    // Any number of each category is fine — three tests and two papers is a normal term.
    const count = await this.db.assessmentComponent.count({ where: { schoolId: auth.schoolId } });
    const component = await this.db.assessmentComponent.create({
      data: {
        schoolId: auth.schoolId,
        name: dto.name,
        maxScore: dto.maxScore,
        category: dto.category ?? 'CONTINUOUS',
        subjectId: dto.subjectId ?? null,
        levelId: dto.levelId ?? null,
        order: dto.order ?? count + 1,
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'assessment.component.create',
      'AssessmentComponent',
      component.id,
      { name: dto.name },
    );
    return component;
  }

  async updateComponent(auth: AuthUser, id: string, dto: Partial<ComponentDto>) {
    const existing = await this.db.assessmentComponent.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!existing) throw new NotFoundException('Component not found');
    const component = await this.db.assessmentComponent.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.maxScore !== undefined ? { maxScore: dto.maxScore } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.subjectId !== undefined ? { subjectId: dto.subjectId || null } : {}),
        ...(dto.levelId !== undefined ? { levelId: dto.levelId || null } : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'assessment.component.update',
      'AssessmentComponent',
      id,
      dto,
    );
    return component;
  }

  async deleteComponent(auth: AuthUser, id: string) {
    const existing = await this.db.assessmentComponent.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!existing) throw new NotFoundException('Component not found');
    const scores = await this.db.score.count({ where: { componentId: id } });
    if (scores > 0) {
      throw new BadRequestException(
        'Marks have already been entered against this component — it cannot be deleted',
      );
    }
    await this.db.assessmentComponent.delete({ where: { id } });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'assessment.component.delete',
      'AssessmentComponent',
      id,
    );
    return { deleted: true };
  }

  schemes(auth: AuthUser) {
    return this.db.gradingScheme.findMany({
      where: { schoolId: auth.schoolId },
      orderBy: { name: 'asc' },
    });
  }

  async createScheme(auth: AuthUser, dto: GradingSchemeDto) {
    const check = validateBands(dto.bands);
    if (!check.ok) throw new BadRequestException(check.error);
    const scheme = await this.db.gradingScheme.create({
      data: {
        schoolId: auth.schoolId,
        name: dto.name,
        kind: dto.kind,
        bands: dto.bands as unknown as Prisma.InputJsonValue,
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'assessment.scheme.create',
      'GradingScheme',
      scheme.id,
      { name: dto.name, kind: dto.kind },
    );
    return scheme;
  }

  async updateScheme(auth: AuthUser, id: string, dto: Partial<GradingSchemeDto>) {
    const existing = await this.db.gradingScheme.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!existing) throw new NotFoundException('Grading scheme not found');
    if (dto.bands) {
      const check = validateBands(dto.bands);
      if (!check.ok) throw new BadRequestException(check.error);
    }
    const scheme = await this.db.gradingScheme.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.bands !== undefined
          ? { bands: dto.bands as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'assessment.scheme.update', 'GradingScheme', id, {
      name: dto.name,
    });
    return scheme;
  }

  async deleteScheme(auth: AuthUser, id: string) {
    const existing = await this.db.gradingScheme.findFirst({
      where: { id, schoolId: auth.schoolId },
      include: { _count: { select: { levels: true } } },
    });
    if (!existing) throw new NotFoundException('Grading scheme not found');
    if (existing._count.levels > 0) {
      throw new BadRequestException('This scheme is assigned to a level — reassign it first');
    }
    await this.db.gradingScheme.delete({ where: { id } });
    await this.db.audit(auth.schoolId, auth.sub, 'assessment.scheme.delete', 'GradingScheme', id);
    return { deleted: true };
  }

  async scoreMatrix(auth: AuthUser, classId: string, subjectId: string, termId: string) {
    const classRoom = await this.db.classRoom.findFirst({
      where: { id: classId, schoolId: auth.schoolId },
      select: { levelId: true },
    });
    const [students, components, scores] = await Promise.all([
      this.db.student.findMany({
        where: { schoolId: auth.schoolId, classId, status: 'ACTIVE' },
        orderBy: { lastName: 'asc' },
        select: { id: true, admissionNo: true, firstName: true, lastName: true },
      }),
      // Only the columns that apply here — school-wide ones plus anything scoped to this
      // subject or level. Report generation resolves the same way.
      this.componentsFor(auth, subjectId, classRoom?.levelId ?? null),
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

    const school = await this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } });
    const sbaWeight = school.sbaWeight ?? DEFAULT_SBA_WEIGHT;
    const examWeight = school.examWeight ?? DEFAULT_EXAM_WEIGHT;

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

    // Components can be scoped to a subject, so the split is worked out per subject rather than
    // once for the class. Any number of each category is allowed; each half is the sum of its
    // components scaled to the school's weight.
    const bySubject = (subjectId: string) =>
      components.filter((c) => c.subjectId === null || c.subjectId === subjectId);
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
        const applicable = bySubject(sub.id);
        const sbaComponents = applicable.filter((c) => c.category === 'CONTINUOUS');
        const examComponents = applicable.filter((c) => c.category === 'EXAM');

        // Only assessments that carry a mark are collected. An unmarked one must not arrive as
        // a zero — mid-term most of the work does not exist yet, and a zero would report a
        // child as failing when they have simply not sat the paper.
        const marked = (of: typeof applicable) =>
          of.flatMap((c) => {
            const v = scoreKey.get(`${st.id}:${sub.id}:${c.id}`);
            return v == null ? [] : [{ raw: v, max: c.maxScore }];
          });

        const weighed = weighSubject(marked(sbaComponents), marked(examComponents), {
          sbaWeight,
          examWeight,
          earlyYears,
        });
        if (!weighed) continue; // nothing marked in this subject — leave it off the report
        lines.push({
          subjectId: sub.id,
          subject: sub.name,
          sba30: weighed.sba,
          exam70: weighed.exam,
          total: weighed.total,
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

  /**
   * Record the human parts of a terminal report: conduct, interest and the two remarks.
   * The head teacher's remark is reserved for HEAD/OWNER — a class teacher must not be able
   * to put words in the head's mouth on a document that goes home to guardians.
   */
  async updateReport(auth: AuthUser, studentId: string, termId: string, dto: UpdateReportDto) {
    const report = await this.db.termReport.findFirst({
      where: { schoolId: auth.schoolId, studentId, termId },
    });
    if (!report) throw new NotFoundException('Report not generated yet');
    if (dto.headRemark !== undefined && !['OWNER', 'HEAD'].includes(auth.role)) {
      throw new ForbiddenException("Only the head teacher can write the head teacher's remark");
    }
    if (report.publishedAt) {
      throw new BadRequestException('This report is published — unpublish it before editing');
    }

    const data: Prisma.TermReportUpdateInput = {};
    if (dto.teacherRemark !== undefined) data.teacherRemark = dto.teacherRemark || null;
    if (dto.headRemark !== undefined) data.headRemark = dto.headRemark || null;
    if (dto.conduct !== undefined) data.conduct = dto.conduct || null;
    if (dto.interest !== undefined) data.interest = dto.interest || null;
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to update');

    const updated = await this.db.termReport.update({ where: { id: report.id }, data });
    await this.db.audit(auth.schoolId, auth.sub, 'report.remarks', 'TermReport', report.id, {
      fields: Object.keys(data),
    });
    return {
      studentId,
      termId,
      conduct: updated.conduct,
      interest: updated.interest,
      teacherRemark: updated.teacherRemark,
      headRemark: updated.headRemark,
    };
  }

  /** Publish (or retract) a whole class's reports for a term. Guardians only ever see published ones. */
  async publishReports(auth: AuthUser, dto: PublishReportsDto) {
    const publish = dto.published !== false;
    const result = await this.db.termReport.updateMany({
      where: { schoolId: auth.schoolId, classId: dto.classId, termId: dto.termId },
      data: { publishedAt: publish ? new Date() : null },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      publish ? 'reports.publish' : 'reports.unpublish',
      'ClassRoom',
      dto.classId,
      { termId: dto.termId, count: result.count },
    );
    // Publishing is the moment results become real to a family, so it is worth a message.
    // Retracting is not — it is usually a mistake being fixed, and announcing it twice is worse.
    const already = await this.sms.alreadySent(
      auth.schoolId,
      `RESULTS-${dto.classId}-${dto.termId}`,
    );
    const notified =
      publish && result.count > 0 && !already ? await this.notifyResults(auth, dto) : 0;
    return { published: publish, count: result.count, notified };
  }

  /** One SMS per guardian of the class, pointing at the parent portal rather than carrying marks. */
  private async notifyResults(auth: AuthUser, dto: PublishReportsDto) {
    const [students, school, term] = await Promise.all([
      this.db.student.findMany({
        where: { schoolId: auth.schoolId, classId: dto.classId, status: 'ACTIVE' },
        include: {
          guardians: {
            where: { isPrimary: true, custodyFlag: { not: 'BLOCKED' } },
            include: { guardian: { select: { phone: true } } },
          },
        },
      }),
      this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } }),
      this.db.term.findUnique({ where: { id: dto.termId } }),
    ]);
    const phones = students
      .map((s) => s.guardians[0]?.guardian.phone)
      .filter((p): p is string => !!p);
    if (phones.length === 0) return 0;

    const res = await this.sms.sendToPhones({
      schoolId: auth.schoolId,
      createdById: auth.sub,
      phones,
      body: `${school.name}: ${term?.name ?? 'This term'} report cards are now available. Sign in at the parent portal with your phone number to view your child's results.`,
      // Re-publishing the same class and term does not message everyone again.
      batchId: `RESULTS-${dto.classId}-${dto.termId}`,
    });
    return res.sent;
  }

  /**
   * A student's whole academic record, earliest term first — the cumulative record card a
   * Ghanaian school keeps from the day a child arrives to the day they leave.
   *
   * Built from the persisted TermReports rather than recomputed, so it shows what was actually
   * issued at the time: a child who moved class or whose scheme changed still reads truthfully.
   */
  async cumulative(auth: AuthUser, studentId: string) {
    const student = await this.db.student.findFirst({
      where: { id: studentId, schoolId: auth.schoolId },
      include: { classRoom: { select: { name: true } } },
    });
    if (!student) throw new NotFoundException('Student not found');

    const reports = await this.db.termReport.findMany({
      where: { schoolId: auth.schoolId, studentId },
    });
    const [terms, classes] = await Promise.all([
      this.db.term.findMany({
        where: { id: { in: reports.map((r) => r.termId) } },
        include: { academicYear: { select: { name: true, startDate: true } } },
      }),
      this.db.classRoom.findMany({ where: { id: { in: reports.map((r) => r.classId) } } }),
    ]);
    const termById = new Map(terms.map((t) => [t.id, t]));
    const classById = new Map(classes.map((c) => [c.id, c]));

    const rows = reports
      .map((r) => {
        const term = termById.get(r.termId);
        const lines = (r.lines ?? []) as unknown as { subject: string; total: number }[];
        const subjects = Array.isArray(lines) ? lines.length : 0;
        const overall = Number(r.overallTotal);
        return {
          termId: r.termId,
          term: term?.name ?? '',
          year: term?.academicYear.name ?? '',
          startDate: term?.startDate ?? new Date(0),
          className: classById.get(r.classId)?.name ?? '—',
          subjects,
          overallTotal: Math.round(overall * 10) / 10,
          // Average across subjects is the comparable figure: a term with nine subjects and one
          // with six are not comparable on the raw total.
          average: subjects ? Math.round((overall / subjects) * 10) / 10 : 0,
          classPosition: r.classPosition,
          classSize: r.classSize,
          attendancePresent: r.attendancePresent,
          attendanceTotal: r.attendanceTotal,
          published: !!r.publishedAt,
        };
      })
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    const withAverage = rows.filter((r) => r.subjects > 0);
    const cumulativeAverage = withAverage.length
      ? Math.round((withAverage.reduce((sum, r) => sum + r.average, 0) / withAverage.length) * 10) /
        10
      : 0;
    // Compare the most recent term with the one before it, which is the question a parent asks.
    const trend =
      withAverage.length >= 2
        ? Math.round(
            (withAverage[withAverage.length - 1].average -
              withAverage[withAverage.length - 2].average) *
              10,
          ) / 10
        : null;

    return {
      student: {
        id: student.id,
        name: `${student.firstName} ${student.lastName}`,
        admissionNo: student.admissionNo,
        className: student.classRoom?.name ?? null,
        enrolledAt: student.enrolledAt,
      },
      terms: rows.map(({ startDate: _s, ...rest }) => rest),
      cumulativeAverage,
      trend,
      termsRecorded: rows.length,
      classesAttended: [...new Set(rows.map((r) => r.className))],
    };
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
      template: school.reportTemplate,
      school: {
        name: school.name,
        motto: school.motto,
        address: school.address,
        phone: school.phone,
        brandColor: school.brandColor,
        // A crest that cannot be read must not stop a report card being issued.
        logo: school.logoUrl
          ? await storage()
              .get(school.logoUrl)
              .catch(() => null)
          : null,
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
      publishedAt: report.publishedAt,
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

  @Post('components')
  @Roles('OWNER', 'HEAD', 'TEACHER')
  createComponent(@CurrentUser() user: AuthUser, @Body() dto: ComponentDto) {
    return this.svc.createComponent(user, dto);
  }

  @Patch('components/:id')
  @Roles('OWNER', 'HEAD')
  updateComponent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ComponentDto,
  ) {
    return this.svc.updateComponent(user, id, dto);
  }

  @Delete('components/:id')
  @Roles('OWNER', 'HEAD')
  deleteComponent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteComponent(user, id);
  }

  @Get('schemes')
  schemes(@CurrentUser() user: AuthUser) {
    return this.svc.schemes(user);
  }

  @Post('schemes')
  @Roles('OWNER', 'HEAD')
  createScheme(@CurrentUser() user: AuthUser, @Body() dto: GradingSchemeDto) {
    return this.svc.createScheme(user, dto);
  }

  @Patch('schemes/:id')
  @Roles('OWNER', 'HEAD')
  updateScheme(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: GradingSchemeDto,
  ) {
    return this.svc.updateScheme(user, id, dto);
  }

  @Delete('schemes/:id')
  @Roles('OWNER', 'HEAD')
  deleteScheme(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteScheme(user, id);
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

  @Get('cumulative/:studentId')
  cumulative(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string) {
    return this.svc.cumulative(user, studentId);
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

  @Post('reports/publish')
  @Roles('OWNER', 'HEAD')
  publish(@CurrentUser() user: AuthUser, @Body() dto: PublishReportsDto) {
    return this.svc.publishReports(user, dto);
  }

  @Patch('reports/:studentId/:termId')
  @Roles('OWNER', 'HEAD', 'TEACHER')
  updateReport(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Param('termId') termId: string,
    @Body() dto: UpdateReportDto,
  ) {
    return this.svc.updateReport(user, studentId, termId, dto);
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

@Module({
  imports: [SmsModule],
  controllers: [AssessmentController],
  providers: [AssessmentService],
})
export class AssessmentModule {}
