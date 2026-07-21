/**
 * Syllabus coverage (FEATURES.md §6): what a class has actually been taught, against the scheme
 * of work. Topics are defined once per subject-and-level; each class ticks its way through them.
 *
 * Coverage is a fact, not a ledger — unmarking deletes the row. The audit trail carries who
 * changed what, as everywhere.
 */
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
} from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequireEntitlement, RequirePermission } from '../common/auth';

class TopicDto {
  @IsString() subjectId: string;
  @IsString() levelId: string;
  @IsString() @MinLength(2) @MaxLength(200) title: string;
  @IsOptional() @IsInt() order?: number;
}

class TopicUpdateDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) title?: string;
  @IsOptional() @IsInt() order?: number;
}

class CoverDto {
  @IsString() classId: string;
  @IsBoolean() covered: boolean;
}

@Injectable()
export class SyllabusService {
  constructor(private db: PrismaService) {}

  /** Topics for a subject at a level, with per-class coverage when a class is named. */
  async topics(auth: AuthUser, subjectId: string, levelId: string, classId?: string) {
    const rows = await this.db.syllabusTopic.findMany({
      where: { schoolId: auth.schoolId, subjectId, levelId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: classId ? { coverage: { where: { classId } } } : { coverage: false },
    });
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      order: t.order,
      covered: classId ? (t.coverage?.length ?? 0) > 0 : undefined,
      coveredAt: classId ? (t.coverage?.[0]?.coveredAt ?? null) : undefined,
    }));
  }

  /** Coverage percentage per class for one subject — the head's "where are we" view. */
  async summary(auth: AuthUser, subjectId: string) {
    const topics = await this.db.syllabusTopic.findMany({
      where: { schoolId: auth.schoolId, subjectId },
      select: { id: true, levelId: true },
    });
    const byLevel = new Map<string, string[]>();
    for (const t of topics) {
      byLevel.set(t.levelId, [...(byLevel.get(t.levelId) ?? []), t.id]);
    }
    const classes = await this.db.classRoom.findMany({
      where: { schoolId: auth.schoolId },
      select: { id: true, name: true, levelId: true },
      orderBy: { name: 'asc' },
    });
    const covered = await this.db.syllabusCoverage.groupBy({
      by: ['classId'],
      where: { schoolId: auth.schoolId, topic: { subjectId } },
      _count: true,
    });
    const coveredByClass = new Map(covered.map((c) => [c.classId, c._count]));
    return classes
      .filter((c) => (byLevel.get(c.levelId)?.length ?? 0) > 0)
      .map((c) => {
        const total = byLevel.get(c.levelId)!.length;
        const done = coveredByClass.get(c.id) ?? 0;
        return {
          classId: c.id,
          className: c.name,
          topics: total,
          covered: done,
          pct: Math.round((done / total) * 100),
        };
      });
  }

  async createTopic(auth: AuthUser, dto: TopicDto) {
    const [subject, level] = await Promise.all([
      this.db.subject.findFirst({ where: { id: dto.subjectId, schoolId: auth.schoolId } }),
      this.db.level.findFirst({ where: { id: dto.levelId, schoolId: auth.schoolId } }),
    ]);
    if (!subject || !level) throw new NotFoundException('Pick a subject and level from the list');
    const last = await this.db.syllabusTopic.findFirst({
      where: { schoolId: auth.schoolId, subjectId: dto.subjectId, levelId: dto.levelId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const topic = await this.db.syllabusTopic.create({
      data: {
        schoolId: auth.schoolId,
        subjectId: dto.subjectId,
        levelId: dto.levelId,
        title: dto.title.trim(),
        order: dto.order ?? (last?.order ?? 0) + 1,
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'syllabus.topic.create',
      'Subject',
      dto.subjectId,
      {
        title: dto.title,
      },
    );
    return { id: topic.id };
  }

  async updateTopic(auth: AuthUser, id: string, dto: TopicUpdateDto) {
    const topic = await this.db.syllabusTopic.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!topic) throw new NotFoundException('Topic not found');
    await this.db.syllabusTopic.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
      },
    });
    return { ok: true };
  }

  async deleteTopic(auth: AuthUser, id: string) {
    const topic = await this.db.syllabusTopic.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!topic) throw new NotFoundException('Topic not found');
    // Coverage rows cascade — a deleted topic cannot stay "covered".
    await this.db.syllabusTopic.delete({ where: { id } });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'syllabus.topic.delete',
      'Subject',
      topic.subjectId,
      {
        title: topic.title,
      },
    );
    return { ok: true };
  }

  /** Tick or untick one topic for one class. */
  async setCovered(auth: AuthUser, topicId: string, dto: CoverDto) {
    const topic = await this.db.syllabusTopic.findFirst({
      where: { id: topicId, schoolId: auth.schoolId },
    });
    if (!topic) throw new NotFoundException('Topic not found');
    const cls = await this.db.classRoom.findFirst({
      where: { id: dto.classId, schoolId: auth.schoolId },
    });
    if (!cls) throw new NotFoundException('Class not found');
    if (cls.levelId !== topic.levelId) {
      throw new BadRequestException("That class is not at this topic's level");
    }

    if (dto.covered) {
      await this.db.syllabusCoverage.upsert({
        where: { topicId_classId: { topicId, classId: dto.classId } },
        create: {
          schoolId: auth.schoolId,
          topicId,
          classId: dto.classId,
          coveredById: auth.sub,
        },
        update: {},
      });
    } else {
      await this.db.syllabusCoverage.deleteMany({
        where: { topicId, classId: dto.classId, schoolId: auth.schoolId },
      });
    }
    return { ok: true, covered: dto.covered };
  }
}

@Controller('syllabus')
@RequireEntitlement('timetable.core')
export class SyllabusController {
  constructor(private svc: SyllabusService) {}

  @Get('topics')
  @RequirePermission('marks.view')
  topics(
    @CurrentUser() user: AuthUser,
    @Query('subjectId') subjectId: string,
    @Query('levelId') levelId: string,
    @Query('classId') classId?: string,
  ) {
    if (!subjectId || !levelId) throw new BadRequestException('Pick a subject and a level');
    return this.svc.topics(user, subjectId, levelId, classId);
  }

  @Get('summary')
  @RequirePermission('marks.view')
  summary(@CurrentUser() user: AuthUser, @Query('subjectId') subjectId: string) {
    if (!subjectId) throw new BadRequestException('Pick a subject');
    return this.svc.summary(user, subjectId);
  }

  @Post('topics')
  @RequirePermission('assessment.configure')
  createTopic(@CurrentUser() user: AuthUser, @Body() dto: TopicDto) {
    return this.svc.createTopic(user, dto);
  }

  @Patch('topics/:id')
  @RequirePermission('assessment.configure')
  updateTopic(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: TopicUpdateDto) {
    return this.svc.updateTopic(user, id, dto);
  }

  @Delete('topics/:id')
  @RequirePermission('assessment.configure')
  deleteTopic(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteTopic(user, id);
  }

  /** Teachers tick coverage as they teach — the same permission as entering marks. */
  @Post('topics/:id/coverage')
  @RequirePermission('marks.enter')
  setCovered(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CoverDto) {
    return this.svc.setCovered(user, id, dto);
  }
}

@Module({
  controllers: [SyllabusController],
  providers: [SyllabusService],
})
export class SyllabusModule {}
