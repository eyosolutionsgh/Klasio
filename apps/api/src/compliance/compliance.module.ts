/**
 * The regulator-facing surface: WAEC, CSSPS, EMIS, and the registers an inspector asks to see.
 *
 * Everything here is an *export*, not an integration. None of these bodies publishes an API, and
 * their file layouts are portal-specific and reissued most years — so the honest thing is to hand
 * the school a clean sheet carrying every field the body is known to want, and let the officer
 * re-key or paste it into whatever this year's template turns out to be. That is the job these
 * exports are actually replacing: a clerk retyping the roll from a paper register at midnight.
 *
 * Columns are named after what the body calls them, so the mapping is obvious to whoever does the
 * pasting. Where a school has to check something before submitting — a name against a birth
 * certificate, chiefly — the sheet says so in a column of its own rather than hoping.
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
  StreamableFile,
} from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequireEntitlement, RequirePermission } from '../common/auth';
import { toCsv, toXlsx, Cell } from '../common/export';

/** Kept local, like the other modules that stream a spreadsheet. */
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** CSSPS takes eight choices as of 2026. Kept as a constant because it has changed before. */
const CSSPS_CHOICES = 8;

class CsspsChoiceDto {
  @IsInt() @Min(1) @Max(CSSPS_CHOICES) rank: number;
  @IsString() schoolName: string;
  @IsOptional() @IsString() programme?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() residency?: string;
}

class SetCsspsChoicesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CsspsChoiceDto)
  choices: CsspsChoiceDto[];
}

type Format = 'csv' | 'xlsx';

interface ExportFile {
  buffer: Buffer;
  filename: string;
  type: string;
}

@Injectable()
export class ComplianceService {
  constructor(private db: PrismaService) {}

  private async file(
    name: string,
    headers: string[],
    rows: Cell[][],
    format: Format,
  ): Promise<ExportFile> {
    return format === 'csv'
      ? { buffer: toCsv(headers, rows), filename: `${name}.csv`, type: 'text/csv' }
      : {
          buffer: await toXlsx(name.slice(0, 28), headers, rows),
          filename: `${name}.xlsx`,
          type: XLSX_MIME,
        };
  }

  /** Age in whole years at a given date — how every census counts a child. */
  private ageAt(dob: Date, on: Date): number {
    let age = on.getFullYear() - dob.getFullYear();
    const before =
      on.getMonth() < dob.getMonth() ||
      (on.getMonth() === dob.getMonth() && on.getDate() < dob.getDate());
    if (before) age -= 1;
    return age;
  }

  /**
   * The candidates a school is presenting, in the shape WAEC's registration asks for.
   *
   * The **certificate name** column is the point of this sheet. WAEC prints what is registered,
   * and a name or date of birth that disagrees with the birth certificate blocks the candidate —
   * chronically, and always discovered far too late to fix. The export therefore states the name
   * on file, the certificate name where the school has recorded a different one, and flags the
   * rows where nobody has checked.
   */
  async waecCandidates(auth: AuthUser, classId: string, format: Format) {
    const cls = await this.db.classRoom.findFirst({
      where: { id: classId, schoolId: auth.schoolId },
      include: { level: { select: { name: true } } },
    });
    if (!cls) throw new NotFoundException('Class not found');

    const students = await this.db.student.findMany({
      where: { schoolId: auth.schoolId, classId, status: 'ACTIVE' },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const headers = [
      'Admission No',
      'Surname',
      'Other Names',
      'Name on birth certificate',
      'Name checked against certificate',
      'Date of Birth',
      'Sex',
      'Class',
      'Level',
    ];
    const rows: Cell[][] = students.map((s) => [
      s.admissionNo,
      s.lastName.toUpperCase(),
      [s.firstName, s.otherNames].filter(Boolean).join(' '),
      s.certificateName ?? '',
      // Not a guess: either the school has recorded the certificate name or nobody has looked.
      s.certificateName ? 'Yes' : 'NOT CHECKED',
      s.dateOfBirth.toISOString().slice(0, 10),
      s.gender === 'MALE' ? 'M' : 'F',
      cls.name,
      cls.level.name,
    ]);

    return this.file(
      `waec-candidates-${cls.name.replace(/\s+/g, '-')}`,
      headers,
      rows,
      format,
    );
  }

  /**
   * The continuous-assessment marks WAEC wants alongside the exam — the SBA half of the 30/70.
   *
   * One row per candidate per subject, with the class score already scaled to the school's SBA
   * weighting, because that is the figure being submitted rather than the raw component marks.
   */
  async sbaExport(auth: AuthUser, classId: string, termId: string, format: Format) {
    const [cls, school, reports] = await Promise.all([
      this.db.classRoom.findFirst({
        where: { id: classId, schoolId: auth.schoolId },
      }),
      this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } }),
      this.db.termReport.findMany({
        where: { schoolId: auth.schoolId, classId, termId },
        include: {
          student: { select: { admissionNo: true, firstName: true, lastName: true } },
        },
      }),
    ]);
    if (!cls) throw new NotFoundException('Class not found');

    const headers = [
      'Admission No',
      'Candidate',
      'Subject',
      `SBA (of ${school.sbaWeight ?? 30})`,
      `Exam (of ${school.examWeight ?? 70})`,
      'Total',
    ];
    const rows: Cell[][] = [];
    for (const r of reports) {
      const lines = (r.lines ?? []) as unknown as {
        subject: string;
        sba30: number;
        exam70: number;
        total: number;
      }[];
      if (!Array.isArray(lines)) continue;
      for (const l of lines) {
        rows.push([
          r.student.admissionNo,
          `${r.student.lastName.toUpperCase()}, ${r.student.firstName}`,
          l.subject,
          l.sba30,
          l.exam70,
          l.total,
        ]);
      }
    }

    return this.file(`waec-sba-${cls.name.replace(/\s+/g, '-')}`, headers, rows, format);
  }

  /**
   * The annual school census, as the EMIS questionnaire asks for it: enrolment broken down by
   * class, sex and age, plus the staff list with qualifications.
   *
   * Age is counted at the census date rather than today, so re-running the return in March gives
   * the same numbers it gave in October — the same rule the termly return already follows.
   */
  async emisCensus(auth: AuthUser, format: Format, asOf?: string) {
    const on = asOf ? new Date(asOf) : new Date();
    const [classes, students, staff] = await Promise.all([
      this.db.classRoom.findMany({
        where: { schoolId: auth.schoolId },
        include: { level: { select: { name: true, category: true, order: true } } },
      }),
      this.db.student.findMany({
        where: { schoolId: auth.schoolId, status: 'ACTIVE' },
        select: { classId: true, gender: true, dateOfBirth: true },
      }),
      this.db.user.findMany({
        where: { schoolId: auth.schoolId },
        select: { name: true, role: true, ntcNumber: true, qualification: true },
      }),
    ]);

    const headers = [
      'Section',
      'Class',
      'Level',
      'Category',
      'Male',
      'Female',
      'Total',
      'Youngest',
      'Oldest',
      'Detail',
    ];
    const rows: Cell[][] = [];

    for (const c of [...classes].sort((a, b) => a.level.order - b.level.order)) {
      const roll = students.filter((s) => s.classId === c.id);
      const ages = roll.map((s) => this.ageAt(s.dateOfBirth, on));
      rows.push([
        'Enrolment',
        c.name,
        c.level.name,
        c.level.category,
        roll.filter((s) => s.gender === 'MALE').length,
        roll.filter((s) => s.gender === 'FEMALE').length,
        roll.length,
        ages.length ? Math.min(...ages) : '',
        ages.length ? Math.max(...ages) : '',
        '',
      ]);
    }
    rows.push([
      'Enrolment',
      'TOTAL',
      '',
      '',
      students.filter((s) => s.gender === 'MALE').length,
      students.filter((s) => s.gender === 'FEMALE').length,
      students.length,
      '',
      '',
      '',
    ]);

    for (const u of staff) {
      rows.push([
        'Staff',
        u.name,
        '',
        u.role,
        '',
        '',
        '',
        '',
        '',
        // Named as missing rather than left blank: a blank reads as "no licence needed".
        [
          u.ntcNumber ? `NTC ${u.ntcNumber}` : 'NTC number not recorded',
          u.qualification ?? 'qualification not recorded',
        ].join(' · '),
      ]);
    }

    return this.file(`emis-census-${on.toISOString().slice(0, 10)}`, headers, rows, format);
  }

  /**
   * The admission register: the permanent, numbered ledger every child ever admitted appears in,
   * and the first thing a NaSIA inspection asks to see.
   *
   * Ordered by admission number rather than by name, because that is what makes it a register —
   * the sequence is the record, and a gap in it is a question the school should be able to answer.
   * Withdrawn and graduated children stay on it for the same reason.
   */
  async admissionRegister(auth: AuthUser, format: Format) {
    const students = await this.db.student.findMany({
      where: { schoolId: auth.schoolId },
      include: {
        classRoom: { select: { name: true } },
        guardians: {
          where: { isPrimary: true },
          include: { guardian: { select: { firstName: true, lastName: true, phone: true } } },
        },
      },
      orderBy: { admissionNo: 'asc' },
    });

    const headers = [
      'Admission No',
      'Surname',
      'Other Names',
      'Sex',
      'Date of Birth',
      'Date Admitted',
      'Class',
      'Guardian',
      'Guardian Phone',
      'Status',
      'Date Left',
      'Reason',
    ];
    const rows: Cell[][] = students.map((s) => {
      const g = s.guardians[0]?.guardian;
      return [
        s.admissionNo,
        s.lastName.toUpperCase(),
        [s.firstName, s.otherNames].filter(Boolean).join(' '),
        s.gender === 'MALE' ? 'M' : 'F',
        s.dateOfBirth.toISOString().slice(0, 10),
        s.enrolledAt.toISOString().slice(0, 10),
        s.classRoom?.name ?? '',
        g ? `${g.firstName} ${g.lastName}` : '',
        g?.phone ?? '',
        s.status,
        s.exitDate ? s.exitDate.toISOString().slice(0, 10) : '',
        s.exitReason ?? '',
      ];
    });

    return this.file('admission-register', headers, rows, format);
  }

  // ── CSSPS school choices ─────────────────────────────────────────────

  async csspsChoices(auth: AuthUser, studentId: string) {
    const student = await this.db.student.findFirst({
      where: { id: studentId, schoolId: auth.schoolId },
    });
    if (!student) throw new NotFoundException('Student not found');
    const choices = await this.db.csspsChoice.findMany({
      where: { schoolId: auth.schoolId, studentId },
      orderBy: { rank: 'asc' },
    });
    return { maxChoices: CSSPS_CHOICES, choices };
  }

  /**
   * Replace a candidate's list outright.
   *
   * Whole-list rather than per-row, because the ranking is the data: a school reordering choices
   * three and five is making one decision, and applying it as two edits leaves a moment where two
   * schools share a rank.
   */
  async setCsspsChoices(auth: AuthUser, studentId: string, dto: SetCsspsChoicesDto) {
    const student = await this.db.student.findFirst({
      where: { id: studentId, schoolId: auth.schoolId },
    });
    if (!student) throw new NotFoundException('Student not found');

    const ranks = dto.choices.map((c) => c.rank);
    if (new Set(ranks).size !== ranks.length) {
      throw new NotFoundException('Two choices cannot share the same position');
    }

    await this.db.csspsChoice.deleteMany({ where: { schoolId: auth.schoolId, studentId } });
    for (const c of dto.choices) {
      await this.db.csspsChoice.create({
        data: {
          schoolId: auth.schoolId,
          studentId,
          rank: c.rank,
          schoolName: c.schoolName.trim(),
          programme: c.programme?.trim() || null,
          category: c.category?.trim() || null,
          residency: c.residency?.trim() || null,
        },
      });
    }
    await this.db.audit(auth.schoolId, auth.sub, 'cssps.choices.set', 'Student', studentId, {
      count: dto.choices.length,
    });
    return this.csspsChoices(auth, studentId);
  }

  async clearCsspsChoices(auth: AuthUser, studentId: string) {
    await this.db.csspsChoice.deleteMany({ where: { schoolId: auth.schoolId, studentId } });
    await this.db.audit(auth.schoolId, auth.sub, 'cssps.choices.clear', 'Student', studentId);
    return { cleared: true };
  }

  /** The selection sheet for a whole class — one row per candidate, one column per choice. */
  async csspsExport(auth: AuthUser, classId: string, format: Format) {
    const cls = await this.db.classRoom.findFirst({
      where: { id: classId, schoolId: auth.schoolId },
    });
    if (!cls) throw new NotFoundException('Class not found');

    const students = await this.db.student.findMany({
      where: { schoolId: auth.schoolId, classId, status: 'ACTIVE' },
      include: { csspsChoices: { orderBy: { rank: 'asc' } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const headers = [
      'Admission No',
      'Candidate',
      ...Array.from({ length: CSSPS_CHOICES }, (_, i) => `Choice ${i + 1}`),
      'Choices recorded',
    ];
    const rows: Cell[][] = students.map((s) => {
      const byRank = new Map(s.csspsChoices.map((c) => [c.rank, c]));
      return [
        s.admissionNo,
        `${s.lastName.toUpperCase()}, ${s.firstName}`,
        ...Array.from({ length: CSSPS_CHOICES }, (_, i) => {
          const c = byRank.get(i + 1);
          if (!c) return '';
          return [c.schoolName, c.programme, c.residency, c.category]
            .filter(Boolean)
            .join(' — ');
        }),
        // Surfaced rather than left to be counted by eye: an incomplete list is the thing that
        // costs a candidate a placement, and it is invisible in a row of mostly-filled cells.
        `${s.csspsChoices.length} of ${CSSPS_CHOICES}`,
      ];
    });

    return this.file(`cssps-choices-${cls.name.replace(/\s+/g, '-')}`, headers, rows, format);
  }
}

@Controller('compliance')
export class ComplianceController {
  constructor(private svc: ComplianceService) {}

  private stream(file: ExportFile) {
    return new StreamableFile(file.buffer, {
      type: file.type,
      disposition: `attachment; filename="${file.filename}"`,
    });
  }

  /**
   * The admission register sits on `platform.export` rather than the returns entitlement: it is
   * the school's own statutory register, and export is a right at every tier.
   */
  @Get('admission-register')
  @RequirePermission('students.view')
  @RequireEntitlement('platform.export')
  async register(@CurrentUser() user: AuthUser, @Query('format') format: Format = 'xlsx') {
    return this.stream(await this.svc.admissionRegister(user, format === 'csv' ? 'csv' : 'xlsx'));
  }

  @Get('waec/candidates')
  @RequirePermission('returns.view')
  @RequireEntitlement('platform.ges-returns')
  async waec(
    @CurrentUser() user: AuthUser,
    @Query('classId') classId: string,
    @Query('format') format: Format = 'xlsx',
  ) {
    return this.stream(await this.svc.waecCandidates(user, classId, format === 'csv' ? 'csv' : 'xlsx'));
  }

  @Get('waec/sba')
  @RequirePermission('returns.view')
  @RequireEntitlement('platform.ges-returns')
  async sba(
    @CurrentUser() user: AuthUser,
    @Query('classId') classId: string,
    @Query('termId') termId: string,
    @Query('format') format: Format = 'xlsx',
  ) {
    return this.stream(
      await this.svc.sbaExport(user, classId, termId, format === 'csv' ? 'csv' : 'xlsx'),
    );
  }

  @Get('emis/census')
  @RequirePermission('returns.view')
  @RequireEntitlement('platform.ges-returns')
  async emis(
    @CurrentUser() user: AuthUser,
    @Query('format') format: Format = 'xlsx',
    @Query('asOf') asOf?: string,
  ) {
    return this.stream(await this.svc.emisCensus(user, format === 'csv' ? 'csv' : 'xlsx', asOf));
  }

  @Get('cssps/:studentId')
  @RequirePermission('students.view')
  choices(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string) {
    return this.svc.csspsChoices(user, studentId);
  }

  @Post('cssps/:studentId')
  @RequirePermission('students.edit')
  setChoices(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Body() dto: SetCsspsChoicesDto,
  ) {
    return this.svc.setCsspsChoices(user, studentId, dto);
  }

  @Delete('cssps/:studentId')
  @RequirePermission('students.edit')
  clearChoices(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string) {
    return this.svc.clearCsspsChoices(user, studentId);
  }

  @Get('cssps/export/:classId')
  @RequirePermission('students.view')
  async csspsSheet(
    @CurrentUser() user: AuthUser,
    @Param('classId') classId: string,
    @Query('format') format: Format = 'xlsx',
  ) {
    return this.stream(await this.svc.csspsExport(user, classId, format === 'csv' ? 'csv' : 'xlsx'));
  }
}

@Module({ controllers: [ComplianceController], providers: [ComplianceService] })
export class ComplianceModule {}
