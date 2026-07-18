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
  Put,
  Query,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CustomFieldKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { checklistFor, coerceFieldValues, fieldOptions } from '../common/customfields';

/**
 * What this school records about a child, over and above the fields we ship: extra fields
 * (NHIS number, house, bus stop) and the documents every child at a level is expected to have
 * on file. Both are "the school's own admissions policy, written down", which is why they live
 * in one module and one settings page.
 */

class FieldDefDto {
  @IsString() @MinLength(2) label: string;
  @IsOptional() @IsEnum(CustomFieldKind) kind?: CustomFieldKind;
  /** CHOICE only; ignored for every other kind, exactly as the column comment says. */
  @IsOptional() @IsArray() @ArrayMaxSize(50) options?: string[];
  @IsOptional() @IsString() levelId?: string;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsInt() order?: number;
}

class UpdateFieldDefDto {
  @IsOptional() @IsString() @MinLength(2) label?: string;
  @IsOptional() @IsEnum(CustomFieldKind) kind?: CustomFieldKind;
  @IsOptional() @IsArray() @ArrayMaxSize(50) options?: string[];
  @IsOptional() @IsString() levelId?: string | null;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsInt() order?: number;
}

class RequirementDto {
  @IsString() @MinLength(2) label: string;
  @IsString() @MinLength(2) kind: string;
  @IsOptional() @IsString() levelId?: string;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsInt() order?: number;
}

class UpdateRequirementDto {
  @IsOptional() @IsString() @MinLength(2) label?: string;
  @IsOptional() @IsString() @MinLength(2) kind?: string;
  @IsOptional() @IsString() levelId?: string | null;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsInt() order?: number;
}

class FieldValueDto {
  @IsString() fieldId: string;
  /** Null or blank clears the value; anything else is checked against the field's kind. */
  @IsOptional() @IsString() value?: string | null;
}

class SetFieldValuesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldValueDto)
  values: FieldValueDto[];
}

@Injectable()
export class CustomFieldsService {
  constructor(private db: PrismaService) {}

  /** Confirms a level belongs to the caller's school before anything is scoped to it. */
  private async ownLevel(auth: AuthUser, levelId: string | null | undefined) {
    if (!levelId) return null;
    const level = await this.db.level.findFirst({
      where: { id: levelId, schoolId: auth.schoolId },
    });
    if (!level) throw new NotFoundException('Level not found');
    return level.id;
  }

  private async ownStudent(auth: AuthUser, studentId: string) {
    const student = await this.db.student.findFirst({
      where: { id: studentId, schoolId: auth.schoolId },
      include: { classRoom: { select: { levelId: true } } },
    });
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  // ── Field definitions ──────────────────────────────────────────────

  async listFields(auth: AuthUser, levelId?: string) {
    const defs = await this.db.customFieldDef.findMany({
      where: {
        schoolId: auth.schoolId,
        // A level filter still includes the school-wide fields — those apply to every child.
        ...(levelId ? { OR: [{ levelId }, { levelId: null }] } : {}),
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return defs.map((d) => ({
      id: d.id,
      label: d.label,
      kind: d.kind,
      options: fieldOptions(d.options),
      levelId: d.levelId,
      required: d.required,
      order: d.order,
    }));
  }

  async createField(auth: AuthUser, dto: FieldDefDto) {
    const kind = dto.kind ?? 'TEXT';
    const options = fieldOptions(dto.options);
    // A CHOICE with nothing to choose from can never be filled in, so refuse it at the door
    // rather than letting the office discover it on a student page.
    if (kind === 'CHOICE' && options.length < 2) {
      throw new BadRequestException('A choice field needs at least two options');
    }
    const field = await this.db.customFieldDef.create({
      data: {
        schoolId: auth.schoolId,
        label: dto.label,
        kind,
        options: kind === 'CHOICE' ? options : undefined,
        levelId: await this.ownLevel(auth, dto.levelId),
        required: dto.required ?? false,
        order: dto.order ?? 0,
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'records.field.create',
      'CustomFieldDef',
      field.id,
      {
        label: dto.label,
        kind,
      },
    );
    return field;
  }

  async updateField(auth: AuthUser, id: string, dto: UpdateFieldDefDto) {
    const existing = await this.db.customFieldDef.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!existing) throw new NotFoundException('Field not found');
    const kind = dto.kind ?? existing.kind;
    const options =
      dto.options !== undefined ? fieldOptions(dto.options) : fieldOptions(existing.options);
    if (kind === 'CHOICE' && options.length < 2) {
      throw new BadRequestException('A choice field needs at least two options');
    }
    const field = await this.db.customFieldDef.update({
      where: { id },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.kind !== undefined ? { kind } : {}),
        // Changing a field away from CHOICE drops its options — leaving them behind would let a
        // field switched back later resurrect a list nobody remembers agreeing to.
        ...(dto.options !== undefined || dto.kind !== undefined
          ? { options: kind === 'CHOICE' ? options : Prisma.DbNull }
          : {}),
        ...(dto.levelId !== undefined ? { levelId: await this.ownLevel(auth, dto.levelId) } : {}),
        ...(dto.required !== undefined ? { required: dto.required } : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'records.field.update', 'CustomFieldDef', id, {
      ...dto,
    });
    return field;
  }

  /**
   * Deleting a field takes its recorded values with it (the FK cascades). Warn rather than
   * refuse: the office is entitled to stop collecting something, but should be told how much
   * data goes with it, so the count comes back in the audit row.
   */
  async deleteField(auth: AuthUser, id: string) {
    const field = await this.db.customFieldDef.findFirst({
      where: { id, schoolId: auth.schoolId },
      include: { _count: { select: { values: true } } },
    });
    if (!field) throw new NotFoundException('Field not found');
    await this.db.customFieldDef.delete({ where: { id } });
    await this.db.audit(auth.schoolId, auth.sub, 'records.field.delete', 'CustomFieldDef', id, {
      label: field.label,
      valuesDiscarded: field._count.values,
    });
    return { deleted: true, valuesDiscarded: field._count.values };
  }

  // ── Document requirements ──────────────────────────────────────────

  async listRequirements(auth: AuthUser, levelId?: string) {
    return this.db.documentRequirement.findMany({
      where: {
        schoolId: auth.schoolId,
        ...(levelId ? { OR: [{ levelId }, { levelId: null }] } : {}),
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createRequirement(auth: AuthUser, dto: RequirementDto) {
    const req = await this.db.documentRequirement.create({
      data: {
        schoolId: auth.schoolId,
        label: dto.label,
        // Kinds are matched against StudentDocument.kind, which is upper-case by convention.
        kind: dto.kind.trim().toUpperCase(),
        levelId: await this.ownLevel(auth, dto.levelId),
        required: dto.required ?? true,
        order: dto.order ?? 0,
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'records.requirement.create',
      'DocumentRequirement',
      req.id,
      { label: dto.label, kind: req.kind },
    );
    return req;
  }

  async updateRequirement(auth: AuthUser, id: string, dto: UpdateRequirementDto) {
    const existing = await this.db.documentRequirement.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!existing) throw new NotFoundException('Requirement not found');
    const req = await this.db.documentRequirement.update({
      where: { id },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.kind !== undefined ? { kind: dto.kind.trim().toUpperCase() } : {}),
        ...(dto.levelId !== undefined ? { levelId: await this.ownLevel(auth, dto.levelId) } : {}),
        ...(dto.required !== undefined ? { required: dto.required } : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'records.requirement.update',
      'DocumentRequirement',
      id,
      { ...dto },
    );
    return req;
  }

  async deleteRequirement(auth: AuthUser, id: string) {
    const req = await this.db.documentRequirement.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!req) throw new NotFoundException('Requirement not found');
    await this.db.documentRequirement.delete({ where: { id } });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'records.requirement.delete',
      'DocumentRequirement',
      id,
      { label: req.label },
    );
    return { deleted: true };
  }

  // ── One student ────────────────────────────────────────────────────

  /** The fields that apply to this child's level, each with whatever is recorded today. */
  async studentFields(auth: AuthUser, studentId: string) {
    const student = await this.ownStudent(auth, studentId);
    const [defs, values] = await Promise.all([
      this.listFields(auth, student.classRoom?.levelId ?? undefined),
      this.db.studentFieldValue.findMany({ where: { schoolId: auth.schoolId, studentId } }),
    ]);
    return defs.map((d) => ({
      ...d,
      value: values.find((v) => v.fieldId === d.id)?.value ?? '',
    }));
  }

  /**
   * Record a batch of values. Validation is the substance of the feature and lives in
   * `common/customfields.ts`; this method's only job is to establish which definitions are in
   * scope for this child and then write what came back.
   */
  async setStudentFields(auth: AuthUser, studentId: string, dto: SetFieldValuesDto) {
    const student = await this.ownStudent(auth, studentId);
    const defs = await this.listFields(auth, student.classRoom?.levelId ?? undefined);
    const checked = coerceFieldValues(
      defs,
      dto.values.map((v) => ({ fieldId: v.fieldId, value: v.value ?? null })),
    );
    if (!checked.ok) throw new BadRequestException(checked.message);

    // One transaction so a rejected half never lands: either the whole submission is recorded
    // or none of it is. A cleared value is deleted rather than stored blank, so "not recorded"
    // and "recorded as nothing" cannot drift apart.
    await this.db.$transaction(
      checked.values.map((v) =>
        v.value === ''
          ? this.db.studentFieldValue.deleteMany({ where: { studentId, fieldId: v.fieldId } })
          : this.db.studentFieldValue.upsert({
              where: { studentId_fieldId: { studentId, fieldId: v.fieldId } },
              create: {
                schoolId: auth.schoolId,
                studentId,
                fieldId: v.fieldId,
                value: v.value,
              },
              update: { value: v.value },
            }),
      ),
    );
    await this.db.audit(auth.schoolId, auth.sub, 'records.values.set', 'Student', studentId, {
      fields: checked.values.length,
    });
    return this.studentFields(auth, studentId);
  }

  /** Which required documents are on file for this child, and which are still outstanding. */
  async checklist(auth: AuthUser, studentId: string) {
    const student = await this.ownStudent(auth, studentId);
    const [requirements, documents] = await Promise.all([
      this.listRequirements(auth, student.classRoom?.levelId ?? undefined),
      this.db.studentDocument.findMany({
        where: { schoolId: auth.schoolId, studentId },
        select: { kind: true },
      }),
    ]);
    return checklistFor(requirements, documents);
  }
}

@Controller('records')
export class CustomFieldsController {
  constructor(private svc: CustomFieldsService) {}

  @Get('fields')
  listFields(@CurrentUser() user: AuthUser, @Query('levelId') levelId?: string) {
    return this.svc.listFields(user, levelId);
  }

  @Post('fields')
  @Roles('OWNER', 'HEAD')
  createField(@CurrentUser() user: AuthUser, @Body() dto: FieldDefDto) {
    return this.svc.createField(user, dto);
  }

  @Patch('fields/:id')
  @Roles('OWNER', 'HEAD')
  updateField(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateFieldDefDto,
  ) {
    return this.svc.updateField(user, id, dto);
  }

  @Delete('fields/:id')
  @Roles('OWNER', 'HEAD')
  deleteField(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteField(user, id);
  }

  @Get('requirements')
  listRequirements(@CurrentUser() user: AuthUser, @Query('levelId') levelId?: string) {
    return this.svc.listRequirements(user, levelId);
  }

  @Post('requirements')
  @Roles('OWNER', 'HEAD')
  createRequirement(@CurrentUser() user: AuthUser, @Body() dto: RequirementDto) {
    return this.svc.createRequirement(user, dto);
  }

  @Patch('requirements/:id')
  @Roles('OWNER', 'HEAD')
  updateRequirement(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateRequirementDto,
  ) {
    return this.svc.updateRequirement(user, id, dto);
  }

  @Delete('requirements/:id')
  @Roles('OWNER', 'HEAD')
  deleteRequirement(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteRequirement(user, id);
  }

  // Reading a child's extras is ordinary staff work; writing them is office work, so it is
  // held to the same roles that may edit the rest of the student record.
  @Get('students/:id/fields')
  studentFields(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.studentFields(user, id);
  }

  @Put('students/:id/fields')
  @Roles('OWNER', 'HEAD', 'FRONT_DESK')
  setStudentFields(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SetFieldValuesDto,
  ) {
    return this.svc.setStudentFields(user, id, dto);
  }

  @Get('students/:id/checklist')
  checklist(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.checklist(user, id);
  }
}

@Module({
  controllers: [CustomFieldsController],
  providers: [CustomFieldsService],
  exports: [CustomFieldsService],
})
export class CustomFieldsModule {}
