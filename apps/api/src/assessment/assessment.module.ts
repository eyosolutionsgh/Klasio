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
  IsDateString,
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
import { closedTermMessage, termAcceptsWrites } from '../common/term-lifecycle';
import { isStaleReplay, parseRecordedAt } from '../common/replay';
import { hasEntitlement } from '../common/entitlements';
import {
  AuthUser,
  CurrentUser,
  RequireAnyPermission,
  RequireEntitlement,
  RequirePermission,
} from '../common/auth';
import { renderMessage } from '../common/templates';
import { beceProjection, wassceReadiness } from '../common/exam-analytics';
import { reportCardPdf, ReportCardData, broadsheetPdf, BroadsheetData } from '../common/pdf';
import { toCsv, toXlsx } from '../common/export';
import { PageQuery, dateWindow, orderBy, pageArgs, toPage } from '../common/list-query';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Which columns a class's terminal reports may be ordered by.
 *
 * An allowlist, because `sort` is a query-string value spread into `orderBy` — anything else would
 * let a caller reach through TermReport's relations. `overallTotal` and `classPosition` are the two
 * that carry the GES computation's output; they are only ever *read* here. Nothing on this list
 * changes how a position is calculated, which stays standard competition ranking on subject average
 * inside `computeClassResults`.
 */
const REPORT_SORTS: Record<string, string | string[]> = {
  classPosition: 'classPosition',
  name: ['student.lastName', 'student.firstName'],
  admissionNo: 'student.admissionNo',
  overallTotal: 'overallTotal',
  publishedAt: 'publishedAt',
};

class ScoreEntryDto {
  @IsString() studentId: string;
  @IsString() componentId: string;
  @IsNumber() @Min(0) @Max(100) rawScore: number;
}

class SaveScoresDto {
  @IsString() termId: string;
  @IsString() subjectId: string;
  @IsString() classId: string;
  /**
   * When the teacher entered these, not when they arrived.
   *
   * This page sends the whole class's column at once, so a replay from a device that went offline
   * days ago would revert every correction made to the subject since. See common/replay.ts.
   */
  @IsOptional() @IsDateString() recordedAt?: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScoreEntryDto)
  entries: ScoreEntryDto[];
}

class GenerateReportsDto {
  @IsString() classId: string;
  @IsString() termId: string;
  /** Deliberate consent to rewrite reports guardians have already been shown. */
  @IsOptional() @IsBoolean() regeneratePublished?: boolean;
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

class WeightsDto {
  @IsNumber() @Min(0) @Max(100) sbaWeight: number;
  @IsNumber() @Min(0) @Max(100) examWeight: number;
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

/**
 * The filters on a class's terminal reports. `from`/`to` filter the publication date — see
 * `listReports` — which is the only date on a report that a reader ever asks about ("what went home
 * before the holidays"); the term already fixes when the work was done.
 */
class ListReportsDto extends PageQuery {
  @IsString() classId: string;
  @IsString() termId: string;
  /**
   * PUBLISHED / UNPUBLISHED, which is a state rather than a column: `publishedAt` is a nullable
   * timestamp, so filtering on it means asking whether it is set, not comparing it.
   */
  @IsOptional() @IsIn(['PUBLISHED', 'UNPUBLISHED']) status?: 'PUBLISHED' | 'UNPUBLISHED';
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

  /** The school's own split between continuous work and the exam. GES uses 30/70. */
  async weights(auth: AuthUser) {
    const s = await this.db.school.findUniqueOrThrow({
      where: { id: auth.schoolId },
      select: { sbaWeight: true, examWeight: true },
    });
    return {
      sbaWeight: s.sbaWeight ?? DEFAULT_SBA_WEIGHT,
      examWeight: s.examWeight ?? DEFAULT_EXAM_WEIGHT,
    };
  }

  async setWeights(auth: AuthUser, dto: WeightsDto) {
    // A report card is read as a mark out of 100. If the two sides do not add to 100 every
    // total in the school silently changes scale, so this is refused rather than rounded.
    if (dto.sbaWeight + dto.examWeight !== 100) {
      throw new BadRequestException(
        `The two weights must add up to 100 — ${dto.sbaWeight} + ${dto.examWeight} is ${
          dto.sbaWeight + dto.examWeight
        }`,
      );
    }
    const school = await this.db.school.update({
      where: { id: auth.schoolId },
      data: { sbaWeight: dto.sbaWeight, examWeight: dto.examWeight },
      select: { sbaWeight: true, examWeight: true },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'assessment.weights', 'School', auth.schoolId, {
      sbaWeight: dto.sbaWeight,
      examWeight: dto.examWeight,
    });
    return school;
  }

  async createComponent(auth: AuthUser, dto: ComponentDto) {
    // A teacher may add assessments for a subject they are marking, which is the whole point of
    // this being flexible. Adding one to *every* subject changes every report card in the
    // school, so that needs authority over the school's assessment setup.
    if (!auth.permissions?.includes('assessment.configure') && !dto.subjectId) {
      throw new BadRequestException(
        'Choose a subject for this assessment — adding one to every subject needs permission to set up assessments',
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

  /**
   * Refuse a write aimed at a term the school has closed.
   *
   * Shared by marks entry and report generation, and checked in the service rather than the
   * controller because the offline queue replays into these same methods: a column of marks
   * queued the day before the term closed must be refused with a reason the teacher can read,
   * not applied silently three weeks after the reports went home.
   */
  private async assertTermOpen(auth: AuthUser, termId: string) {
    const term = await this.db.term.findFirst({
      where: { id: termId, academicYear: { schoolId: auth.schoolId } },
      select: { id: true, name: true, closedAt: true },
    });
    if (!term) throw new NotFoundException('Term not found');
    if (!termAcceptsWrites(term)) throw new BadRequestException(closedTermMessage(term));
  }

  async saveScores(auth: AuthUser, dto: SaveScoresDto) {
    await this.assertTermOpen(auth, dto.termId);
    const components = await this.components(auth);
    const compById = new Map(components.map((c) => [c.id, c]));

    /**
     * Every id in the payload has to belong to this school, and to the class being marked.
     *
     * The upsert's `where` is a composite unique that does not include schoolId, and the `create`
     * stamps `auth.schoolId` onto whatever studentId arrived — so a hand-rolled request could
     * file a mark against a child in another school, or against a child in a class the marker
     * has nothing to do with. Row-level security stops it becoming a read across tenants, but it
     * would still write a row into this school's data pointing somewhere else entirely.
     */
    const subject = await this.db.subject.findFirst({
      where: { id: dto.subjectId, schoolId: auth.schoolId },
      select: { id: true },
    });
    if (!subject) throw new NotFoundException('Subject not found');

    const roll = await this.db.student.findMany({
      where: { schoolId: auth.schoolId, classId: dto.classId },
      select: { id: true },
    });
    const inClass = new Set(roll.map((s) => s.id));

    const recordedAt = parseRecordedAt(dto.recordedAt);
    const stored = await this.db.score.findMany({
      where: {
        schoolId: auth.schoolId,
        subjectId: dto.subjectId,
        termId: dto.termId,
        studentId: { in: dto.entries.map((e) => e.studentId) },
      },
      select: { studentId: true, componentId: true, updatedAt: true },
    });
    const lastTouched = new Map(
      stored.map((r) => [`${r.studentId}:${r.componentId}`, r.updatedAt]),
    );

    let saved = 0;
    let superseded = 0;
    for (const e of dto.entries) {
      if (!inClass.has(e.studentId)) {
        throw new BadRequestException('That student is not in this class');
      }
      // Per cell, not per request: a teacher's offline column should still land for the pupils
      // nobody corrected in the meantime.
      if (isStaleReplay(recordedAt, lastTouched.get(`${e.studentId}:${e.componentId}`))) {
        superseded++;
        continue;
      }
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
      ...(superseded > 0 ? { superseded } : {}),
    });
    return { saved, superseded };
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
    /**
     * The fallback picks the band with the highest ceiling, not the last one in the array.
     *
     * `validateBands` guarantees 0–100 coverage, so a total inside that range always matches and
     * the fallback is unreachable today. But it is a fallback for totals *outside* the range, and
     * ordering the JSON differently — highest band first, which reads perfectly naturally — used
     * to mean a 101 quietly graded as F.
     */
    const topBand = bands.reduce((best, b) => (b.max > best.max ? b : best), bands[0]);
    const gradeFor = (total: number) =>
      bands.find((b) => total >= b.min && total <= b.max) ?? topBand;

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

    /**
     * Overall class position.
     *
     * Ranked on the **average** across the subjects a student was actually marked in, not on the
     * raw sum. `weighSubject` is careful never to let an unmarked assessment become a zero, and a
     * subject with nothing marked is dropped from the report above — but summing what survives
     * quietly reintroduced that zero at the class-position level. A child whose Maths scores had
     * not been entered yet was ranked on seven subjects against a class of eight, so the best
     * student in the year could come out twelfth, and that position went onto the printed report
     * card and into the parents' portal.
     *
     * `cumulative()` below already said as much in its own comment — that a term with nine
     * subjects and one with six are not comparable on the raw total — and then the position on the
     * report card was computed the other way.
     *
     * The displayed total stays the sum, because that is the figure schools recognise; only the
     * ranking uses the average.
     */
    const overall = students
      .map((st) => {
        const lines = perStudent.get(st.id) ?? [];
        const sum = lines.reduce((a, l) => a + l.total, 0);
        return {
          id: st.id,
          total: Math.round(sum * 10) / 10,
          average: lines.length ? sum / lines.length : 0,
          subjectsMarked: lines.length,
        };
      })
      .sort((a, b) => b.average - a.average);
    const overallRank = this.rank(overall.map((o) => ({ id: o.id, total: o.average })));

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
    // Publishing a finished report stays open after close — releasing is not editing — but
    // recomputing one from marks is exactly the thing a closed term settles.
    await this.assertTermOpen(auth, dto.termId);
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

    /**
     * Published reports are not silently rewritten.
     *
     * Editing a single line of a published report was already refused — "unpublish it before
     * editing" — while re-running generation for the whole class overwrote every mark, grade and
     * position on it with no check at all. The guarded path was the harmless one and the
     * destructive one was wide open: a teacher entering one late score and clicking Generate
     * rewrote documents parents had already read, leaving only `generatedAt` to show it happened.
     *
     * Regenerating is often the right thing to do — a genuine marking error has to be fixable —
     * so this asks rather than refuses, and records that the school chose it.
     */
    const published = await this.db.termReport.findMany({
      where: {
        schoolId: auth.schoolId,
        classId: dto.classId,
        termId: dto.termId,
        publishedAt: { not: null },
      },
      select: { studentId: true },
    });
    if (published.length > 0 && !dto.regeneratePublished) {
      throw new BadRequestException(
        `${published.length} of these reports ${published.length === 1 ? 'has' : 'have'} already been published and shared with guardians. ` +
          'Regenerating will replace what they have seen — confirm to go ahead.',
      );
    }
    const publishedIds = new Set(published.map((p) => p.studentId));

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
      // Clearing the vetting on regeneration: a report recomputed after the head signed it off is
      // not the document that was signed off.
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
          vettedAt: null,
          vettedById: null,
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
      // Which already-shared documents this run replaced, so the change is answerable later.
      republished: [...publishedIds],
    });
    return { generated, classSize: students.length };
  }

  async listReports(auth: AuthUser, q: ListReportsDto) {
    const { skip, take, page, perPage } = pageArgs(q);
    const published = dateWindow(q);
    const where: Prisma.TermReportWhereInput = {
      schoolId: auth.schoolId,
      classId: q.classId,
      termId: q.termId,
      ...(q.status === 'PUBLISHED' ? { publishedAt: { not: null } } : {}),
      ...(q.status === 'UNPUBLISHED' ? { publishedAt: null } : {}),
      // Asking for a publication window implies the report was published at all, so `not: null` is
      // redundant here — a range comparison already excludes the nulls.
      ...(published ? { publishedAt: published } : {}),
    };

    const [total, reports] = await Promise.all([
      this.db.termReport.count({ where }),
      this.db.termReport.findMany({
        where,
        include: { student: { select: { firstName: true, lastName: true, admissionNo: true } } },
        // Position first by default: a class's reports are read as a ranking, and that is the
        // order the printed broadsheet puts them in.
        orderBy: orderBy<Prisma.TermReportOrderByWithRelationInput>(q, REPORT_SORTS, {
          classPosition: 'asc',
        }),
        skip,
        take,
      }),
    ]);

    const rows = reports.map((r) => ({
      studentId: r.studentId,
      name: `${r.student.firstName} ${r.student.lastName}`,
      admissionNo: r.student.admissionNo,
      overallTotal: r.overallTotal,
      classPosition: r.classPosition,
      classSize: r.classSize,
      publishedAt: r.publishedAt,
      vettedAt: r.vettedAt,
    }));
    return toPage(rows, total, { page, perPage });
  }

  /**
   * Record the human parts of a terminal report: conduct, interest and the two remarks.
   * The head teacher's remark needs `reports.remark.head` — a class teacher must not be able to
   * put words in the head's mouth on a document that goes home to guardians. It is a permission
   * rather than a role so a school can hand it to an assistant head or an exams officer without
   * making them the head.
   */
  async updateReport(auth: AuthUser, studentId: string, termId: string, dto: UpdateReportDto) {
    const report = await this.db.termReport.findFirst({
      where: { schoolId: auth.schoolId, studentId, termId },
    });
    if (!report) throw new NotFoundException('Report not generated yet');
    if (dto.headRemark !== undefined && !auth.permissions?.includes('reports.remark.head')) {
      throw new ForbiddenException("You do not have permission to write the head teacher's remark");
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
  /**
   * Mark a class's reports as read and approved by the head, before anything is released.
   *
   * The order a school actually works in is generate → vet → publish, and the vetting is the head
   * reading every card. Regenerating clears it, because a report recomputed after it was signed
   * off is not the document that was signed off.
   */
  async vetReports(auth: AuthUser, dto: PublishReportsDto) {
    const vetted = dto.published !== false;
    const result = await this.db.termReport.updateMany({
      where: { schoolId: auth.schoolId, classId: dto.classId, termId: dto.termId },
      data: {
        vettedAt: vetted ? new Date() : null,
        vettedById: vetted ? auth.sub : null,
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      vetted ? 'reports.vet' : 'reports.unvet',
      'ClassRoom',
      dto.classId,
      { termId: dto.termId, count: result.count },
    );
    return { vetted, count: result.count };
  }

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
    // Publishing is Basic; texting every family about it is Medium.
    // Deduplication is per family, inside notifyResults — a class-wide check here would skip
    // everyone the moment one family had been told.
    const mayPush = hasEntitlement(auth.tier, 'comms.results-push');
    const notified =
      mayPush && publish && result.count > 0 ? await this.notifyResults(auth, dto) : 0;
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
    const body = await renderMessage(this.db, auth.schoolId, 'RESULTS_READY', {
      school: school.name,
      term: term?.name ?? 'This term',
    });

    /**
     * One batch id per student, not one for the class.
     *
     * A class-wide id meant `alreadySent` went true as soon as the *first* family was notified,
     * so any run that stopped short — the school ran out of credits mid-class, the provider
     * failed, the process died — left the rest permanently unreachable. Re-publishing after
     * topping up sent to nobody, because the batch already existed.
     *
     * Per-student ids make a re-publish top up exactly the families who missed out and skip the
     * ones already told. This is the shape the fee reminders already use.
     */
    let sent = 0;
    for (const st of students) {
      const phone = st.guardians[0]?.guardian.phone;
      if (!phone) continue;
      const batchId = `RESULTS-${dto.termId}-${st.id}`;
      if (await this.sms.alreadySent(auth.schoolId, batchId)) continue;
      const res = await this.sms.sendToPhones({
        schoolId: auth.schoolId,
        createdById: auth.sub,
        phones: [phone],
        body,
        batchId,
      });
      sent += res.sent;
    }
    return sent;
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

    /*
      Year-end outcomes, which are not derivable from the term rows above: a repeated year looks
      identical to a normal one in the marks, and shows up only as the same class appearing twice.
      A parent asking "did he repeat Basic 4?" is asking about this, not about an average.
    */
    /*
      Conduct and health, which the audit found missing from what was otherwise a purely academic
      record. A cumulative record card in a Ghanaian school carries all three, and the reason is
      practical: the receiving school on a transfer, and the head writing a testimonial, are both
      reading for character as much as for marks.
    */
    const [conductByTerm, discipline, medical] = await Promise.all([
      Promise.resolve(
        rows
          .map((r) => ({ term: r.term, year: r.year, termId: r.termId }))
          .map((r) => {
            const report = reports.find((x) => x.termId === r.termId);
            return {
              term: `${r.year} · ${r.term}`,
              conduct: report?.conduct ?? null,
              interest: report?.interest ?? null,
              teacherRemark: report?.teacherRemark ?? null,
            };
          })
          .filter((r) => r.conduct || r.interest || r.teacherRemark),
      ),
      this.db.disciplineEntry.findMany({
        where: { schoolId: auth.schoolId, studentId },
        orderBy: { occurredOn: 'desc' },
        take: 20,
      }),
      Promise.resolve(student.medicalNotes ?? null),
    ]);

    const promotions = await this.db.promotionRecord.findMany({
      where: { schoolId: auth.schoolId, studentId },
      include: { academicYear: { select: { name: true, startDate: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const classNames = new Map(
      (
        await this.db.classRoom.findMany({
          where: {
            id: {
              in: promotions.flatMap((p) => [p.fromClassId, p.toClassId].filter((x): x is string => !!x)),
            },
          },
          select: { id: true, name: true },
        })
      ).map((c) => [c.id, c.name]),
    );

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
      promotions: promotions.map((p) => ({
        year: p.academicYear.name,
        action: p.action,
        fromClass: p.fromClassId ? (classNames.get(p.fromClassId) ?? null) : null,
        toClass: p.toClassId ? (classNames.get(p.toClassId) ?? null) : null,
        decidedAt: p.createdAt,
      })),
      yearsRepeated: promotions.filter((p) => p.action === 'REPEATED').length,
      conduct: conductByTerm,
      discipline: discipline.map((d) => ({
        occurredOn: d.occurredOn,
        description: d.description,
        actionTaken: d.actionTaken,
        outcome: d.outcome,
      })),
      /**
       * Present only for a reader who holds the medical permission. Absent, not null: a null here
       * would read as "no medical notes", which is a different and dangerous claim.
       * See student-detail-custody-redaction.
       */
      medicalNotes: auth.permissions?.includes('students.medical') ? medical : undefined,
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
      // Same reason as the PDF: the on-screen card labels the columns with these.
      weights: {
        sba: school.sbaWeight ?? DEFAULT_SBA_WEIGHT,
        exam: school.examWeight ?? DEFAULT_EXAM_WEIGHT,
      },
    };
  }

  async reportCardPdf(auth: AuthUser, studentId: string, termId: string) {
    const [card, weights] = await Promise.all([
      this.reportCard(auth, studentId, termId),
      this.weights(auth),
    ]);
    // The column headers name the split, so they have to be the school's own — printing a fixed
    // 30/70 on a school that uses 40/60 contradicts the marks beside it.
    return reportCardPdf({
      ...(card as unknown as ReportCardData),
      weights: { sba: weights.sbaWeight, exam: weights.examWeight },
    });
  }

  /** Broadsheet / tabulation sheet: students × subjects with totals, positions and class ranking. */
  /**
   * BECE aggregate projection (JHS) or WASSCE readiness (SHS) for a class, from the term's
   * computed results (FEATURES.md §4). The grade arithmetic lives in common/exam-analytics —
   * a planning tool, and the page says so.
   */
  async outlook(auth: AuthUser, classId: string, termId: string) {
    const cls = await this.db.classRoom.findFirst({
      where: { id: classId, schoolId: auth.schoolId },
      include: { level: { select: { category: true } } },
    });
    if (!cls) throw new NotFoundException('Class not found');
    const category = cls.level.category;
    if (category !== 'JHS' && category !== 'SHS') {
      throw new BadRequestException('The examinations outlook is for JHS and SHS classes');
    }

    const r = await this.computeClassResults(auth, classId, termId);
    const subjectsById = new Map(r.subjects.map((s) => [s.id, s]));
    const coreById = new Map(
      (
        await this.db.subject.findMany({
          where: { schoolId: auth.schoolId },
          select: { id: true, isCore: true },
        })
      ).map((s) => [s.id, s.isCore]),
    );

    const students = r.students.map((st) => {
      const lines = r.perStudent.get(st.id) ?? [];
      const marks = lines
        .filter((l) => l.total !== null && l.total !== undefined)
        .map((l) => ({
          subject: subjectsById.get(l.subjectId)?.name ?? 'Unknown subject',
          isCore: coreById.get(l.subjectId) ?? false,
          total: Number(l.total),
        }));
      const base = {
        id: st.id,
        name: `${st.firstName} ${st.lastName}`,
        admissionNo: st.admissionNo,
        marked: marks.length,
      };
      return category === 'JHS'
        ? { ...base, ...beceProjection(marks) }
        : { ...base, ...wassceReadiness(marks) };
    });

    // Best outlook first; a student with no aggregate yet sorts to the end, where the work is.
    students.sort((a, b) => {
      const aa = 'aggregate' in a ? (a.aggregate ?? 999) : 999;
      const bb = 'aggregate' in b ? (b.aggregate ?? 999) : 999;
      return aa - bb;
    });
    return { kind: category, className: cls.name, termName: r.term.name, students };
  }

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

  @Get('weights')
  @RequirePermission('marks.view')
  weights(@CurrentUser() user: AuthUser) {
    return this.svc.weights(user);
  }

  @Patch('weights')
  @RequirePermission('assessment.configure')
  setWeights(@CurrentUser() user: AuthUser, @Body() dto: WeightsDto) {
    return this.svc.setWeights(user, dto);
  }

  @Get('components')
  @RequirePermission('marks.view')
  components(@CurrentUser() user: AuthUser) {
    return this.svc.components(user);
  }

  // Entering marks is enough to add an assessment, because the service refuses anyone without
  // `assessment.configure` who does not name a subject — a teacher may add their own column,
  // not one that lands on every report card in the school.
  @Post('components')
  // A teacher adds one for their own subject; an exams officer configures them school-wide.
  @RequireAnyPermission('marks.enter', 'assessment.configure')
  createComponent(@CurrentUser() user: AuthUser, @Body() dto: ComponentDto) {
    return this.svc.createComponent(user, dto);
  }

  @Patch('components/:id')
  @RequirePermission('assessment.configure')
  updateComponent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ComponentDto,
  ) {
    return this.svc.updateComponent(user, id, dto);
  }

  @Delete('components/:id')
  @RequirePermission('assessment.configure')
  deleteComponent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteComponent(user, id);
  }

  @Get('schemes')
  @RequirePermission('marks.view')
  schemes(@CurrentUser() user: AuthUser) {
    return this.svc.schemes(user);
  }

  @Post('schemes')
  @RequirePermission('assessment.configure')
  createScheme(@CurrentUser() user: AuthUser, @Body() dto: GradingSchemeDto) {
    return this.svc.createScheme(user, dto);
  }

  @Patch('schemes/:id')
  @RequirePermission('assessment.configure')
  updateScheme(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: GradingSchemeDto,
  ) {
    return this.svc.updateScheme(user, id, dto);
  }

  @Delete('schemes/:id')
  @RequirePermission('assessment.configure')
  deleteScheme(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteScheme(user, id);
  }

  @Get('scores')
  @RequirePermission('marks.view')
  scores(
    @CurrentUser() user: AuthUser,
    @Query('classId') classId: string,
    @Query('subjectId') subjectId: string,
    @Query('termId') termId: string,
  ) {
    return this.svc.scoreMatrix(user, classId, subjectId, termId);
  }

  @Post('scores')
  @RequirePermission('marks.enter')
  saveScores(@CurrentUser() user: AuthUser, @Body() dto: SaveScoresDto) {
    return this.svc.saveScores(user, dto);
  }

  @Post('reports/generate')
  @RequirePermission('reports.generate')
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateReportsDto) {
    return this.svc.generateReports(user, dto);
  }

  @Get('cumulative/:studentId')
  @RequirePermission('reports.view')
  cumulative(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string) {
    return this.svc.cumulative(user, studentId);
  }

  @Get('reports')
  @RequirePermission('reports.view')
  list(@CurrentUser() user: AuthUser, @Query() query: ListReportsDto) {
    return this.svc.listReports(user, query);
  }

  @Get('reports/:studentId/:termId')
  @RequirePermission('reports.view')
  card(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Param('termId') termId: string,
  ) {
    return this.svc.reportCard(user, studentId, termId);
  }

  @Post('reports/publish')
  @RequirePermission('reports.publish')
  publish(@CurrentUser() user: AuthUser, @Body() dto: PublishReportsDto) {
    return this.svc.publishReports(user, dto);
  }

  /**
   * Vetting is the head's remark permission rather than the publish one: the person who reads
   * every card and signs it off is the person who writes the head's remark on it, and that is
   * deliberately not the same authority as releasing results to families.
   */
  @Post('reports/vet')
  @RequirePermission('reports.remark.head')
  vet(@CurrentUser() user: AuthUser, @Body() dto: PublishReportsDto) {
    return this.svc.vetReports(user, dto);
  }

  // The route gate is the class teacher's remark; the head teacher's remark is checked in the
  // service, because the same endpoint writes both.
  @Patch('reports/:studentId/:termId')
  // Either remark gets you in; the service decides which fields you may actually write.
  @RequireAnyPermission('reports.remark.teacher', 'reports.remark.head')
  updateReport(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Param('termId') termId: string,
    @Body() dto: UpdateReportDto,
  ) {
    return this.svc.updateReport(user, studentId, termId, dto);
  }

  @Get('outlook')
  @RequirePermission('reports.view')
  @RequireEntitlement('exams.analytics')
  outlook(
    @CurrentUser() user: AuthUser,
    @Query('classId') classId: string,
    @Query('termId') termId: string,
  ) {
    return this.svc.outlook(user, classId, termId);
  }

  @Get('broadsheet')
  @RequirePermission('reports.view')
  broadsheet(
    @CurrentUser() user: AuthUser,
    @Query('classId') classId: string,
    @Query('termId') termId: string,
  ) {
    return this.svc.broadsheet(user, classId, termId);
  }

  @Get('broadsheet/export')
  @RequirePermission('reports.view')
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
  @RequirePermission('reports.view')
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
