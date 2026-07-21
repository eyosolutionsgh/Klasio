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
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  Min,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MinLength,
} from 'class-validator';
import { BrandPhotoSlot, LevelCategory, ReportTemplate } from '@prisma/client';

/**
 * The sign-in pages a school may put its own photograph on.
 *
 * Validated here rather than with a DTO because the slot rides in the path, not the body — and an
 * unchecked value would reach Prisma as an enum it does not know, producing a 500 where the honest
 * answer is "that is not one of the pages".
 */
const PHOTO_SLOTS: BrandPhotoSlot[] = ['STAFF', 'FAMILY', 'STUDENT', 'GENERAL'];

function assertSlot(raw: string): BrandPhotoSlot {
  const slot = raw.toUpperCase() as BrandPhotoSlot;
  if (!PHOTO_SLOTS.includes(slot)) {
    throw new BadRequestException(
      `Unknown page "${raw}" — expected one of ${PHOTO_SLOTS.join(', ')}`,
    );
  }
  return slot;
}
import { FileInterceptor } from '@nestjs/platform-express';
import { PrismaService } from '../prisma/prisma.service';
import { checkTemplate, previewAdmissionNo } from '../common/admission-no';
import { AuthUser, CurrentUser, RequireEntitlement, RequirePermission } from '../common/auth';
import { IMAGE_TYPES, MAX_UPLOAD_BYTES, objectKey, storage } from '../common/storage';

const CATEGORIES = ['PRE_SCHOOL', 'PRIMARY', 'JHS', 'SHS'] as const;

/** Minimal shape of a Multer upload — avoids depending on @types/multer. */
interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

class SchoolSettingsDto {
  @IsOptional() @IsIn(['GES', 'MODERN']) reportTemplate?: ReportTemplate;
  /// "No fees, no report card". Off unless a school turns it on — see common/fee-clearance.ts.
  @IsOptional() @IsBoolean() reportsRequireFeeClearance?: boolean;
  /// The school's own admission-number format. Validated in the service, where the message can
  /// explain what is wrong rather than just rejecting a pattern.
  @IsOptional() @IsString() admissionNoFormat?: string;
  /// Lets a school correct the counter — after importing historic records, say. Never lowered
  /// silently past numbers already issued; the service refuses that.
  @IsOptional() @IsInt() @Min(1) admissionNoNext?: number;
}

/** Everything a school puts on its own letterhead — contact details plus branding. */
class SchoolProfileDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() motto?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsUrl({ require_protocol: false }) website?: string;
  // Anchored 6-digit hex: the value is interpolated into a CSS custom property, so nothing
  // else may ever reach the stylesheet.
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Use a colour like #0d3627' })
  brandColor?: string;
}

class AcademicYearDto {
  @IsString() @MinLength(4) name: string;
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
}

class TermDto {
  @IsString() @MinLength(2) name: string;
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
  @IsOptional() @IsDateString() nextTermBegins?: string;
}

class UpdateTermDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsDateString() nextTermBegins?: string;
}

class LevelDto {
  @IsString() @MinLength(1) name: string;
  @IsIn(CATEGORIES) category: LevelCategory;
  @IsInt() order: number;
  @IsOptional() @IsString() gradingSchemeId?: string;
}

class UpdateLevelDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsIn(CATEGORIES) category?: LevelCategory;
  @IsOptional() @IsInt() order?: number;
  @IsOptional() @IsString() gradingSchemeId?: string | null;
}

class ClassDto {
  @IsString() levelId: string;
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() classTeacherId?: string;
  /** Empty string clears it back to the main site. */
  @IsOptional() @IsString() campusId?: string;
}

/** PATCH validates what PATCH sends — a partial. The full ClassDto would demand every field. */
class UpdateClassDto {
  @IsOptional() @IsString() levelId?: string;
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() classTeacherId?: string;
  @IsOptional() @IsString() campusId?: string;
}

class CampusDto {
  @IsString() @MinLength(2) name: string;
  @IsOptional() @IsString() address?: string;
}

class SubjectDto {
  @IsString() @MinLength(2) name: string;
  @IsString() @MinLength(1) code: string;
  @IsOptional() @IsBoolean() isCore?: boolean;
}

@Injectable()
export class SchoolsService {
  constructor(private db: PrismaService) {}

  async structure(auth: AuthUser) {
    const [levels, classes, subjects, years] = await Promise.all([
      this.db.level.findMany({ where: { schoolId: auth.schoolId }, orderBy: { order: 'asc' } }),
      this.db.classRoom.findMany({
        where: { schoolId: auth.schoolId },
        include: {
          level: true,
          campus: { select: { name: true } },
          _count: { select: { students: { where: { status: 'ACTIVE' } } } },
        },
        orderBy: { level: { order: 'asc' } },
      }),
      this.db.subject.findMany({
        where: { schoolId: auth.schoolId },
        orderBy: [{ isCore: 'desc' }, { name: 'asc' }],
      }),
      this.db.academicYear.findMany({
        where: { schoolId: auth.schoolId },
        include: { terms: { orderBy: { startDate: 'asc' } } },
        orderBy: { startDate: 'desc' },
      }),
    ]);
    return {
      levels,
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        level: c.level.name,
        levelId: c.levelId,
        category: c.level.category,
        campusId: c.campusId,
        campus: c.campus?.name ?? null,
        studentCount: c._count.students,
      })),
      subjects,
      years,
    };
  }

  /** School-level profile settings, currently the terminal-report layout. */
  async updateSettings(auth: AuthUser, dto: SchoolSettingsDto) {
    if (dto.admissionNoFormat !== undefined) {
      const check = checkTemplate(dto.admissionNoFormat);
      if (!check.ok) throw new BadRequestException(check.message);
    }

    if (dto.admissionNoNext !== undefined) {
      // Refuse to wind the counter back behind numbers already issued. A school correcting the
      // sequence after importing historic records is reasonable; silently reissuing a number a
      // child already carries is not.
      const highest = await this.db.student.findMany({
        where: { schoolId: auth.schoolId },
        select: { admissionNo: true },
      });
      const maxIssued = highest.reduce((max, st) => {
        const digits = st.admissionNo.replace(/\D/g, '');
        return digits ? Math.max(max, Number(digits)) : max;
      }, 0);
      if (dto.admissionNoNext <= maxIssued) {
        throw new BadRequestException(
          `That would reissue numbers already in use — the highest so far is ${maxIssued}, so start at ${maxIssued + 1} or above.`,
        );
      }
    }

    const school = await this.db.school.update({
      where: { id: auth.schoolId },
      data: {
        ...(dto.reportTemplate ? { reportTemplate: dto.reportTemplate } : {}),
        ...(dto.reportsRequireFeeClearance !== undefined
          ? { reportsRequireFeeClearance: dto.reportsRequireFeeClearance }
          : {}),
        ...(dto.admissionNoFormat !== undefined
          ? { admissionNoFormat: dto.admissionNoFormat.trim() }
          : {}),
        ...(dto.admissionNoNext !== undefined ? { admissionNoNext: dto.admissionNoNext } : {}),
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'school.settings.update',
      'School',
      auth.schoolId,
      dto as object,
    );
    return {
      reportTemplate: school.reportTemplate,
      reportsRequireFeeClearance: school.reportsRequireFeeClearance,
      admissionNoFormat: school.admissionNoFormat,
      admissionNoNext: school.admissionNoNext,
      // A worked example, so the school sees the shape it just chose.
      example: previewAdmissionNo(school.admissionNoFormat),
    };
  }

  /** The school's own details — shown in settings and on the top bar. */
  async profile(auth: AuthUser) {
    const s = await this.db.school.findUnique({ where: { id: auth.schoolId } });
    if (!s) throw new NotFoundException('School not found');
    return {
      id: s.id,
      name: s.name,
      motto: s.motto,
      address: s.address,
      phone: s.phone,
      email: s.email,
      region: s.region,
      country: s.country,
      website: s.website,
      currency: s.currency,
      tier: s.tier,
      brandColor: s.brandColor,
      reportTemplate: s.reportTemplate,
      reportsRequireFeeClearance: s.reportsRequireFeeClearance,
      hasLogo: !!s.logoUrl,
    };
  }

  async updateProfile(auth: AuthUser, dto: SchoolProfileDto) {
    await this.db.school.update({
      where: { id: auth.schoolId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.motto !== undefined ? { motto: dto.motto } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.region !== undefined ? { region: dto.region } : {}),
        ...(dto.website !== undefined ? { website: dto.website } : {}),
        ...(dto.brandColor !== undefined ? { brandColor: dto.brandColor } : {}),
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'school.profile.update',
      'School',
      auth.schoolId,
      dto as object,
    );
    return this.profile(auth);
  }

  async uploadLogo(auth: AuthUser, file: UploadedFileLike) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!IMAGE_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('The logo must be a JPEG, PNG or WebP image');
    }
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('That image is too large');

    const key = objectKey(auth.schoolId, 'logo', auth.schoolId, file.originalname);
    await storage().put(key, file.buffer, file.mimetype);
    // The type is stored alongside the key: the crest is now served to the open internet by
    // GET /public/branding/logo, and answering "image/png" for a jpeg there is us being wrong and
    // the browser being forgiving.
    await this.db.school.update({
      where: { id: auth.schoolId },
      data: { logoUrl: key, logoMimeType: file.mimetype },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'school.logo.upload', 'School', auth.schoolId);
    return { ok: true };
  }

  /** Bytes for the crest, and what they are. Still no public URLs — see common/storage.ts. */
  async readLogo(auth: AuthUser) {
    const s = await this.db.school.findUnique({ where: { id: auth.schoolId } });
    if (!s?.logoUrl) throw new NotFoundException('No logo uploaded');
    return { buf: await storage().get(s.logoUrl), mimeType: s.logoMimeType ?? 'image/png' };
  }

  async removeLogo(auth: AuthUser) {
    const s = await this.db.school.findUnique({ where: { id: auth.schoolId } });
    if (s?.logoUrl) await storage().delete(s.logoUrl);
    await this.db.school.update({
      where: { id: auth.schoolId },
      data: { logoUrl: null, logoMimeType: null },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'school.logo.remove', 'School', auth.schoolId);
    return { ok: true };
  }

  // ── Sign-in page photographs ───────────────────────────────────────

  /**
   * Which slots this school has replaced.
   *
   * Returns the slots only, never the keys: a storage key is not a secret but it is not the
   * school's business either, and the settings screen only needs to know whether to say "Default"
   * or "Yours".
   */
  async listPhotos(auth: AuthUser) {
    const rows = await this.db.brandPhoto.findMany({
      where: { schoolId: auth.schoolId },
      select: { slot: true, filename: true, updatedAt: true },
      orderBy: { slot: 'asc' },
    });
    return rows;
  }

  /**
   * Replace the picture on one sign-in page.
   *
   * An upsert on `(schoolId, slot)`, and the old object is deleted after the new one is written —
   * in that order, so a failed upload leaves the school with the picture it already had rather
   * than with nothing.
   */
  async uploadPhoto(auth: AuthUser, slot: BrandPhotoSlot, file: UploadedFileLike) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!IMAGE_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('The picture must be a JPEG, PNG or WebP image');
    }
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('That image is too large');

    const existing = await this.db.brandPhoto.findUnique({
      where: { schoolId_slot: { schoolId: auth.schoolId, slot } },
    });

    const key = objectKey(auth.schoolId, 'brand-photo', slot, file.originalname);
    await storage().put(key, file.buffer, file.mimetype);

    const data = {
      key,
      filename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedById: auth.sub,
    };
    await this.db.brandPhoto.upsert({
      where: { schoolId_slot: { schoolId: auth.schoolId, slot } },
      create: { schoolId: auth.schoolId, slot, ...data },
      update: data,
    });

    // Only once the row points at the new object. A storage delete that fails is not worth
    // failing the request over — it leaves an orphan, not a broken page.
    if (existing)
      await storage()
        .delete(existing.key)
        .catch(() => undefined);

    await this.db.audit(auth.schoolId, auth.sub, 'school.photo.upload', 'BrandPhoto', slot);
    return { ok: true, slot };
  }

  /** Put a slot back to the picture the product ships with. */
  async removePhoto(auth: AuthUser, slot: BrandPhotoSlot) {
    const existing = await this.db.brandPhoto.findUnique({
      where: { schoolId_slot: { schoolId: auth.schoolId, slot } },
    });
    if (!existing) throw new NotFoundException('No picture set for that page');
    await this.db.brandPhoto.delete({ where: { id: existing.id } });
    await storage()
      .delete(existing.key)
      .catch(() => undefined);
    await this.db.audit(auth.schoolId, auth.sub, 'school.photo.remove', 'BrandPhoto', slot);
    return { ok: true };
  }

  // ── Academic years & terms ─────────────────────────────────────────

  async createYear(auth: AuthUser, dto: AcademicYearDto) {
    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new BadRequestException('The year must end after it starts');
    }
    const year = await this.db.academicYear.create({
      data: {
        schoolId: auth.schoolId,
        name: dto.name,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'school.year.create', 'AcademicYear', year.id, {
      name: dto.name,
    });
    return year;
  }

  async createTerm(auth: AuthUser, yearId: string, dto: TermDto) {
    const year = await this.db.academicYear.findFirst({
      where: { id: yearId, schoolId: auth.schoolId },
    });
    if (!year) throw new NotFoundException('Academic year not found');
    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new BadRequestException('The term must end after it starts');
    }
    const term = await this.db.term.create({
      data: {
        academicYearId: yearId,
        name: dto.name,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        nextTermBegins: dto.nextTermBegins ? new Date(dto.nextTermBegins) : null,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'school.term.create', 'Term', term.id, {
      name: dto.name,
    });
    return term;
  }

  async updateTerm(auth: AuthUser, termId: string, dto: UpdateTermDto) {
    const term = await this.db.term.findFirst({
      where: { id: termId, academicYear: { schoolId: auth.schoolId } },
    });
    if (!term) throw new NotFoundException('Term not found');

    /**
     * The same rule createTerm applies, which editing quietly skipped.
     *
     * A term is not just a label: `FeesService.asOfTerm` decides what a family owes by finding
     * every term starting on or before this one, so a term that ends before it begins puts the
     * ordering — and the arrears carried into it — into a state nothing downstream expects.
     * Only the fields being changed are known, so the check runs against the merged dates.
     */
    const startDate = dto.startDate !== undefined ? new Date(dto.startDate) : term.startDate;
    const endDate = dto.endDate !== undefined ? new Date(dto.endDate) : term.endDate;
    if (endDate <= startDate) {
      throw new BadRequestException('The term must end after it starts');
    }

    const updated = await this.db.term.update({
      where: { id: termId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.startDate !== undefined ? { startDate: new Date(dto.startDate) } : {}),
        ...(dto.endDate !== undefined ? { endDate: new Date(dto.endDate) } : {}),
        ...(dto.nextTermBegins !== undefined
          ? { nextTermBegins: dto.nextTermBegins ? new Date(dto.nextTermBegins) : null }
          : {}),
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'school.term.update',
      'Term',
      termId,
      dto as object,
    );
    return updated;
  }

  /**
   * Make one year+term current. Exactly one of each may be current per school, so the previous
   * flags are cleared in the same transaction — a half-applied switch would make "current term"
   * ambiguous for invoicing, attendance and reports.
   */
  async setCurrentTerm(auth: AuthUser, termId: string) {
    const term = await this.db.term.findFirst({
      where: { id: termId, academicYear: { schoolId: auth.schoolId } },
      include: { academicYear: true },
    });
    if (!term) throw new NotFoundException('Term not found');

    await this.db.academicYear.updateMany({
      where: { schoolId: auth.schoolId },
      data: { isCurrent: false },
    });
    await this.db.term.updateMany({
      where: { academicYear: { schoolId: auth.schoolId } },
      data: { isCurrent: false },
    });
    await this.db.academicYear.update({
      where: { id: term.academicYearId },
      data: { isCurrent: true },
    });
    await this.db.term.update({ where: { id: termId }, data: { isCurrent: true } });
    await this.db.audit(auth.schoolId, auth.sub, 'school.term.setCurrent', 'Term', termId, {
      term: term.name,
      year: term.academicYear.name,
    });
    return { currentTerm: term.name, currentYear: term.academicYear.name };
  }

  // ── Levels, classes, subjects ──────────────────────────────────────

  async createLevel(auth: AuthUser, dto: LevelDto) {
    const level = await this.db.level.create({
      data: {
        schoolId: auth.schoolId,
        name: dto.name,
        category: dto.category,
        order: dto.order,
        gradingSchemeId: dto.gradingSchemeId ?? null,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'school.level.create', 'Level', level.id, {
      name: dto.name,
    });
    return level;
  }

  async updateLevel(auth: AuthUser, id: string, dto: UpdateLevelDto) {
    const existing = await this.db.level.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!existing) throw new NotFoundException('Level not found');
    if (dto.gradingSchemeId) {
      const scheme = await this.db.gradingScheme.findFirst({
        where: { id: dto.gradingSchemeId, schoolId: auth.schoolId },
      });
      if (!scheme) throw new NotFoundException('Grading scheme not found');
    }
    const level = await this.db.level.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
        ...(dto.gradingSchemeId !== undefined
          ? { gradingSchemeId: dto.gradingSchemeId || null }
          : {}),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'school.level.update', 'Level', id, dto as object);
    return level;
  }

  async deleteLevel(auth: AuthUser, id: string) {
    const level = await this.db.level.findFirst({
      where: { id, schoolId: auth.schoolId },
      include: { _count: { select: { classes: true } } },
    });
    if (!level) throw new NotFoundException('Level not found');
    if (level._count.classes > 0) {
      throw new BadRequestException('Remove this level’s classes before deleting it');
    }
    await this.db.level.delete({ where: { id } });
    await this.db.audit(auth.schoolId, auth.sub, 'school.level.delete', 'Level', id);
    return { deleted: true };
  }

  /** A campusId from the body is untrusted until found inside the caller's school. */
  private async resolveCampus(auth: AuthUser, campusId?: string): Promise<string | null> {
    if (!campusId) return null;
    const campus = await this.db.campus.findFirst({
      where: { id: campusId, schoolId: auth.schoolId },
    });
    if (!campus) throw new NotFoundException('Campus not found');
    return campus.id;
  }

  async createClass(auth: AuthUser, dto: ClassDto) {
    const level = await this.db.level.findFirst({
      where: { id: dto.levelId, schoolId: auth.schoolId },
    });
    if (!level) throw new NotFoundException('Level not found');
    const cls = await this.db.classRoom.create({
      data: {
        schoolId: auth.schoolId,
        levelId: dto.levelId,
        name: dto.name,
        classTeacherId: dto.classTeacherId ?? null,
        campusId: await this.resolveCampus(auth, dto.campusId),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'school.class.create', 'ClassRoom', cls.id, {
      name: dto.name,
    });
    return cls;
  }

  async updateClass(auth: AuthUser, id: string, dto: Partial<ClassDto>) {
    const existing = await this.db.classRoom.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!existing) throw new NotFoundException('Class not found');
    const cls = await this.db.classRoom.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.levelId !== undefined ? { levelId: dto.levelId } : {}),
        ...(dto.classTeacherId !== undefined ? { classTeacherId: dto.classTeacherId || null } : {}),
        ...(dto.campusId !== undefined
          ? { campusId: await this.resolveCampus(auth, dto.campusId || undefined) }
          : {}),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'school.class.update', 'ClassRoom', id, dto);
    return cls;
  }

  // ── Campuses ───────────────────────────────────────────────────────

  async campuses(auth: AuthUser) {
    const rows = await this.db.campus.findMany({
      where: { schoolId: auth.schoolId },
      include: { _count: { select: { classes: true } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      address: c.address,
      classCount: c._count.classes,
    }));
  }

  async createCampus(auth: AuthUser, dto: CampusDto) {
    const campus = await this.db.campus.create({
      data: { schoolId: auth.schoolId, name: dto.name.trim(), address: dto.address?.trim() },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'school.campus.create', 'Campus', campus.id, {
      name: dto.name,
    });
    return campus;
  }

  async updateCampus(auth: AuthUser, id: string, dto: Partial<CampusDto>) {
    const existing = await this.db.campus.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!existing) throw new NotFoundException('Campus not found');
    return this.db.campus.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.address !== undefined ? { address: dto.address?.trim() || null } : {}),
      },
    });
  }

  async deleteCampus(auth: AuthUser, id: string) {
    const existing = await this.db.campus.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!existing) throw new NotFoundException('Campus not found');
    // Classes fall back to the main site (SetNull) — a campus is a label, not a container.
    await this.db.campus.delete({ where: { id } });
    await this.db.audit(auth.schoolId, auth.sub, 'school.campus.delete', 'Campus', id, {
      name: existing.name,
    });
    return { deleted: true };
  }

  async deleteClass(auth: AuthUser, id: string) {
    const cls = await this.db.classRoom.findFirst({
      where: { id, schoolId: auth.schoolId },
      include: { _count: { select: { students: true } } },
    });
    if (!cls) throw new NotFoundException('Class not found');
    if (cls._count.students > 0) {
      throw new BadRequestException('Move this class’s students before deleting it');
    }
    await this.db.classRoom.delete({ where: { id } });
    await this.db.audit(auth.schoolId, auth.sub, 'school.class.delete', 'ClassRoom', id);
    return { deleted: true };
  }

  async createSubject(auth: AuthUser, dto: SubjectDto) {
    const subject = await this.db.subject.create({
      data: {
        schoolId: auth.schoolId,
        name: dto.name,
        code: dto.code.toUpperCase(),
        isCore: dto.isCore ?? false,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'school.subject.create', 'Subject', subject.id, {
      name: dto.name,
    });
    return subject;
  }

  async deleteSubject(auth: AuthUser, id: string) {
    const subject = await this.db.subject.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!subject) throw new NotFoundException('Subject not found');
    const scores = await this.db.score.count({ where: { schoolId: auth.schoolId, subjectId: id } });
    if (scores > 0) {
      throw new BadRequestException(
        'This subject already has marks recorded and cannot be deleted',
      );
    }
    await this.db.subject.delete({ where: { id } });
    await this.db.audit(auth.schoolId, auth.sub, 'school.subject.delete', 'Subject', id);
    return { deleted: true };
  }
}

@Controller('school')
export class SchoolsController {
  constructor(private svc: SchoolsService) {}

  @Get('structure')
  structure(@CurrentUser() user: AuthUser) {
    return this.svc.structure(user);
  }

  @Patch('settings')
  @RequirePermission('school.settings')
  updateSettings(@CurrentUser() user: AuthUser, @Body() dto: SchoolSettingsDto) {
    return this.svc.updateSettings(user, dto);
  }

  @Get('profile')
  profile(@CurrentUser() user: AuthUser) {
    return this.svc.profile(user);
  }

  @Patch('profile')
  @RequirePermission('school.branding')
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: SchoolProfileDto) {
    return this.svc.updateProfile(user, dto);
  }

  @Post('logo')
  @RequirePermission('school.branding')
  @UseInterceptors(FileInterceptor('file'))
  uploadLogo(@CurrentUser() user: AuthUser, @UploadedFile() file: UploadedFileLike) {
    return this.svc.uploadLogo(user, file);
  }

  // Any signed-in member of the school may render the crest — it is on every page.
  @Get('logo')
  async logo(@CurrentUser() user: AuthUser) {
    const { buf, mimeType } = await this.svc.readLogo(user);
    return new StreamableFile(buf, { type: mimeType });
  }

  @Delete('logo')
  @RequirePermission('school.branding')
  removeLogo(@CurrentUser() user: AuthUser) {
    return this.svc.removeLogo(user);
  }

  @Get('photos')
  @RequirePermission('school.branding')
  listPhotos(@CurrentUser() user: AuthUser) {
    return this.svc.listPhotos(user);
  }

  @Post('photos/:slot')
  @RequirePermission('school.branding')
  @UseInterceptors(FileInterceptor('file'))
  uploadPhoto(
    @CurrentUser() user: AuthUser,
    @Param('slot') slot: string,
    @UploadedFile() file: UploadedFileLike,
  ) {
    return this.svc.uploadPhoto(user, assertSlot(slot), file);
  }

  @Delete('photos/:slot')
  @RequirePermission('school.branding')
  removePhoto(@CurrentUser() user: AuthUser, @Param('slot') slot: string) {
    return this.svc.removePhoto(user, assertSlot(slot));
  }

  @Post('years')
  @RequirePermission('school.settings')
  createYear(@CurrentUser() user: AuthUser, @Body() dto: AcademicYearDto) {
    return this.svc.createYear(user, dto);
  }

  @Post('years/:id/terms')
  @RequirePermission('school.settings')
  createTerm(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: TermDto) {
    return this.svc.createTerm(user, id, dto);
  }

  @Patch('terms/:id')
  @RequirePermission('school.settings')
  updateTerm(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateTermDto) {
    return this.svc.updateTerm(user, id, dto);
  }

  @Post('terms/:id/current')
  @RequirePermission('school.settings')
  setCurrent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.setCurrentTerm(user, id);
  }

  @Post('levels')
  @RequirePermission('school.settings')
  createLevel(@CurrentUser() user: AuthUser, @Body() dto: LevelDto) {
    return this.svc.createLevel(user, dto);
  }

  @Patch('levels/:id')
  @RequirePermission('school.settings')
  updateLevel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateLevelDto) {
    return this.svc.updateLevel(user, id, dto);
  }

  @Delete('levels/:id')
  @RequirePermission('school.settings')
  deleteLevel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteLevel(user, id);
  }

  @Get('campuses')
  campuses(@CurrentUser() user: AuthUser) {
    return this.svc.campuses(user);
  }

  @Post('campuses')
  @RequirePermission('school.settings')
  @RequireEntitlement('platform.multicampus')
  createCampus(@CurrentUser() user: AuthUser, @Body() dto: CampusDto) {
    return this.svc.createCampus(user, dto);
  }

  @Patch('campuses/:id')
  @RequirePermission('school.settings')
  @RequireEntitlement('platform.multicampus')
  updateCampus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: Partial<CampusDto>,
  ) {
    return this.svc.updateCampus(user, id, dto);
  }

  @Delete('campuses/:id')
  @RequirePermission('school.settings')
  @RequireEntitlement('platform.multicampus')
  deleteCampus(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteCampus(user, id);
  }

  @Post('classes')
  @RequirePermission('school.settings')
  createClass(@CurrentUser() user: AuthUser, @Body() dto: ClassDto) {
    return this.svc.createClass(user, dto);
  }

  @Patch('classes/:id')
  @RequirePermission('school.settings')
  updateClass(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateClassDto) {
    return this.svc.updateClass(user, id, dto);
  }

  @Delete('classes/:id')
  @RequirePermission('school.settings')
  deleteClass(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteClass(user, id);
  }

  @Post('subjects')
  @RequirePermission('school.settings')
  createSubject(@CurrentUser() user: AuthUser, @Body() dto: SubjectDto) {
    return this.svc.createSubject(user, dto);
  }

  @Delete('subjects/:id')
  @RequirePermission('school.settings')
  deleteSubject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteSubject(user, id);
  }
}

@Module({ controllers: [SchoolsController], providers: [SchoolsService] })
export class SchoolsModule {}
