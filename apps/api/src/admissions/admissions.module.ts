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
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApplicantStage, Gender, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Public, RequireEntitlement, Roles } from '../common/auth';
import { allowedStages, stageMoveError } from '../common/admissions';
import { hasEntitlement } from '../common/entitlements';
import { normalizeMsisdn } from '../common/phone';
import { storage } from '../common/storage';
import { admissionLetterPdf } from '../common/pdf';
import { StudentsModule, StudentsService } from '../students/students.module';

/** The public form: the least a school needs to open a file on a child. */
class ApplyDto {
  @IsString() @MinLength(2) @MaxLength(60) firstName: string;
  @IsString() @MinLength(2) @MaxLength(60) lastName: string;
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @IsEnum(Gender) gender?: Gender;
  @IsOptional() @IsString() levelId?: string;
  @IsString() @MinLength(2) @MaxLength(120) guardianName: string;
  @IsString() guardianPhone: string;
  @IsOptional() @IsString() guardianEmail?: string;
  @IsOptional() @IsString() @MaxLength(120) previousSchool?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

class MoveStageDto {
  @IsEnum(ApplicantStage) stage: ApplicantStage;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class DecisionDto {
  /** Only the two outcomes a decision can have; everything else is a plain stage move. */
  @IsEnum(ApplicantStage) outcome: ApplicantStage;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class ConvertDto {
  @IsString() classId: string;
  // The public form asks for neither, so conversion is where they are finally pinned down.
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @IsEnum(Gender) gender?: Gender;
}

@Injectable()
export class AdmissionsService {
  constructor(
    private db: PrismaService,
    private students: StudentsService,
  ) {}

  // ── Public application ─────────────────────────────────────────────

  /**
   * Next free reference for the school, as APP-<year>-<0000>.
   *
   * Derived from the highest reference already issued this year rather than a row count, so
   * deleting or declining an application never hands its number to somebody else. The unique
   * index on (schoolId, reference) is the real guarantee — this only has to be a good guess.
   */
  private async nextReference(schoolId: string, year: number): Promise<string> {
    const prefix = `APP-${year}-`;
    const last = await this.db.applicant.findFirst({
      where: { schoolId, reference: { startsWith: prefix } },
      orderBy: { reference: 'desc' },
      select: { reference: true },
    });
    const seq = last ? Number(last.reference.slice(prefix.length)) || 0 : 0;
    return `${prefix}${String(seq + 1).padStart(4, '0')}`;
  }

  /**
   * A parent applying from the school's public page, with no account of any kind.
   *
   * Runs inside the school's tenant scope explicitly: an unauthenticated request has no
   * principal, so the tenant interceptor leaves row-level security with nothing set and every
   * query would come back empty. The school id comes from the URL and is only ever used to
   * scope — an id that does not exist reads as "no such school", never as somebody else's.
   */
  async apply(schoolId: string, dto: ApplyDto) {
    const phone = normalizeMsisdn(dto.guardianPhone);
    if (!phone) throw new BadRequestException('That does not look like a phone number');

    return this.db.withTenant(schoolId, async () => {
      const school = await this.db.school.findFirst({ where: { id: schoolId } });
      // Same answer for a school that does not exist and one whose package excludes
      // admissions: a public endpoint should not confirm which schools are on the platform.
      if (!school || !hasEntitlement(school.tier, 'sis.admissions')) {
        throw new NotFoundException('This school is not accepting applications online');
      }
      if (dto.levelId) {
        const level = await this.db.level.findFirst({ where: { id: dto.levelId, schoolId } });
        if (!level) throw new BadRequestException('Pick a class from the list');
      }

      const year = new Date().getFullYear();
      // Two parents can submit in the same second; the unique index catches it, and the retry
      // simply takes the next number rather than failing a form the parent cannot resubmit.
      for (let attempt = 0; attempt < 5; attempt++) {
        const reference = await this.nextReference(schoolId, year);
        try {
          const applicant = await this.db.applicant.create({
            data: {
              schoolId,
              reference,
              firstName: dto.firstName.trim(),
              lastName: dto.lastName.trim(),
              dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
              gender: dto.gender ?? null,
              levelId: dto.levelId ?? null,
              guardianName: dto.guardianName.trim(),
              guardianPhone: dto.guardianPhone.trim(),
              guardianEmail: dto.guardianEmail?.trim() || null,
              previousSchool: dto.previousSchool?.trim() || null,
              notes: dto.notes?.trim() || null,
              stage: 'APPLIED',
            },
          });
          // No user id — the applicant is not signed in and never will be.
          await this.db.audit(schoolId, null, 'applicant.apply', 'Applicant', applicant.id, {
            reference,
          });
          return {
            reference: applicant.reference,
            stage: applicant.stage,
            schoolName: school.name,
            message: `Application received. Quote ${applicant.reference} when you contact the school.`,
          };
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
          throw e;
        }
      }
      throw new BadRequestException('Could not file the application just now — please try again');
    });
  }

  /** The levels a parent may pick on the public form. Public, so it says nothing else. */
  async publicLevels(schoolId: string) {
    return this.db.withTenant(schoolId, async () => {
      const school = await this.db.school.findFirst({ where: { id: schoolId } });
      if (!school || !hasEntitlement(school.tier, 'sis.admissions')) {
        throw new NotFoundException('This school is not accepting applications online');
      }
      const levels = await this.db.level.findMany({
        where: { schoolId },
        orderBy: { order: 'asc' },
        select: { id: true, name: true },
      });
      return { school: { name: school.name }, levels };
    });
  }

  // ── Staff pipeline ─────────────────────────────────────────────────

  async list(auth: AuthUser, stage?: ApplicantStage, q?: string) {
    // The stage arrives as a raw query string; an unknown one would reach Prisma's enum filter
    // and surface as a 500 rather than as the typo it is.
    if (stage && !Object.values(ApplicantStage).includes(stage)) {
      throw new BadRequestException('Unknown stage');
    }
    const [applicants, byStage] = await Promise.all([
      this.db.applicant.findMany({
        where: {
          schoolId: auth.schoolId,
          ...(stage ? { stage } : {}),
          ...(q
            ? {
                OR: [
                  { firstName: { contains: q, mode: 'insensitive' } },
                  { lastName: { contains: q, mode: 'insensitive' } },
                  { reference: { contains: q, mode: 'insensitive' } },
                  { guardianPhone: { contains: q } },
                ],
              }
            : {}),
        },
        include: { level: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.db.applicant.groupBy({
        by: ['stage'],
        where: { schoolId: auth.schoolId },
        _count: true,
      }),
    ]);
    return {
      counts: byStage.reduce(
        (acc, r) => ({ ...acc, [r.stage]: r._count }),
        {} as Record<string, number>,
      ),
      applicants: applicants.map((a) => ({
        id: a.id,
        reference: a.reference,
        name: `${a.firstName} ${a.lastName}`,
        levelName: a.level?.name ?? null,
        // The public form does not insist on either, but enrolling does — so the pipeline
        // shows what is still missing before the office tries to convert.
        dateOfBirth: a.dateOfBirth,
        gender: a.gender,
        guardianName: a.guardianName,
        guardianPhone: a.guardianPhone,
        stage: a.stage,
        studentId: a.studentId,
        decidedAt: a.decidedAt,
        createdAt: a.createdAt,
        /** Sent with the row so the UI never offers a move the API will refuse. */
        allowedStages: allowedStages(a.stage),
      })),
    };
  }

  /** Loads an applicant inside the caller's school, or 404s. */
  private async own(auth: AuthUser, id: string) {
    const applicant = await this.db.applicant.findFirst({
      where: { id, schoolId: auth.schoolId },
      include: { level: { select: { id: true, name: true } } },
    });
    if (!applicant) throw new NotFoundException('Applicant not found');
    return applicant;
  }

  async detail(auth: AuthUser, id: string) {
    const a = await this.own(auth, id);
    return {
      id: a.id,
      reference: a.reference,
      firstName: a.firstName,
      lastName: a.lastName,
      dateOfBirth: a.dateOfBirth,
      gender: a.gender,
      level: a.level,
      guardianName: a.guardianName,
      guardianPhone: a.guardianPhone,
      guardianEmail: a.guardianEmail,
      previousSchool: a.previousSchool,
      notes: a.notes,
      stage: a.stage,
      studentId: a.studentId,
      decidedAt: a.decidedAt,
      createdAt: a.createdAt,
      /** What the office may do next, so the UI never offers a move the API will refuse. */
      allowedStages: allowedStages(a.stage),
    };
  }

  async move(auth: AuthUser, id: string, dto: MoveStageDto) {
    const applicant = await this.own(auth, id);
    const problem = stageMoveError(applicant.stage, dto.stage);
    if (problem) throw new BadRequestException(problem);

    // OFFERED and DECLINED are the moments a school commits to an answer, so they are what
    // decidedAt records — the rest of the pipeline is progress, not a decision.
    const decided = dto.stage === 'OFFERED' || dto.stage === 'DECLINED';
    const updated = await this.db.applicant.update({
      where: { id },
      data: {
        stage: dto.stage,
        ...(decided ? { decidedAt: new Date() } : {}),
        ...(dto.note ? { notes: dto.note } : {}),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'applicant.stage', 'Applicant', id, {
      from: applicant.stage,
      to: dto.stage,
      note: dto.note ?? null,
    });
    return { id: updated.id, stage: updated.stage, decidedAt: updated.decidedAt };
  }

  /** Record the school's answer. A thin, explicit wrapper over the stage move it implies. */
  async decide(auth: AuthUser, id: string, dto: DecisionDto) {
    if (dto.outcome !== 'OFFERED' && dto.outcome !== 'DECLINED') {
      throw new BadRequestException('A decision is either OFFERED or DECLINED');
    }
    return this.move(auth, id, { stage: dto.outcome, note: dto.note });
  }

  /**
   * Turn an accepted applicant into a student.
   *
   * Deliberately delegates to StudentsService.create: that is where the package enrolment cap
   * is enforced, and an admissions back door that wrote a Student row directly would let a
   * school walk straight past it. Converting twice returns the student already created rather
   * than making a second one — the applicant's studentId is the record of what happened.
   */
  async convert(auth: AuthUser, id: string, dto: ConvertDto) {
    const applicant = await this.own(auth, id);
    if (applicant.studentId) {
      return { studentId: applicant.studentId, stage: applicant.stage, alreadyConverted: true };
    }
    if (applicant.stage !== 'ACCEPTED') {
      throw new BadRequestException('Only an ACCEPTED applicant can be enrolled');
    }

    const dateOfBirth = dto.dateOfBirth ?? applicant.dateOfBirth?.toISOString().slice(0, 10);
    const gender = dto.gender ?? applicant.gender;
    if (!dateOfBirth) throw new BadRequestException('A date of birth is needed to enrol');
    if (!gender) throw new BadRequestException('A gender is needed to enrol');

    // The form collects one guardian name; the student record wants it in two parts.
    const parts = applicant.guardianName.trim().split(/\s+/);
    const student = await this.students.create(auth, {
      firstName: applicant.firstName,
      lastName: applicant.lastName,
      gender,
      dateOfBirth,
      classId: dto.classId,
      guardianFirstName: parts[0],
      guardianLastName: parts.slice(1).join(' ') || applicant.lastName,
      guardianPhone: applicant.guardianPhone,
      guardianRelationship: 'Guardian',
    });

    await this.db.applicant.update({
      where: { id },
      data: { stage: 'ENROLLED', studentId: student.id },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'applicant.convert', 'Applicant', id, {
      studentId: student.id,
      reference: applicant.reference,
    });
    return { studentId: student.id, stage: 'ENROLLED' as const, alreadyConverted: false };
  }

  /** The letter itself. Only offered, accepted and enrolled applicants have one to give. */
  async letter(auth: AuthUser, id: string) {
    const applicant = await this.own(auth, id);
    if (!['OFFERED', 'ACCEPTED', 'ENROLLED'].includes(applicant.stage)) {
      throw new BadRequestException('Offer the place before printing an admission letter');
    }
    const [school, term, student] = await Promise.all([
      this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } }),
      this.db.term.findFirst({
        where: { isCurrent: true, academicYear: { schoolId: auth.schoolId, isCurrent: true } },
        select: { nextTermBegins: true },
      }),
      applicant.studentId
        ? this.db.student.findFirst({
            where: { id: applicant.studentId, schoolId: auth.schoolId },
            select: { admissionNo: true },
          })
        : null,
    ]);

    const buffer = await admissionLetterPdf({
      school: {
        name: school.name,
        motto: school.motto,
        address: school.address,
        phone: school.phone,
        brandColor: school.brandColor,
        // pdfkit reads JPEG and PNG only, and the crest may be a WebP — an unusable one is
        // skipped rather than allowed to take the letter down with it.
        logo: school.logoUrl
          ? await storage()
              .get(school.logoUrl)
              .catch(() => null)
          : null,
      },
      reference: applicant.reference,
      applicant: {
        name: `${applicant.firstName} ${applicant.lastName}`,
        levelName: applicant.level?.name ?? null,
      },
      guardian: { name: applicant.guardianName },
      stage: applicant.stage as 'OFFERED' | 'ACCEPTED' | 'ENROLLED',
      issuedAt: applicant.decidedAt ?? new Date(),
      resumptionDate: term?.nextTermBegins ?? null,
      admissionNo: student?.admissionNo ?? null,
      // Signed by whoever produced it — the person the parent will be dealing with.
      signatory: auth.name,
    });
    await this.db.audit(auth.schoolId, auth.sub, 'applicant.letter', 'Applicant', id);
    return { buffer, filename: `admission-${applicant.reference}.pdf` };
  }
}

/**
 * The public form. Separate controller because it is unauthenticated, un-entitled at the
 * decorator level and must stay that way — mixing it into the staff controller would put one
 * `@Public()` one careless edit away from opening the whole pipeline.
 */
@Controller('admissions/apply')
export class AdmissionsPublicController {
  constructor(private svc: AdmissionsService) {}

  @Get(':schoolId')
  @Public()
  form(@Param('schoolId') schoolId: string) {
    return this.svc.publicLevels(schoolId);
  }

  @Post(':schoolId')
  @Public()
  apply(@Param('schoolId') schoolId: string, @Body() dto: ApplyDto) {
    return this.svc.apply(schoolId, dto);
  }
}

@Controller('admissions')
@RequireEntitlement('sis.admissions')
@Roles('OWNER', 'HEAD', 'FRONT_DESK')
export class AdmissionsController {
  constructor(private svc: AdmissionsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('stage') stage?: ApplicantStage,
    @Query('q') q?: string,
  ) {
    return this.svc.list(user, stage, q);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.detail(user, id);
  }

  @Get(':id/letter')
  async letter(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { buffer, filename } = await this.svc.letter(user, id);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Post(':id/stage')
  move(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MoveStageDto) {
    return this.svc.move(user, id, dto);
  }

  @Post(':id/decision')
  decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DecisionDto) {
    return this.svc.decide(user, id, dto);
  }

  @Post(':id/convert')
  convert(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ConvertDto) {
    return this.svc.convert(user, id, dto);
  }
}

@Module({
  imports: [StudentsModule],
  controllers: [AdmissionsPublicController, AdmissionsController],
  providers: [AdmissionsService],
})
export class AdmissionsModule {}
