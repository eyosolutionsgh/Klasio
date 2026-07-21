import {
  BadRequestException,
  ForbiddenException,
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
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CustodyFlag, Gender, Prisma, StudentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { checkTemplate, DEFAULT_TEMPLATE, formatAdmissionNo } from '../common/admission-no';
import { studentIdCardSheet, type StudentIdCardData } from '../common/pdf';
import { AuthUser, CurrentUser, RequireEntitlement, RequirePermission } from '../common/auth';
import { demoteOthers, reconcileLink, successorPrimary } from '../common/guardianship';
import { normalizeMsisdn } from '../common/phone';
import { toCsv, toXlsx, Cell } from '../common/export';
import {
  DOCUMENT_TYPES,
  IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  objectKey,
  storage,
} from '../common/storage';
import { balanceOf, reversedIds } from '../common/ledger';
import { isFinalClass, suggestNextClass, type ClassLike } from '../common/promotion';
import { PageQuery, dateWindow, orderBy, pageArgs, toPage } from '../common/list-query';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Which columns the register may be sorted by, and what each maps to in Prisma.
 *
 * An allowlist rather than a passthrough — `sort` comes off a query string, so an unchecked value
 * would let a caller order by a relation this endpoint never meant to reach through. Name sorts on
 * the surname because that is what a register is alphabetised by; `guardians` is absent on purpose,
 * since sorting by a related collection would mean sorting by whichever guardian Prisma picked.
 */
const STUDENT_SORTS: Record<string, string | string[]> = {
  admissionNo: 'admissionNo',
  name: ['lastName', 'firstName'],
  className: 'classRoom.name',
  gender: 'gender',
  enrolledAt: 'enrolledAt',
  dateOfBirth: 'dateOfBirth',
  status: 'status',
};

/** Minimal shape of a Multer upload — avoids depending on @types/multer. */
interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * The register's filters. Extends the shared paging/sorting/date-window base; `from`/`to` filter
 * the enrolment date (see `list`).
 */
class ListStudentsDto extends PageQuery {
  @IsOptional() @IsString() classId?: string;
  /** Students derive their campus through their class. */
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsEnum(StudentStatus) status?: StudentStatus;
  @IsOptional() @IsEnum(Gender) gender?: Gender;
}

class CreateStudentDto {
  @IsString() @MinLength(2) firstName: string;
  @IsString() @MinLength(2) lastName: string;
  @IsOptional() @IsString() otherNames?: string;
  @IsEnum(Gender) gender: Gender;
  @IsDateString() dateOfBirth: string;
  @IsString() classId: string;
  @IsOptional() @IsString() guardianFirstName?: string;
  @IsOptional() @IsString() guardianLastName?: string;
  @IsOptional() @IsString() guardianPhone?: string;
  @IsOptional() @IsString() guardianRelationship?: string;
}

class UpdateStudentDto {
  @IsOptional() @IsString() @MinLength(2) firstName?: string;
  @IsOptional() @IsString() @MinLength(2) lastName?: string;
  @IsOptional() @IsString() otherNames?: string;
  @IsOptional() @IsEnum(Gender) gender?: Gender;
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() medicalNotes?: string;
}

class AddGuardianDto {
  @IsString() @MinLength(2) firstName: string;
  @IsString() @MinLength(2) lastName: string;
  @IsString() phone: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() relationship?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsBoolean() canPickup?: boolean;
  @IsOptional() @IsEnum(CustodyFlag) custodyFlag?: CustodyFlag;
  @IsOptional() @IsBoolean() whatsappOptIn?: boolean;
}

class UpdateGuardianDto {
  @IsOptional() @IsString() @MinLength(2) firstName?: string;
  @IsOptional() @IsString() @MinLength(2) lastName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() relationship?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsBoolean() canPickup?: boolean;
  @IsOptional() @IsEnum(CustodyFlag) custodyFlag?: CustodyFlag;
  @IsOptional() @IsBoolean() whatsappOptIn?: boolean;
}

class PromotionDecisionDto {
  @IsString() studentId: string;
  @IsIn(['PROMOTE', 'REPEAT', 'GRADUATE']) action: 'PROMOTE' | 'REPEAT' | 'GRADUATE';
  /** Required for PROMOTE, meaningless otherwise — the service enforces that, not the shape. */
  @IsOptional() @IsString() toClassId?: string;
}

class PromotionRunDto {
  @IsString() fromClassId: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionDecisionDto)
  decisions: PromotionDecisionDto[];
  /**
   * How many children the caller believes they are graduating.
   *
   * Graduation cannot be undone in the product, so it is not enough for the payload to contain
   * GRADUATE — the reviewer has to have seen the number and agreed to it. A mismatch means the
   * roll changed under them while they were deciding, and the run stops rather than guessing.
   */
  @IsOptional() @IsNumber() confirmGraduating?: number;
}

class PromoteDto {
  @IsString() fromClassId: string;
  @IsOptional() @IsString() toClassId?: string;
  /**
   * Graduating must be asked for, not inferred from a missing field.
   *
   * A destination class that failed to serialise, or a caller that simply forgot it, used to
   * graduate the whole class instead of erroring — marking every child GRADUATED with an exit
   * date, which nothing in the product can undo.
   */
  @IsOptional() @IsBoolean() graduate?: boolean;
}

class ExitDto {
  @IsOptional() @IsString() reason?: string;
}

class ReinstateDto {
  /** Where they return to. Their old class may have been deleted, or filled, or renamed. */
  @IsString() classId: string;
  /** Required: bringing a child back onto the roll should say why, like exiting does. */
  @IsString() @MinLength(4) reason: string;
}

@Injectable()
export class StudentsService {
  constructor(private db: PrismaService) {}

  /**
   * The register, paged.
   *
   * This used to return a bare array capped at `take: 200`. A school with more than 200 children
   * on the roll saw 200 of them and was told nothing about the rest — the cap was invisible, so
   * "my child isn't in the system" was indistinguishable from "your child is on page 3". The
   * envelope carries the total precisely so the screen can say which.
   */
  async list(auth: AuthUser, q: ListStudentsDto) {
    // Same gate detail() applies; see the note on primaryGuardian below.
    const mayReadGuardians =
      (auth.permissions?.includes('students.guardians') ||
        auth.permissions?.includes('pickup.view')) ??
      false;
    const { skip, take, page, perPage } = pageArgs(q);
    const enrolled = dateWindow(q);
    const where = {
      schoolId: auth.schoolId,
      status: q.status ?? 'ACTIVE',
      ...(q.classId ? { classId: q.classId } : {}),
      ...(q.campusId ? { classRoom: { campusId: q.campusId } } : {}),
      ...(q.gender ? { gender: q.gender } : {}),
      // The window filters when the child joined the roll, which is what an admissions officer
      // means by "students added this term" — not their birthday.
      ...(enrolled ? { enrolledAt: enrolled } : {}),
      ...(q.q
        ? {
            OR: [
              { firstName: { contains: q.q, mode: 'insensitive' as const } },
              { lastName: { contains: q.q, mode: 'insensitive' as const } },
              { admissionNo: { contains: q.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, students] = await Promise.all([
      this.db.student.count({ where }),
      this.db.student.findMany({
        where,
        include: {
          classRoom: { select: { name: true } },
          /**
           * Every guardian, not only the primary one.
           *
           * The list used to fetch `where: { isPrimary: true }`, so it could not tell a child with
           * one guardian from a child with four — and a record with guardians but none flagged
           * primary read as having none at all. Ordering by isPrimary means the lead is the primary
           * where there is one, and the first guardian otherwise, rather than silently nothing.
           */
          guardians: {
            include: { guardian: true },
            // StudentGuardian carries no timestamp, so the secondary sort is the guardian's own
            // name — stable, and alphabetical is what a reader expects when nothing is primary.
            orderBy: [{ isPrimary: 'desc' }, { guardian: { lastName: 'asc' } }],
          },
        },
        orderBy: orderBy<Prisma.StudentOrderByWithRelationInput>(q, STUDENT_SORTS, [
          { classRoom: { name: 'asc' } },
          { lastName: 'asc' },
        ]),
        skip,
        take,
      }),
    ]);

    const rows = students.map((s) => ({
      id: s.id,
      admissionNo: s.admissionNo,
      name: `${s.firstName} ${s.lastName}`,
      gender: s.gender,
      status: s.status,
      className: s.classRoom?.name ?? '—',
      /**
       * A summary, because a child can have several guardians and the roster has room for one.
       *
       * `total` is what makes the summary honest — a single name with nothing else said implies
       * that name is the whole answer. The full list lives on the student's own record.
       *
       * The phone needs `students.guardians`, exactly as it does on the record itself.
       * `detail()` gates contact details behind that permission and explains why; this list did
       * not, so the gate was bypassed by listing instead of opening a record. Librarian, Subject
       * Teacher, Exams Officer, Bursar, Accounts Clerk and School Nurse all hold `students.view`
       * without `students.guardians` — the librarian is the precise case the detail fix was
       * written against, and the list handed them every guardian's number 200 at a time.
       */
      guardians: {
        total: s.guardians.length,
        lead: s.guardians[0]
          ? {
              name: `${s.guardians[0].guardian.firstName} ${s.guardians[0].guardian.lastName}`,
              relationship: s.guardians[0].relationship,
              isPrimary: s.guardians[0].isPrimary,
              phone: mayReadGuardians ? s.guardians[0].guardian.phone : undefined,
            }
          : null,
      },
    }));
    return toPage(rows, total, { page, perPage });
  }

  async detail(auth: AuthUser, id: string) {
    const s = await this.db.student.findFirst({
      where: { id, schoolId: auth.schoolId },
      include: {
        classRoom: { include: { level: true } },
        // _count.students tells the UI a guardian is shared with siblings, so editing their
        // contact details can warn that the change lands on every child they belong to.
        guardians: {
          include: { guardian: { include: { _count: { select: { students: true } } } } },
        },
      },
    });
    if (!s) throw new NotFoundException('Student not found');

    // `students.view` opens this record, but it does not open everything on it. Medical notes and
    // money each need their own permission, or a librarian would read both simply by opening a
    // child's page while the nurse who holds `students.medical` gained nothing from it.
    const mayReadMedical = auth.permissions?.includes('students.medical') ?? false;
    const mayReadFees = auth.permissions?.includes('fees.view') ?? false;
    // Seeing who a child's guardians are is part of the record; their contact details and
    // custody status are not.
    const mayReadGuardians =
      (auth.permissions?.includes('students.guardians') ||
        auth.permissions?.includes('pickup.view')) ??
      false;

    const [ledger, attendance] = await Promise.all([
      this.db.ledgerEntry.findMany({
        where: { studentId: id },
        orderBy: { createdAt: 'desc' },
        include: { receipt: { select: { number: true } } },
      }),
      this.db.attendanceRecord.groupBy({
        by: ['status'],
        where: { studentId: id },
        _count: true,
      }),
    ]);
    const balance = balanceOf(ledger);
    const cancelled = reversedIds(ledger);
    return {
      id: s.id,
      admissionNo: s.admissionNo,
      firstName: s.firstName,
      lastName: s.lastName,
      otherNames: s.otherNames,
      gender: s.gender,
      dateOfBirth: s.dateOfBirth,
      status: s.status,
      enrolledAt: s.enrolledAt,
      exitDate: s.exitDate,
      exitReason: s.exitReason,
      // Storage key only — bytes are served by GET /students/:id/photo behind auth.
      photoUrl: s.photoUrl,
      /**
       * Medical notes and money are on this payload but are NOT part of `students.view`.
       *
       * Without this a librarian could read every child's medical notes and fee balance simply
       * by opening their record, while the school nurse who actually holds `students.medical`
       * gained nothing from it. A permission that guards no route guards nothing — the gate has
       * to be on the field, because the field is what is sensitive.
       */
      medicalNotes: mayReadMedical ? s.medicalNotes : undefined,
      className: s.classRoom?.name,
      // The id as well as the name, so the edit form can preselect the class the child is in.
      classId: s.classId,
      levelCategory: s.classRoom?.level.category,
      guardians: s.guardians.map((g) => ({
        id: g.guardianId,
        name: `${g.guardian.firstName} ${g.guardian.lastName}`,
        // Contact details and the custody flag need their own permission, like medical notes
        // above. custodyFlag in particular is a child-safety field: BLOCKED says a named adult
        // must not collect this child, and that is not something every role should read.
        phone: mayReadGuardians ? g.guardian.phone : undefined,
        relationship: g.relationship,
        isPrimary: g.isPrimary,
        canPickup: mayReadGuardians ? g.canPickup : undefined,
        custodyFlag: mayReadGuardians ? g.custodyFlag : undefined,
        whatsappOptIn: mayReadGuardians ? g.guardian.whatsappOptIn : undefined,
        /** Other students who share this guardian — 0 means the edit affects this child only. */
        alsoGuardianTo: Math.max(0, g.guardian._count.students - 1),
      })),
      feeBalance: mayReadFees ? Math.round(balance * 100) / 100 : undefined,
      // Whether the child can sign in, never the PIN itself — that is shown once, at the moment
      // it is issued, and is a hash from then on.
      hasPortalPin: !!s.portalPinHash,
      ledger: !mayReadFees
        ? undefined
        : ledger.slice(0, 20).map((e) => ({
            id: e.id,
            type: e.type,
            amount: Number(e.amount),
            method: e.method,
            reference: e.reference,
            receiptNumber: e.receipt?.number ?? null,
            note: e.note,
            createdAt: e.createdAt,
            reversedId: e.reversedId,
            // Both halves of a correction stay visible, but the cancelled entry has to *look*
            // cancelled or the ledger reads as if the family were charged twice.
            reversed: cancelled.has(e.id),
          })),
      attendanceSummary: attendance.reduce(
        (acc, a) => ({ ...acc, [a.status]: a._count }),
        {} as Record<string, number>,
      ),
    };
  }

  /**
   * The next admission number, in the school's own format.
   *
   * The counter lives on the school rather than being derived from the student count: withdrawing
   * a child leaves a gap, and counting rows would hand the next enrolment a number somebody
   * already has. It is incremented whether or not the write below succeeds, which is the right
   * trade — a gap in the sequence is harmless, a collision is not.
   *
   * The retry exists because two clerks enrolling at the same moment can both read the same
   * counter. The unique index is the real guarantee; this just turns its error into a number
   * that works.
   */
  // Public because the bulk importer needs the same numbering. It had its own copy that
  // hardcoded "BA-" and counted rows — both bugs this method exists to avoid.
  async nextAdmissionNo(schoolId: string, levelId: string | null): Promise<string> {
    const [school, level] = await Promise.all([
      this.db.school.findUniqueOrThrow({
        where: { id: schoolId },
        select: { admissionNoFormat: true },
      }),
      levelId
        ? this.db.level.findFirst({ where: { id: levelId }, select: { code: true } })
        : Promise.resolve(null),
    ]);

    const template = checkTemplate(school.admissionNoFormat).ok
      ? school.admissionNoFormat
      : // A format that has somehow become invalid must not stop a school enrolling a child.
        DEFAULT_TEMPLATE;

    for (let attempt = 0; attempt < 5; attempt++) {
      const { admissionNoNext } = await this.db.school.update({
        where: { id: schoolId },
        data: { admissionNoNext: { increment: 1 } },
        select: { admissionNoNext: true },
      });
      const candidate = formatAdmissionNo(template, {
        // The update returns the value *after* incrementing, so the number just claimed is one
        // less than what came back.
        sequence: admissionNoNext - 1,
        year: new Date().getFullYear(),
        levelCode: level?.code ?? null,
      });
      const clash = await this.db.student.findFirst({
        where: { schoolId, admissionNo: candidate },
        select: { id: true },
      });
      if (!clash) return candidate;
    }
    throw new BadRequestException(
      'Could not allocate an admission number. Check the format in School Setup.',
    );
  }

  async create(auth: AuthUser, dto: CreateStudentDto) {
    const cls = await this.db.classRoom.findFirst({
      where: { id: dto.classId, schoolId: auth.schoolId },
    });
    if (!cls) throw new NotFoundException('Class not found');

    const admissionNo = await this.nextAdmissionNo(auth.schoolId, cls.levelId);
    const student = await this.db.student.create({
      data: {
        schoolId: auth.schoolId,
        admissionNo,
        firstName: dto.firstName,
        lastName: dto.lastName,
        otherNames: dto.otherNames,
        gender: dto.gender,
        dateOfBirth: new Date(dto.dateOfBirth),
        classId: dto.classId,
      },
    });
    if (dto.guardianFirstName && dto.guardianPhone) {
      const guardian = await this.db.guardian.create({
        data: {
          schoolId: auth.schoolId,
          firstName: dto.guardianFirstName,
          lastName: dto.guardianLastName ?? dto.lastName,
          phone: dto.guardianPhone,
        },
      });
      await this.db.studentGuardian.create({
        data: {
          studentId: student.id,
          guardianId: guardian.id,
          relationship: dto.guardianRelationship ?? 'Guardian',
          isPrimary: true,
        },
      });
    }
    await this.db.audit(auth.schoolId, auth.sub, 'student.create', 'Student', student.id);
    return student;
  }

  /** Loads a student inside the caller's school, or 404s. */
  private async ownStudent(auth: AuthUser, id: string) {
    const student = await this.db.student.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  private async links(studentId: string) {
    return this.db.studentGuardian.findMany({ where: { studentId } });
  }

  /**
   * Attach a guardian to a student.
   *
   * Guardians are matched on phone number within the school and reused: siblings must share one
   * Guardian row, otherwise the parent ends up with two portal identities and each shows only
   * half their children.
   */
  async addGuardian(auth: AuthUser, studentId: string, dto: AddGuardianDto) {
    await this.ownStudent(auth, studentId);
    const msisdn = normalizeMsisdn(dto.phone);
    if (!msisdn) throw new BadRequestException('That does not look like a phone number');

    const existing = await this.db.guardian.findFirst({
      where: { schoolId: auth.schoolId, phone: { contains: msisdn.slice(-9) } },
    });
    const guardian =
      existing ??
      (await this.db.guardian.create({
        data: {
          schoolId: auth.schoolId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          email: dto.email,
          whatsappOptIn: dto.whatsappOptIn ?? false,
        },
      }));

    const already = await this.db.studentGuardian.findUnique({
      where: { studentId_guardianId: { studentId, guardianId: guardian.id } },
    });
    if (already) throw new BadRequestException('That guardian is already linked to this student');

    const link = reconcileLink({
      canPickup: dto.canPickup ?? true,
      custodyFlag: dto.custodyFlag ?? 'NONE',
    });
    const current = await this.links(studentId);
    // The first guardian on a student is the primary by default — someone has to be.
    const isPrimary = dto.isPrimary ?? current.length === 0;

    for (const op of [
      ...(isPrimary
        ? [
            this.db.studentGuardian.updateMany({
              where: { studentId, guardianId: { in: demoteOthers(current, guardian.id) } },
              data: { isPrimary: false },
            }),
          ]
        : []),
    ])
      await op;
    await this.db.studentGuardian.create({
      data: {
        studentId,
        guardianId: guardian.id,
        relationship: dto.relationship ?? 'Guardian',
        isPrimary,
        ...link,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'guardian.link', 'Student', studentId, {
      guardianId: guardian.id,
      reused: !!existing,
    });
    return { id: guardian.id, reused: !!existing };
  }

  /**
   * Update the guardian's own details and/or their link to this student. Contact details are
   * shared across siblings by design — correcting a phone number fixes it everywhere.
   */
  async updateGuardian(
    auth: AuthUser,
    studentId: string,
    guardianId: string,
    dto: UpdateGuardianDto,
  ) {
    await this.ownStudent(auth, studentId);
    const link = await this.db.studentGuardian.findUnique({
      where: { studentId_guardianId: { studentId, guardianId } },
      include: { guardian: true },
    });
    if (!link || link.guardian.schoolId !== auth.schoolId) {
      throw new NotFoundException('That guardian is not linked to this student');
    }
    if (dto.phone !== undefined && !normalizeMsisdn(dto.phone)) {
      throw new BadRequestException('That does not look like a phone number');
    }

    const next = reconcileLink({
      canPickup: dto.canPickup ?? link.canPickup,
      custodyFlag: dto.custodyFlag ?? link.custodyFlag,
    });
    const promoting = dto.isPrimary === true;
    const current = await this.links(studentId);

    await this.db.guardian.update({
      where: { id: guardianId },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        email: dto.email,
        whatsappOptIn: dto.whatsappOptIn,
      },
    });
    for (const op of [
      ...(promoting
        ? [
            this.db.studentGuardian.updateMany({
              where: { studentId, guardianId: { in: demoteOthers(current, guardianId) } },
              data: { isPrimary: false },
            }),
          ]
        : []),
    ])
      await op;
    await this.db.studentGuardian.update({
      where: { studentId_guardianId: { studentId, guardianId } },
      data: {
        relationship: dto.relationship,
        ...(dto.isPrimary === undefined ? {} : { isPrimary: dto.isPrimary }),
        ...next,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'guardian.update', 'Student', studentId, {
      guardianId,
      // Contact details are not copied into the audit detail: it is readable by anyone with
      // audit.view, including roles that deliberately hold no student permissions.
      fields: Object.keys(dto),
    });
    return { ok: true };
  }

  /**
   * Unlink a guardian from this student. The Guardian row survives — they may still have other
   * children here, and their portal history should not vanish.
   */
  async removeGuardian(auth: AuthUser, studentId: string, guardianId: string) {
    await this.ownStudent(auth, studentId);
    const current = await this.db.studentGuardian.findMany({
      where: { studentId },
      include: { guardian: { select: { schoolId: true } } },
    });
    const link = current.find((l) => l.guardianId === guardianId);
    if (!link || link.guardian.schoolId !== auth.schoolId) {
      throw new NotFoundException('That guardian is not linked to this student');
    }

    const successor = successorPrimary(current, guardianId);
    await this.db.studentGuardian.delete({
      where: { studentId_guardianId: { studentId, guardianId } },
    });
    for (const op of [
      ...(successor
        ? [
            this.db.studentGuardian.update({
              where: { studentId_guardianId: { studentId, guardianId: successor } },
              data: { isPrimary: true },
            }),
          ]
        : []),
    ])
      await op;
    await this.db.audit(auth.schoolId, auth.sub, 'guardian.unlink', 'Student', studentId, {
      guardianId,
      promoted: successor,
    });
    return { ok: true, promoted: successor };
  }

  async update(auth: AuthUser, id: string, dto: UpdateStudentDto) {
    const existing = await this.db.student.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!existing) throw new NotFoundException('Student not found');

    // Writing a medical note needs the medical permission, not merely the one to edit a record.
    // The permission's own label says "See and record medical notes"; gating only the read half
    // let a registrar author a child's medical history.
    if (dto.medicalNotes !== undefined && !auth.permissions?.includes('students.medical')) {
      throw new ForbiddenException('You do not have permission to record medical notes');
    }

    const student = await this.db.student.update({
      where: { id },
      // dateOfBirth arrives as an ISO string from the form; Prisma needs a Date.
      data: { ...dto, ...(dto.dateOfBirth ? { dateOfBirth: new Date(dto.dateOfBirth) } : {}) },
      // Never the whole row: it carries medicalNotes and portalPinHash, and returning them on an
      // unrelated edit would undo the field gating detail() goes to lengths to enforce.
      select: {
        id: true,
        admissionNo: true,
        firstName: true,
        lastName: true,
        otherNames: true,
        gender: true,
        dateOfBirth: true,
        classId: true,
        status: true,
      },
    });
    // The forensic before/after (FEATURES.md §19) — but the audit detail is read back by anyone
    // with audit.view, so a medical note is never copied in verbatim; that it changed is enough.
    const { medicalNotes, ...auditable } = dto;
    const before: Record<string, unknown> = {};
    for (const key of Object.keys(auditable)) {
      before[key] = (existing as Record<string, unknown>)[key];
    }
    if (medicalNotes !== undefined) {
      before.medicalNotes = existing.medicalNotes ? '(set)' : '(empty)';
      (auditable as Record<string, unknown>).medicalNotes = '(changed)';
    }
    await this.db.auditChange(
      auth.schoolId,
      auth.sub,
      'student.update',
      'Student',
      id,
      before,
      auditable as Record<string, unknown>,
    );
    return student;
  }

  /**
   * Promote a class: move active students to the next class, or graduate a terminal class.
   * Outstanding fees carry forward automatically — the append-only ledger spans terms and is
   * never reset, so no ledger mutation is needed here.
   */
  /** Every class in the school, flattened to what the promotion helpers need. */
  private async classLadder(schoolId: string): Promise<ClassLike[]> {
    const rows = await this.db.classRoom.findMany({
      where: { schoolId },
      select: { id: true, name: true, levelId: true, level: { select: { order: true } } },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      levelId: c.levelId,
      levelOrder: c.level.order,
    }));
  }

  /**
   * The end-of-year roll for one class, each child carrying a suggested decision.
   *
   * The point of the review screen: a school does not promote a class, it promotes children, most
   * of whom happen to be going the same way. The suggestion makes the common case one click and
   * the exception one dropdown, rather than making every child a decision from scratch.
   */
  async promotionPreview(auth: AuthUser, classId: string) {
    const ladder = await this.classLadder(auth.schoolId);
    const from = ladder.find((c) => c.id === classId);
    if (!from) throw new NotFoundException('Class not found');

    const [students, next] = await Promise.all([
      this.db.student.findMany({
        where: { schoolId: auth.schoolId, classId, status: 'ACTIVE' },
        select: { id: true, firstName: true, lastName: true, admissionNo: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
      Promise.resolve(suggestNextClass(from, ladder)),
    ]);
    const final = isFinalClass(from, ladder);

    return {
      fromClassId: classId,
      fromClassName: from.name,
      /** True when this class's children leave rather than move up. */
      isFinalClass: final,
      suggestedToClassId: next?.id ?? null,
      suggestedToClassName: next?.name ?? null,
      // Every class, so a reviewer can send one child somewhere the suggestion never considered
      // — a repeat into a different stream, or a jump for a child who was mis-placed.
      classes: ladder
        .filter((c) => c.id !== classId)
        .sort((a, b) => a.levelOrder - b.levelOrder || a.name.localeCompare(b.name))
        .map((c) => ({ id: c.id, name: c.name })),
      students: students.map((s) => ({
        studentId: s.id,
        name: `${s.firstName} ${s.lastName}`,
        admissionNo: s.admissionNo,
        suggestedAction: final ? 'GRADUATE' : next ? 'PROMOTE' : 'REPEAT',
        suggestedToClassId: final ? null : (next?.id ?? null),
      })),
    };
  }

  /**
   * Apply a reviewed set of per-child decisions.
   *
   * Arrears are untouched by design: the ledger is append-only and carries the child, so moving
   * them up a class cannot lose what the family owes. Each decision writes a PromotionRecord, so
   * "repeated Basic 4" survives as a fact rather than as the absence of a class change.
   */
  async runPromotion(auth: AuthUser, dto: PromotionRunDto) {
    const ladder = await this.classLadder(auth.schoolId);
    const from = ladder.find((c) => c.id === dto.fromClassId);
    if (!from) throw new NotFoundException('Class not found');

    const roll = await this.db.student.findMany({
      where: { schoolId: auth.schoolId, classId: dto.fromClassId, status: 'ACTIVE' },
      select: { id: true },
    });
    const onRoll = new Set(roll.map((s) => s.id));
    for (const d of dto.decisions) {
      if (!onRoll.has(d.studentId)) {
        throw new BadRequestException('That list includes a child who is not in this class');
      }
    }

    const graduating = dto.decisions.filter((d) => d.action === 'GRADUATE');
    if (graduating.length > 0 && dto.confirmGraduating !== graduating.length) {
      /*
        Graduation cannot be undone in the product. The count has to be stated, and has to still
        match, so a roll that changed while somebody was deciding stops the run rather than
        quietly graduating one more child than the screen showed.
      */
      throw new BadRequestException(
        `This will graduate ${graduating.length} student(s) and cannot be undone. Confirm the number to continue.`,
      );
    }

    const year = await this.db.academicYear.findFirst({
      where: { schoolId: auth.schoolId, isCurrent: true },
    });
    if (!year) throw new BadRequestException('No current academic year');

    const known = new Set(ladder.map((c) => c.id));
    let promoted = 0;
    let repeated = 0;
    let graduated = 0;

    for (const d of dto.decisions) {
      if (d.action === 'PROMOTE') {
        if (!d.toClassId || !known.has(d.toClassId)) {
          throw new NotFoundException('Destination class not found');
        }
        await this.db.student.update({
          where: { id: d.studentId },
          data: { classId: d.toClassId },
        });
        promoted++;
      } else if (d.action === 'GRADUATE') {
        await this.db.student.update({
          where: { id: d.studentId },
          data: { status: 'GRADUATED', exitDate: new Date(), exitReason: 'Graduated' },
        });
        graduated++;
      } else {
        // Repeat: the child stays exactly where they are. The record is the whole change.
        repeated++;
      }

      await this.db.promotionRecord.upsert({
        where: {
          studentId_academicYearId: { studentId: d.studentId, academicYearId: year.id },
        },
        create: {
          schoolId: auth.schoolId,
          studentId: d.studentId,
          academicYearId: year.id,
          action:
            d.action === 'PROMOTE' ? 'PROMOTED' : d.action === 'GRADUATE' ? 'GRADUATED' : 'REPEATED',
          fromClassId: dto.fromClassId,
          toClassId: d.action === 'PROMOTE' ? (d.toClassId ?? null) : null,
          decidedById: auth.sub,
        },
        update: {
          action:
            d.action === 'PROMOTE' ? 'PROMOTED' : d.action === 'GRADUATE' ? 'GRADUATED' : 'REPEATED',
          toClassId: d.action === 'PROMOTE' ? (d.toClassId ?? null) : null,
          decidedById: auth.sub,
        },
      });
    }

    await this.db.audit(auth.schoolId, auth.sub, 'students.promotion.run', 'ClassRoom', dto.fromClassId, {
      promoted,
      repeated,
      graduated,
      year: year.name,
    });
    return { promoted, repeated, graduated, moved: promoted };
  }

  /**
   * Move a whole class at once — the common case, expressed as a run in which every child gets
   * the same decision. One code path, so the promotion record is written either way.
   */
  async promote(auth: AuthUser, dto: PromoteDto) {
    const from = await this.db.classRoom.findFirst({
      where: { id: dto.fromClassId, schoolId: auth.schoolId },
    });
    if (!from) throw new NotFoundException('Class not found');
    if (dto.toClassId) {
      const to = await this.db.classRoom.findFirst({
        where: { id: dto.toClassId, schoolId: auth.schoolId },
      });
      if (!to) throw new NotFoundException('Destination class not found');
    }

    const graduating = !dto.toClassId;
    if (graduating && dto.graduate !== true) {
      // Fail loudly rather than doing the irreversible thing by default.
      throw new BadRequestException(
        'Choose a class to promote into, or confirm that this class is graduating.',
      );
    }

    const roll = await this.db.student.findMany({
      where: { schoolId: auth.schoolId, classId: dto.fromClassId, status: 'ACTIVE' },
      select: { id: true },
    });
    const decisions = roll.map((s) => ({
      studentId: s.id,
      action: (graduating ? 'GRADUATE' : 'PROMOTE') as 'GRADUATE' | 'PROMOTE',
      toClassId: graduating ? undefined : dto.toClassId,
    }));
    const result = await this.runPromotion(auth, {
      fromClassId: dto.fromClassId,
      decisions,
      // Already confirmed by `graduate: true` on the way in; the run wants the count.
      confirmGraduating: graduating ? decisions.length : undefined,
    });
    return { moved: graduating ? result.graduated : result.promoted, graduated: graduating };
  }

  private async exit(
    auth: AuthUser,
    id: string,
    status: Extract<StudentStatus, 'TRANSFERRED' | 'WITHDRAWN'>,
    reason: string | undefined,
    action: string,
  ) {
    const existing = await this.db.student.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!existing) throw new NotFoundException('Student not found');
    if (existing.status !== 'ACTIVE') {
      throw new BadRequestException('Student is not active');
    }
    const student = await this.db.student.update({
      where: { id },
      data: { status, exitDate: new Date(), exitReason: reason ?? null },
    });
    await this.db.audit(auth.schoolId, auth.sub, action, 'Student', id, { reason: reason ?? null });
    return { id: student.id, status: student.status };
  }

  /**
   * Put a student back on the roll.
   *
   * The lifecycle was one-way: `exit()` requires ACTIVE and the update DTO carries no `status`, so
   * a child transferred, withdrawn or graduated by mistake could only be corrected in the
   * database. That is a poor answer for a school — a mis-clicked "Graduate class" ended forty
   * children's records, and the head's only recourse was to ring EYO.
   *
   * Deliberately not a general status editor. It returns someone to ACTIVE and nothing else: the
   * exits stay one-way and keep their own confirmations, so this cannot become a way to change a
   * child's history sideways.
   *
   * The class is asked for rather than assumed. `classId` survives an exit, but the class may have
   * been deleted, renamed or promoted on since, and a returning pupil frequently belongs in a
   * different year anyway.
   */
  async reinstate(auth: AuthUser, id: string, dto: ReinstateDto) {
    const existing = await this.db.student.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!existing) throw new NotFoundException('Student not found');
    if (existing.status === 'ACTIVE') {
      throw new BadRequestException('That student is already on the roll');
    }

    const cls = await this.db.classRoom.findFirst({
      where: { id: dto.classId, schoolId: auth.schoolId },
    });
    if (!cls) throw new NotFoundException('Class not found');

    const student = await this.db.student.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        classId: dto.classId,
        // Cleared: leaving these set would leave the record reading as though the child were
        // still gone, and the exit date would print on documents.
        exitDate: null,
        exitReason: null,
      },
      select: { id: true, status: true, classId: true },
    });

    await this.db.audit(auth.schoolId, auth.sub, 'student.reinstate', 'Student', id, {
      from: existing.status,
      // What was undone, so the trail still shows the exit that happened.
      previousExitDate: existing.exitDate,
      previousExitReason: existing.exitReason,
      classId: dto.classId,
      reason: dto.reason,
    });
    return student;
  }

  transfer(auth: AuthUser, id: string, dto: ExitDto) {
    return this.exit(auth, id, 'TRANSFERRED', dto.reason, 'student.transfer');
  }

  withdraw(auth: AuthUser, id: string, dto: ExitDto) {
    return this.exit(auth, id, 'WITHDRAWN', dto.reason, 'student.withdraw');
  }

  // ── Photo & documents ──────────────────────────────────────────────

  private assertUpload(file: UploadedFileLike | undefined, allowed: string[]) {
    if (!file?.buffer) throw new BadRequestException('No file uploaded');
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `File is too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB)`,
      );
    }
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(`Unsupported file type ${file.mimetype}`);
    }
  }

  async uploadPhoto(auth: AuthUser, studentId: string, file: UploadedFileLike) {
    this.assertUpload(file, IMAGE_TYPES);
    const student = await this.db.student.findFirst({
      where: { id: studentId, schoolId: auth.schoolId },
    });
    if (!student) throw new NotFoundException('Student not found');

    const key = objectKey(auth.schoolId, 'students', studentId, file.originalname);
    await storage().put(key, file.buffer, file.mimetype);
    // Replace rather than accumulate — a student has one current photo.
    if (student.photoUrl)
      await storage()
        .delete(student.photoUrl)
        .catch(() => undefined);
    await this.db.student.update({ where: { id: studentId }, data: { photoUrl: key } });
    await this.db.audit(auth.schoolId, auth.sub, 'student.photo', 'Student', studentId);
    return { key };
  }

  async listDocuments(auth: AuthUser, studentId: string) {
    const docs = await this.db.studentDocument.findMany({
      where: { schoolId: auth.schoolId, studentId },
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

  async uploadDocument(auth: AuthUser, studentId: string, kind: string, file: UploadedFileLike) {
    this.assertUpload(file, DOCUMENT_TYPES);
    const student = await this.db.student.findFirst({
      where: { id: studentId, schoolId: auth.schoolId },
    });
    if (!student) throw new NotFoundException('Student not found');

    const key = objectKey(auth.schoolId, 'documents', studentId, file.originalname);
    await storage().put(key, file.buffer, file.mimetype);
    const doc = await this.db.studentDocument.create({
      data: {
        schoolId: auth.schoolId,
        studentId,
        kind: kind || 'OTHER',
        filename: file.originalname,
        contentType: file.mimetype,
        size: file.size,
        key,
        uploadedById: auth.sub,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'student.document.upload', 'Student', studentId, {
      filename: file.originalname,
    });
    return { id: doc.id, filename: doc.filename };
  }

  /** Streams file bytes through the API so access is always checked against the caller's school. */
  async readDocument(auth: AuthUser, docId: string) {
    const doc = await this.db.studentDocument.findFirst({
      where: { id: docId, schoolId: auth.schoolId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return { buffer: await storage().get(doc.key), doc };
  }

  async deleteDocument(auth: AuthUser, docId: string) {
    const doc = await this.db.studentDocument.findFirst({
      where: { id: docId, schoolId: auth.schoolId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    await storage()
      .delete(doc.key)
      .catch(() => undefined);
    await this.db.studentDocument.delete({ where: { id: docId } });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'student.document.delete',
      'Student',
      doc.studentId,
      {
        filename: doc.filename,
      },
    );
    return { deleted: true };
  }

  async readPhoto(auth: AuthUser, studentId: string) {
    const student = await this.db.student.findFirst({
      where: { id: studentId, schoolId: auth.schoolId },
      select: { photoUrl: true },
    });
    if (!student?.photoUrl) throw new NotFoundException('No photo on file');
    return storage().get(student.photoUrl);
  }

  /**
   * Printable ID cards for a whole class, or one child.
   *
   * The QR carries the admission number, not a secret. A card worn all day and dropped in a
   * playground must not be able to collect a child — the gate still verifies the *guardian*.
   * This identifies a pupil; it does not authorise anything.
   */
  async idCards(auth: AuthUser, opts: { classId?: string; studentId?: string }) {
    const students = await this.db.student.findMany({
      where: {
        schoolId: auth.schoolId,
        status: 'ACTIVE',
        ...(opts.studentId ? { id: opts.studentId } : {}),
        ...(opts.classId ? { classId: opts.classId } : {}),
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      include: { classRoom: { select: { name: true } } },
    });
    if (students.length === 0) throw new NotFoundException('No active students match that');

    const school = await this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } });
    const crest = school.logoUrl
      ? await storage()
          .get(school.logoUrl)
          .catch(() => undefined)
      : undefined;

    const cards: StudentIdCardData[] = [];
    for (const st of students) {
      // A missing or unreadable photo prints a blank frame rather than failing the batch —
      // a school printing 40 cards should not lose all of them to one bad upload.
      const photo = st.photoUrl
        ? await storage()
            .get(st.photoUrl)
            .catch(() => undefined)
        : undefined;
      cards.push({
        school: {
          name: school.name,
          motto: school.motto,
          address: school.address,
          phone: school.phone,
          brandColor: school.brandColor,
          logo: crest,
        },
        name: `${st.firstName} ${st.lastName}`,
        admissionNo: st.admissionNo,
        className: st.classRoom?.name ?? null,
        photo,
        // The QR carries the admission number, not a secret: a card worn all day and dropped in
        // a playground must identify a pupil, never authorise collecting one.
        qrValue: st.admissionNo,
        contact: school.phone,
      });
    }
    const pdf = await studentIdCardSheet(cards);

    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'sis.idcards',
      'Student',
      opts.studentId ?? opts.classId,
      {
        count: cards.length,
      },
    );
    return { pdf, count: students.length };
  }

  async exportStudents(
    auth: AuthUser,
    format: string,
    classId?: string,
    status: StudentStatus = 'ACTIVE',
  ) {
    const students = await this.db.student.findMany({
      where: { schoolId: auth.schoolId, status, ...(classId ? { classId } : {}) },
      include: {
        classRoom: { select: { name: true } },
        /**
         * Every guardian, not only the primary one.
         *
         * The list used to fetch `where: { isPrimary: true }`, so it could not tell a child with
         * one guardian from a child with four — and a record with guardians but none flagged
         * primary read as having none at all. Ordering by isPrimary means the lead is the primary
         * where there is one, and the first guardian otherwise, rather than silently nothing.
         */
        guardians: {
          include: { guardian: true },
          // StudentGuardian carries no timestamp, so the secondary sort is the guardian's own
          // name — stable, and alphabetical is what a reader expects when nothing is primary.
          orderBy: [{ isPrimary: 'desc' }, { guardian: { lastName: 'asc' } }],
        },
      },
      orderBy: [{ classRoom: { name: 'asc' } }, { lastName: 'asc' }],
    });
    const headers = [
      'Admission No.',
      'First Name',
      'Last Name',
      'Other Names',
      'Gender',
      'Date of Birth',
      'Class',
      'Status',
      'Guardian',
      'Guardian Phone',
    ];
    const rows: Cell[][] = students.map((s) => [
      s.admissionNo,
      s.firstName,
      s.lastName,
      s.otherNames ?? '',
      s.gender,
      s.dateOfBirth.toISOString().slice(0, 10),
      s.classRoom?.name ?? '',
      s.status,
      s.guardians[0]
        ? `${s.guardians[0].guardian.firstName} ${s.guardians[0].guardian.lastName}`
        : '',
      s.guardians[0]?.guardian.phone ?? '',
    ]);
    const base = `students-${status.toLowerCase()}`;
    if (format === 'csv')
      return { buffer: toCsv(headers, rows), type: 'text/csv', filename: `${base}.csv` };
    return {
      buffer: await toXlsx('Students', headers, rows),
      type: XLSX_MIME,
      filename: `${base}.xlsx`,
    };
  }
}

@Controller('students')
export class StudentsController {
  constructor(private svc: StudentsService) {}

  @Get()
  @RequirePermission('students.view')
  list(@CurrentUser() user: AuthUser, @Query() query: ListStudentsDto) {
    return this.svc.list(user, query);
  }

  @Post('promote')
  @RequirePermission('students.lifecycle')
  promote(@CurrentUser() user: AuthUser, @Body() dto: PromoteDto) {
    return this.svc.promote(user, dto);
  }

  @Get('promotion/preview')
  @RequirePermission('students.lifecycle')
  promotionPreview(@CurrentUser() user: AuthUser, @Query('classId') classId: string) {
    return this.svc.promotionPreview(user, classId);
  }

  @Post('promotion/run')
  @RequirePermission('students.lifecycle')
  runPromotion(@CurrentUser() user: AuthUser, @Body() dto: PromotionRunDto) {
    return this.svc.runPromotion(user, dto);
  }

  @Get('export')
  @RequirePermission('students.export')
  @RequireEntitlement('platform.export')
  async export(
    @CurrentUser() user: AuthUser,
    @Query('format') format = 'xlsx',
    @Query('classId') classId?: string,
    @Query('status') status?: StudentStatus,
  ) {
    const { buffer, type, filename } = await this.svc.exportStudents(
      user,
      format,
      classId,
      status ?? 'ACTIVE',
    );
    return new StreamableFile(buffer, {
      type,
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get(':id')
  @RequirePermission('students.view')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.detail(user, id);
  }

  @Post(':id/photo')
  @RequirePermission('students.edit')
  @UseInterceptors(FileInterceptor('file'))
  uploadPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: UploadedFileLike,
  ) {
    return this.svc.uploadPhoto(user, id, file);
  }

  @Get('id-cards/print')
  @RequirePermission('students.view')
  @RequireEntitlement('sis.idcards')
  async idCards(
    @CurrentUser() user: AuthUser,
    @Query('classId') classId?: string,
    @Query('studentId') studentId?: string,
  ) {
    const { pdf, count } = await this.svc.idCards(user, { classId, studentId });
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `inline; filename="id-cards-${count}.pdf"`,
    });
  }

  @Get(':id/photo')
  @RequirePermission('students.view')
  async photo(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const buf = await this.svc.readPhoto(user, id);
    return new StreamableFile(buf, { type: 'image/jpeg' });
  }

  @Get(':id/documents')
  @RequirePermission('students.documents')
  documents(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.listDocuments(user, id);
  }

  @Post(':id/documents')
  @RequirePermission('students.documents')
  @UseInterceptors(FileInterceptor('file'))
  uploadDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('kind') kind: string,
    @UploadedFile() file: UploadedFileLike,
  ) {
    return this.svc.uploadDocument(user, id, kind, file);
  }

  @Post(':id/guardians')
  @RequirePermission('students.guardians')
  addGuardian(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddGuardianDto) {
    return this.svc.addGuardian(user, id, dto);
  }

  @Patch(':id/guardians/:guardianId')
  @RequirePermission('students.guardians')
  updateGuardian(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('guardianId') guardianId: string,
    @Body() dto: UpdateGuardianDto,
  ) {
    return this.svc.updateGuardian(user, id, guardianId, dto);
  }

  @Delete(':id/guardians/:guardianId')
  @RequirePermission('students.guardians')
  removeGuardian(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('guardianId') guardianId: string,
  ) {
    return this.svc.removeGuardian(user, id, guardianId);
  }

  @Post(':id/transfer')
  @RequirePermission('students.lifecycle')
  transfer(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ExitDto) {
    return this.svc.transfer(user, id, dto);
  }

  @Post(':id/withdraw')
  @RequirePermission('students.lifecycle')
  withdraw(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ExitDto) {
    return this.svc.withdraw(user, id, dto);
  }

  /** The way back. Same permission as the exits — whoever can end a record can undo that. */
  @Post(':id/reinstate')
  @RequirePermission('students.lifecycle')
  reinstate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReinstateDto) {
    return this.svc.reinstate(user, id, dto);
  }

  @Post()
  @RequirePermission('students.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateStudentDto) {
    return this.svc.create(user, dto);
  }

  @Patch(':id')
  @RequirePermission('students.edit')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateStudentDto) {
    return this.svc.update(user, id, dto);
  }
}

@Controller('documents')
export class StudentDocumentsController {
  constructor(private svc: StudentsService) {}

  @Get(':id')
  @RequirePermission('students.documents')
  async read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { buffer, doc } = await this.svc.readDocument(user, id);
    return new StreamableFile(buffer, {
      type: doc.contentType,
      disposition: `attachment; filename="${doc.filename.replace(/"/g, '')}"`,
    });
  }

  @Delete(':id')
  @RequirePermission('students.documents')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteDocument(user, id);
  }
}

@Module({
  controllers: [StudentsController, StudentDocumentsController],
  providers: [StudentsService],
  exports: [StudentsService],
})
export class StudentsModule {}
