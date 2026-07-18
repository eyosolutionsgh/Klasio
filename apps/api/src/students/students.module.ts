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
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsDateString, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { Gender, StudentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequireEntitlement, Roles } from '../common/auth';
import { enrolmentHeadroom, studentCapFor } from '../common/entitlements';
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
        guardians: { include: { guardian: true } },
      },
    });
    if (!s) throw new NotFoundException('Student not found');

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
      medicalNotes: s.medicalNotes,
      className: s.classRoom?.name,
      levelCategory: s.classRoom?.level.category,
      guardians: s.guardians.map((g) => ({
        id: g.guardianId,
        name: `${g.guardian.firstName} ${g.guardian.lastName}`,
        phone: g.guardian.phone,
        relationship: g.relationship,
        isPrimary: g.isPrimary,
        canPickup: g.canPickup,
        custodyFlag: g.custodyFlag,
        whatsappOptIn: g.guardian.whatsappOptIn,
      })),
      feeBalance: Math.round(balance * 100) / 100,
      ledger: ledger.slice(0, 20).map((e) => ({
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

    const count = await this.db.student.count({ where: { schoolId: auth.schoolId } });
    const student = await this.db.student.create({
      data: {
        schoolId: auth.schoolId,
        admissionNo: `BA-${String(count + 1).padStart(4, '0')}`,
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

  async update(auth: AuthUser, id: string, dto: UpdateStudentDto) {
    const existing = await this.db.student.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!existing) throw new NotFoundException('Student not found');
    const student = await this.db.student.update({ where: { id }, data: dto });
    await this.db.audit(auth.schoolId, auth.sub, 'student.update', 'Student', id, dto as object);
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
  list(
    @CurrentUser() user: AuthUser,
    @Query('classId') classId?: string,
    @Query('q') q?: string,
    @Query('status') status?: StudentStatus,
  ) {
    return this.svc.list(user, classId, q, status ?? 'ACTIVE');
  }

  @Post('promote')
  @Roles('OWNER', 'HEAD')
  promote(@CurrentUser() user: AuthUser, @Body() dto: PromoteDto) {
    return this.svc.promote(user, dto);
  }

  @Get('enrolment')
  enrolment(@CurrentUser() user: AuthUser) {
    return this.svc.enrolmentStatus(user);
  }

  @Get('export')
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
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.detail(user, id);
  }

  @Post(':id/photo')
  @Roles('OWNER', 'HEAD', 'FRONT_DESK')
  @UseInterceptors(FileInterceptor('file'))
  uploadPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: UploadedFileLike,
  ) {
    return this.svc.uploadPhoto(user, id, file);
  }

  @Get(':id/photo')
  async photo(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const buf = await this.svc.readPhoto(user, id);
    return new StreamableFile(buf, { type: 'image/jpeg' });
  }

  @Get(':id/documents')
  documents(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.listDocuments(user, id);
  }

  @Post(':id/documents')
  @Roles('OWNER', 'HEAD', 'FRONT_DESK')
  @UseInterceptors(FileInterceptor('file'))
  uploadDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('kind') kind: string,
    @UploadedFile() file: UploadedFileLike,
  ) {
    return this.svc.uploadDocument(user, id, kind, file);
  }

  @Post(':id/transfer')
  @Roles('OWNER', 'HEAD', 'FRONT_DESK')
  transfer(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ExitDto) {
    return this.svc.transfer(user, id, dto);
  }

  @Post(':id/withdraw')
  @Roles('OWNER', 'HEAD', 'FRONT_DESK')
  withdraw(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ExitDto) {
    return this.svc.withdraw(user, id, dto);
  }

  @Post()
  @Roles('OWNER', 'HEAD', 'FRONT_DESK', 'BURSAR')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateStudentDto) {
    return this.svc.create(user, dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'HEAD', 'FRONT_DESK')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateStudentDto) {
    return this.svc.update(user, id, dto);
  }
}

@Controller('documents')
export class StudentDocumentsController {
  constructor(private svc: StudentsService) {}

  @Get(':id')
  async read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { buffer, doc } = await this.svc.readDocument(user, id);
    return new StreamableFile(buffer, {
      type: doc.contentType,
      disposition: `attachment; filename="${doc.filename.replace(/"/g, '')}"`,
    });
  }

  @Delete(':id')
  @Roles('OWNER', 'HEAD', 'FRONT_DESK')
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
