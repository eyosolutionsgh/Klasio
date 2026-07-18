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
} from '@nestjs/common';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { LevelCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Roles } from '../common/auth';

const CATEGORIES = ['PRE_SCHOOL', 'PRIMARY', 'JHS', 'SHS'] as const;

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
        include: { level: true, _count: { select: { students: { where: { status: 'ACTIVE' } } } } },
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
        studentCount: c._count.students,
      })),
      subjects,
      years,
    };
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

    await this.db.$transaction([
      this.db.academicYear.updateMany({
        where: { schoolId: auth.schoolId },
        data: { isCurrent: false },
      }),
      this.db.term.updateMany({
        where: { academicYear: { schoolId: auth.schoolId } },
        data: { isCurrent: false },
      }),
      this.db.academicYear.update({
        where: { id: term.academicYearId },
        data: { isCurrent: true },
      }),
      this.db.term.update({ where: { id: termId }, data: { isCurrent: true } }),
    ]);
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
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'school.class.update', 'ClassRoom', id, dto);
    return cls;
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

  @Post('years')
  @Roles('OWNER', 'HEAD')
  createYear(@CurrentUser() user: AuthUser, @Body() dto: AcademicYearDto) {
    return this.svc.createYear(user, dto);
  }

  @Post('years/:id/terms')
  @Roles('OWNER', 'HEAD')
  createTerm(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: TermDto) {
    return this.svc.createTerm(user, id, dto);
  }

  @Patch('terms/:id')
  @Roles('OWNER', 'HEAD')
  updateTerm(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateTermDto) {
    return this.svc.updateTerm(user, id, dto);
  }

  @Post('terms/:id/current')
  @Roles('OWNER', 'HEAD')
  setCurrent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.setCurrentTerm(user, id);
  }

  @Post('levels')
  @Roles('OWNER', 'HEAD')
  createLevel(@CurrentUser() user: AuthUser, @Body() dto: LevelDto) {
    return this.svc.createLevel(user, dto);
  }

  @Patch('levels/:id')
  @Roles('OWNER', 'HEAD')
  updateLevel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateLevelDto) {
    return this.svc.updateLevel(user, id, dto);
  }

  @Delete('levels/:id')
  @Roles('OWNER', 'HEAD')
  deleteLevel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteLevel(user, id);
  }

  @Post('classes')
  @Roles('OWNER', 'HEAD')
  createClass(@CurrentUser() user: AuthUser, @Body() dto: ClassDto) {
    return this.svc.createClass(user, dto);
  }

  @Patch('classes/:id')
  @Roles('OWNER', 'HEAD')
  updateClass(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ClassDto) {
    return this.svc.updateClass(user, id, dto);
  }

  @Delete('classes/:id')
  @Roles('OWNER', 'HEAD')
  deleteClass(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteClass(user, id);
  }

  @Post('subjects')
  @Roles('OWNER', 'HEAD')
  createSubject(@CurrentUser() user: AuthUser, @Body() dto: SubjectDto) {
    return this.svc.createSubject(user, dto);
  }

  @Delete('subjects/:id')
  @Roles('OWNER', 'HEAD')
  deleteSubject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteSubject(user, id);
  }
}

@Module({ controllers: [SchoolsController], providers: [SchoolsService] })
export class SchoolsModule {}
