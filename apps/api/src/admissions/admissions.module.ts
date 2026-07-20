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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApplicantStage, Gender, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthUser,
  CurrentUser,
  Public,
  RequireEntitlement,
  RequirePermission,
} from '../common/auth';
import { allowedStages, stageMoveError } from '../common/admissions';
import { hasEntitlement } from '../common/entitlements';
import { normalizeMsisdn } from '../common/phone';
import { DOCUMENT_TYPES, MAX_UPLOAD_BYTES, objectKey, storage } from '../common/storage';
import { admissionLetterPdf } from '../common/pdf';
import { StudentsModule, StudentsService } from '../students/students.module';
import { PageQuery, dateWindow, orderBy, pageArgs, toPage } from '../common/list-query';

/**
 * Which columns the pipeline may be sorted by, and what each maps to in Prisma.
 *
 * An allowlist rather than a passthrough — `sort` comes off a query string and is spread into
 * `orderBy`, so an unchecked value would let a caller order by (and therefore probe) a relation
 * this endpoint never meant to reach through. `name` sorts on the surname, because a stack of
 * applications is read the way a register is.
 */
const APPLICANT_SORTS: Record<string, string | string[]> = {
  reference: 'reference',
  name: ['lastName', 'firstName'],
  levelName: 'level.name',
  guardianName: 'guardianName',
  stage: 'stage',
  createdAt: 'createdAt',
  decidedAt: 'decidedAt',
};

/**
 * The pipeline's filters. Extends the shared paging/sorting/date-window base; `from`/`to` filter
 * when the application was filed (see `list`).
 */
class ListApplicantsDto extends PageQuery {
  /**
   * `@IsEnum` is what keeps a mistyped stage a 400 rather than a 500. The stage used to arrive as
   * a bare `@Query('stage')` string and was hand-checked in the service, because an unknown value
   * reaching Prisma's enum filter surfaces as a server error instead of as the typo it is.
   */
  @IsOptional() @IsEnum(ApplicantStage) stage?: ApplicantStage;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsEnum(Gender) gender?: Gender;
  @IsOptional() @IsString() levelId?: string;
}

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

/** Minimal shape of a Multer upload — avoids depending on @types/multer, as elsewhere. */
interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
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
              // The normalized form, not what was typed. Storing "024 123 4567" verbatim meant
              // the applicant never matched the guardian record found by normalized phone, so
              // converting them to a student created a second guardian for the same parent —
              // splitting siblings who should have been recognised as one family.
              guardianPhone: phone,
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

  /**
   * The pipeline, paged.
   *
   * This used to return a bare array capped at `take: 200`. The cap was invisible from the
   * outside, so a school running an intake of several hundred saw 200 applications and had no way
   * to tell that from having received exactly 200 — a parent chasing their reference simply was
   * not there. The envelope carries the total so the screen can say which.
   */
  async list(auth: AuthUser, q: ListApplicantsDto) {
    const { skip, take, page, perPage } = pageArgs(q);
    const filed = dateWindow(q);
    const where = {
      schoolId: auth.schoolId,
      ...(q.stage ? { stage: q.stage } : {}),
      ...(q.gender ? { gender: q.gender } : {}),
      ...(q.levelId ? { levelId: q.levelId } : {}),
      // The window filters when the application arrived, which is what an admissions officer
      // means by "everything since we opened for September" — not when it was decided.
      ...(filed ? { createdAt: filed } : {}),
      ...(q.q
        ? {
            OR: [
              { firstName: { contains: q.q, mode: 'insensitive' as const } },
              { lastName: { contains: q.q, mode: 'insensitive' as const } },
              { reference: { contains: q.q, mode: 'insensitive' as const } },
              { guardianPhone: { contains: q.q } },
            ],
          }
        : {}),
    };

    const [total, applicants, byStage] = await Promise.all([
      this.db.applicant.count({ where }),
      this.db.applicant.findMany({
        where,
        include: { level: { select: { name: true } } },
        orderBy: orderBy<Prisma.ApplicantOrderByWithRelationInput>(q, APPLICANT_SORTS, {
          createdAt: 'desc',
        }),
        skip,
        take,
      }),
      /**
       * Counted across the whole school, deliberately unfiltered.
       *
       * These are the numbers on the stage chips, and a chip has to say how many applications sit
       * at that stage — not how many of the current filter's matches do. Narrowing to the `where`
       * above would make every chip except the selected one read zero the moment a stage is
       * chosen, which is precisely when the others matter.
       */
      this.db.applicant.groupBy({
        by: ['stage'],
        where: { schoolId: auth.schoolId },
        _count: true,
      }),
    ]);

    const rows = applicants.map((a) => ({
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
    }));

    return {
      ...toPage(rows, total, { page, perPage }),
      counts: byStage.reduce(
        (acc, r) => ({ ...acc, [r.stage]: r._count }),
        {} as Record<string, number>,
      ),
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
        /**
         * A staff note is appended, never substituted.
         *
         * `notes` holds what the parent wrote on the application — often the only free-form
         * context about the child anywhere in the system. Assigning `dto.note` overwrote it on
         * the very first stage move that carried one, so the parent's own words were destroyed
         * by the office's first comment on them.
         */
        ...(dto.note
          ? {
              notes: applicant.notes ? `${applicant.notes}\n\n${dto.note}` : dto.note,
            }
          : {}),
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
   * Deliberately delegates to StudentsService.create rather than writing a Student row here:
   * admission numbering, the audit trail and every rule enrolment obeys live in one place, and a
   * second door onto the roll is how they drift apart. Converting twice returns the student
   * already created rather than making a second one — the applicant's studentId is the record of
   * what happened.
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

    // Papers handed in at application follow the child onto their student record — same storage
    // keys, so nothing is re-uploaded and nothing is asked for twice. Moved rather than shared:
    // two rows over one key would make either side's delete break the other.
    const papers = await this.db.applicantDocument.findMany({
      where: { schoolId: auth.schoolId, applicantId: id },
    });
    for (const p of papers) {
      await this.db.studentDocument.create({
        data: {
          schoolId: auth.schoolId,
          studentId: student.id,
          kind: p.kind,
          filename: p.filename,
          contentType: p.contentType,
          size: p.size,
          key: p.key,
          uploadedById: p.uploadedById,
        },
      });
    }
    if (papers.length > 0) {
      await this.db.applicantDocument.deleteMany({
        where: { schoolId: auth.schoolId, applicantId: id },
      });
    }
    await this.db.audit(auth.schoolId, auth.sub, 'applicant.convert', 'Applicant', id, {
      studentId: student.id,
      reference: applicant.reference,
    });
    return { studentId: student.id, stage: 'ENROLLED' as const, alreadyConverted: false };
  }

  // ── Documents ──────────────────────────────────────────────────────

  async listDocuments(auth: AuthUser, applicantId: string) {
    await this.own(auth, applicantId);
    const docs = await this.db.applicantDocument.findMany({
      where: { schoolId: auth.schoolId, applicantId },
      orderBy: { createdAt: 'desc' },
    });
    return docs.map((d) => ({
      id: d.id,
      kind: d.kind,
      filename: d.filename,
      contentType: d.contentType,
      size: d.size,
      createdAt: d.createdAt,
    }));
  }

  async uploadDocument(auth: AuthUser, applicantId: string, kind: string, file: UploadedFileLike) {
    if (!file) throw new BadRequestException('Choose a file');
    if (!DOCUMENT_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('That file type is not accepted');
    }
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('That file is too large');
    await this.own(auth, applicantId);

    const key = objectKey(auth.schoolId, 'applicant-documents', applicantId, file.originalname);
    await storage().put(key, file.buffer, file.mimetype);
    const doc = await this.db.applicantDocument.create({
      data: {
        schoolId: auth.schoolId,
        applicantId,
        kind: kind || 'OTHER',
        filename: file.originalname,
        contentType: file.mimetype,
        size: file.size,
        key,
        uploadedById: auth.sub,
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'applicant.document.upload',
      'Applicant',
      applicantId,
      { filename: file.originalname },
    );
    return { id: doc.id, filename: doc.filename };
  }

  async readDocument(auth: AuthUser, docId: string) {
    const doc = await this.db.applicantDocument.findFirst({
      where: { id: docId, schoolId: auth.schoolId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return { buffer: await storage().get(doc.key), doc };
  }

  async deleteDocument(auth: AuthUser, docId: string) {
    const doc = await this.db.applicantDocument.findFirst({
      where: { id: docId, schoolId: auth.schoolId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    await storage()
      .delete(doc.key)
      .catch(() => undefined);
    await this.db.applicantDocument.delete({ where: { id: docId } });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'applicant.document.delete',
      'Applicant',
      doc.applicantId,
      { filename: doc.filename },
    );
    return { deleted: true };
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
export class AdmissionsController {
  constructor(private svc: AdmissionsService) {}

  @Get()
  @RequirePermission('admissions.view')
  list(@CurrentUser() user: AuthUser, @Query() query: ListApplicantsDto) {
    return this.svc.list(user, query);
  }

  @Get(':id')
  @RequirePermission('admissions.view')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.detail(user, id);
  }

  @Get(':id/letter')
  @RequirePermission('admissions.view')
  async letter(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { buffer, filename } = await this.svc.letter(user, id);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Post(':id/stage')
  @RequirePermission('admissions.manage')
  move(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MoveStageDto) {
    return this.svc.move(user, id, dto);
  }

  @Post(':id/decision')
  @RequirePermission('admissions.manage')
  decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DecisionDto) {
    return this.svc.decide(user, id, dto);
  }

  // Both, because converting enrols a child: moving the applicant and creating the student are
  // two distinct authorities and this route exercises them together.
  @Get(':id/documents')
  @RequirePermission('admissions.view')
  documents(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.listDocuments(user, id);
  }

  @Post(':id/documents')
  @RequirePermission('admissions.manage')
  @UseInterceptors(FileInterceptor('file'))
  uploadDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('kind') kind: string,
    @UploadedFile() file: UploadedFileLike,
  ) {
    return this.svc.uploadDocument(user, id, kind, file);
  }

  @Get('documents/:docId')
  @RequirePermission('admissions.view')
  async readDocument(@CurrentUser() user: AuthUser, @Param('docId') docId: string) {
    const { buffer, doc } = await this.svc.readDocument(user, docId);
    return new StreamableFile(buffer, {
      type: doc.contentType,
      disposition: `attachment; filename="${doc.filename.replace(/"/g, '')}"`,
    });
  }

  @Delete('documents/:docId')
  @RequirePermission('admissions.manage')
  deleteDocument(@CurrentUser() user: AuthUser, @Param('docId') docId: string) {
    return this.svc.deleteDocument(user, docId);
  }

  @Post(':id/convert')
  @RequirePermission('admissions.manage', 'students.create')
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
