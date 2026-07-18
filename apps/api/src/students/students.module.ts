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
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { CustodyFlag, Gender, StudentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { checkTemplate, DEFAULT_TEMPLATE, formatAdmissionNo } from '../common/admission-no';
import { studentIdCardSheet, type StudentIdCardData } from '../common/pdf';
import { AuthUser, CurrentUser, RequireEntitlement, RequirePermission } from '../common/auth';
import { enrolmentHeadroom, studentCapFor } from '../common/entitlements';
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

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Minimal shape of a Multer upload — avoids depending on @types/multer. */
interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
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
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
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

class PromoteDto {
  @IsString() fromClassId: string;
  // Omit toClassId to graduate a terminal class (status → GRADUATED).
  @IsOptional() @IsString() toClassId?: string;
}

class ExitDto {
  @IsOptional() @IsString() reason?: string;
}

@Injectable()
export class StudentsService {
  constructor(private db: PrismaService) {}

  async list(auth: AuthUser, classId?: string, q?: string, status: StudentStatus = 'ACTIVE') {
    const students = await this.db.student.findMany({
      where: {
        schoolId: auth.schoolId,
        status,
        ...(classId ? { classId } : {}),
        ...(q
          ? {
              OR: [
                { firstName: { contains: q, mode: 'insensitive' } },
                { lastName: { contains: q, mode: 'insensitive' } },
                { admissionNo: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        classRoom: { select: { name: true } },
        guardians: { where: { isPrimary: true }, include: { guardian: true } },
      },
      orderBy: [{ classRoom: { name: 'asc' } }, { lastName: 'asc' }],
      take: 200,
    });
    return students.map((s) => ({
      id: s.id,
      admissionNo: s.admissionNo,
      name: `${s.firstName} ${s.lastName}`,
      gender: s.gender,
      status: s.status,
      className: s.classRoom?.name ?? '—',
      primaryGuardian: s.guardians[0]
        ? {
            name: `${s.guardians[0].guardian.firstName} ${s.guardians[0].guardian.lastName}`,
            phone: s.guardians[0].guardian.phone,
          }
        : null,
    }));
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
    const balance = ledger.reduce((acc, e) => {
      const amt = Number(e.amount);
      if (e.type === 'INVOICE') return acc + amt;
      if (e.type === 'REVERSAL') return acc; // reversal handling: paired entries net out via referenced amounts
      return acc - amt;
    }, 0);
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
          })),
      attendanceSummary: attendance.reduce(
        (acc, a) => ({ ...acc, [a.status]: a._count }),
        {} as Record<string, number>,
      ),
    };
  }

  /** Active enrolment against the package cap. Only ever blocks NEW enrolments (docs/03 §3.5). */
  async enrolmentStatus(auth: AuthUser) {
    const active = await this.db.student.count({
      where: { schoolId: auth.schoolId, status: 'ACTIVE' },
    });
    const cap = studentCapFor(auth.tier);
    return {
      active,
      cap,
      headroom: enrolmentHeadroom(auth.tier, active),
      atCap: cap !== null && active >= cap,
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

    const { atCap, cap } = await this.enrolmentStatus(auth);
    if (atCap) {
      throw new BadRequestException(
        `Your package allows ${cap} active students. Existing records stay fully available — upgrade to enrol more.`,
      );
    }

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
      data: dto,
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
    // The audit detail is read back by anyone with audit.view, so a medical note must not be
    // copied into it verbatim — recording that it changed is enough.
    const { medicalNotes, ...auditable } = dto;
    await this.db.audit(auth.schoolId, auth.sub, 'student.update', 'Student', id, {
      ...auditable,
      ...(medicalNotes !== undefined ? { medicalNotes: '(changed)' } : {}),
    });
    return student;
  }

  /**
   * Promote a class: move active students to the next class, or graduate a terminal class.
   * Outstanding fees carry forward automatically — the append-only ledger spans terms and is
   * never reset, so no ledger mutation is needed here.
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
    const result = await this.db.student.updateMany({
      where: { schoolId: auth.schoolId, classId: dto.fromClassId, status: 'ACTIVE' },
      data: graduating
        ? { status: 'GRADUATED', exitDate: new Date(), exitReason: 'Graduated' }
        : { classId: dto.toClassId },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'students.promote', 'ClassRoom', dto.fromClassId, {
      toClassId: dto.toClassId ?? null,
      graduated: graduating,
      count: result.count,
    });
    return { moved: result.count, graduated: graduating };
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
        guardians: { where: { isPrimary: true }, include: { guardian: true } },
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
  list(
    @CurrentUser() user: AuthUser,
    @Query('classId') classId?: string,
    @Query('q') q?: string,
    @Query('status') status?: StudentStatus,
  ) {
    return this.svc.list(user, classId, q, status ?? 'ACTIVE');
  }

  @Post('promote')
  @RequirePermission('students.lifecycle')
  promote(@CurrentUser() user: AuthUser, @Body() dto: PromoteDto) {
    return this.svc.promote(user, dto);
  }

  @Get('enrolment')
  @RequirePermission('students.view')
  enrolment(@CurrentUser() user: AuthUser) {
    return this.svc.enrolmentStatus(user);
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
