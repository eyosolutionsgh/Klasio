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
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { RemarkKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequireAnyPermission, RequirePermission } from '../common/auth';

/**
 * A bank of report-card comments.
 *
 * A class teacher writing forty reports in an evening either repeats themselves or writes
 * something thin, so the school keeps its own phrasing here and the editor offers it. Entries
 * may carry a score band, which is what makes the offer useful rather than a wall of text: a
 * child on 82 should be shown the remarks a school actually writes for a child on 82.
 */

class RemarkDto {
  @IsEnum(RemarkKind) kind: RemarkKind;
  @IsString() @MinLength(3) text: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) minScore?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) maxScore?: number;
}

class UpdateRemarkDto {
  @IsOptional() @IsEnum(RemarkKind) kind?: RemarkKind;
  @IsOptional() @IsString() @MinLength(3) text?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) minScore?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(100) maxScore?: number | null;
}

interface Banded {
  minScore: number | null;
  maxScore: number | null;
  uses: number;
}

/** Whether a score falls inside an entry's band. An open end means "no bound on that side". */
function bandCovers(r: Banded, score: number): boolean {
  return (r.minScore ?? 0) <= score && score <= (r.maxScore ?? 100);
}

@Injectable()
export class RemarksService {
  constructor(private db: PrismaService) {}

  /**
   * Remarks for a kind, best first.
   *
   * With a score, banded entries that fit come before general ones — a general remark is fine
   * for anybody and so tells the teacher nothing. Within each group the most-used float up,
   * which is how the school's own house style surfaces without anyone curating a list.
   */
  async list(auth: AuthUser, kind?: RemarkKind, score?: number) {
    const remarks = await this.db.remarkBank.findMany({
      where: { schoolId: auth.schoolId, ...(kind ? { kind } : {}) },
      orderBy: [{ uses: 'desc' }, { createdAt: 'asc' }],
    });
    const scored = typeof score === 'number' && Number.isFinite(score);
    const rows = scored
      ? remarks.filter((r) => (r.minScore === null && r.maxScore === null) || bandCovers(r, score))
      : remarks;
    return rows
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        text: r.text,
        minScore: r.minScore,
        maxScore: r.maxScore,
        uses: r.uses,
        /** True when this entry was chosen because its band fits the score, not by default. */
        matchesBand: scored && (r.minScore !== null || r.maxScore !== null),
      }))
      .sort((a, b) => Number(b.matchesBand) - Number(a.matchesBand) || b.uses - a.uses);
  }

  async create(auth: AuthUser, dto: RemarkDto) {
    if (dto.minScore !== undefined && dto.maxScore !== undefined && dto.minScore > dto.maxScore) {
      throw new BadRequestException('The band must start below where it ends');
    }
    const remark = await this.db.remarkBank.create({
      data: {
        schoolId: auth.schoolId,
        kind: dto.kind,
        text: dto.text.trim(),
        minScore: dto.minScore ?? null,
        maxScore: dto.maxScore ?? null,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'remark.create', 'RemarkBank', remark.id, {
      kind: dto.kind,
    });
    return remark;
  }

  async update(auth: AuthUser, id: string, dto: UpdateRemarkDto) {
    const existing = await this.db.remarkBank.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!existing) throw new NotFoundException('Remark not found');
    const min = dto.minScore !== undefined ? dto.minScore : existing.minScore;
    const max = dto.maxScore !== undefined ? dto.maxScore : existing.maxScore;
    if (min !== null && max !== null && min > max) {
      throw new BadRequestException('The band must start below where it ends');
    }
    const remark = await this.db.remarkBank.update({
      where: { id },
      data: {
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.text !== undefined ? { text: dto.text.trim() } : {}),
        ...(dto.minScore !== undefined ? { minScore: dto.minScore } : {}),
        ...(dto.maxScore !== undefined ? { maxScore: dto.maxScore } : {}),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'remark.update', 'RemarkBank', id, {
      ...dto,
    } as object);
    return remark;
  }

  async remove(auth: AuthUser, id: string) {
    const remark = await this.db.remarkBank.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!remark) throw new NotFoundException('Remark not found');
    await this.db.remarkBank.delete({ where: { id } });
    await this.db.audit(auth.schoolId, auth.sub, 'remark.delete', 'RemarkBank', id);
    return { deleted: true };
  }

  /**
   * Count one use. Deliberately not audited: this fires every time a teacher clicks a phrase,
   * and forty rows an evening saying "somebody picked a comment" would bury the audit log
   * without telling anyone anything the saved report does not already say.
   */
  async use(auth: AuthUser, id: string) {
    const updated = await this.db.remarkBank.updateMany({
      where: { id, schoolId: auth.schoolId },
      data: { uses: { increment: 1 } },
    });
    if (updated.count === 0) throw new NotFoundException('Remark not found');
    return { ok: true };
  }
}

@Controller('remarks')
export class RemarksController {
  constructor(private svc: RemarksService) {}

  // Anyone who can read a report card can read the bank of phrasing behind it.
  @Get()
  @RequirePermission('reports.view')
  list(
    @CurrentUser() user: AuthUser,
    @Query('kind') kind?: RemarkKind,
    @Query('score') score?: string,
  ) {
    const n = score === undefined || score === '' ? undefined : Number(score);
    // A query string is whatever the caller sends; an unknown kind must not reach Prisma.
    if (kind && !(kind in RemarkKind)) throw new BadRequestException('Unknown remark kind');
    return this.svc.list(user, kind, Number.isFinite(n) ? n : undefined);
  }

  // Anyone who writes a remark may add phrasing they find themselves typing; tidying the bank
  // needs authority over the school's assessment setup.
  @Post()
  @RequireAnyPermission('reports.remark.teacher', 'reports.remark.head')
  create(@CurrentUser() user: AuthUser, @Body() dto: RemarkDto) {
    return this.svc.create(user, dto);
  }

  @Post(':id/use')
  @RequireAnyPermission('reports.remark.teacher', 'reports.remark.head')
  use(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.use(user, id);
  }

  @Patch(':id')
  @RequirePermission('assessment.configure')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateRemarkDto) {
    return this.svc.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermission('assessment.configure')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}

@Module({
  controllers: [RemarksController],
  providers: [RemarksService],
  exports: [RemarksService],
})
export class RemarksModule {}
