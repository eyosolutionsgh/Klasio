import {
  BadRequestException,
  Body,
  ConflictException,
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
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequireEntitlement, Roles } from '../common/auth';
import {
  Assignment,
  WEEKDAYS,
  findClash,
  findPeriodOverlap,
  formatMinutes,
} from '../common/timetable';

/** Midnight to midnight, so a period is always a real time of day. */
const MAX_MINUTE = 24 * 60;

class PeriodDto {
  @IsString() @MinLength(1) name: string;
  @IsInt() @Min(0) @Max(MAX_MINUTE) startsMin: number;
  @IsInt() @Min(0) @Max(MAX_MINUTE) endsMin: number;
  @IsOptional() @IsInt() order?: number;
  @IsOptional() @IsBoolean() isBreak?: boolean;
}

class UpdatePeriodDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_MINUTE) startsMin?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_MINUTE) endsMin?: number;
  @IsOptional() @IsInt() order?: number;
  @IsOptional() @IsBoolean() isBreak?: boolean;
}

class SlotDto {
  @IsString() classId: string;
  @IsString() periodId: string;
  @IsInt() @Min(1) @Max(5) weekday: number;
  /** Omitted leaves the slot unlabelled — a study period, or one not yet decided. */
  @IsOptional() @IsString() subjectId?: string;
  /** Omitted leaves the slot unstaffed. An unstaffed slot never clashes. */
  @IsOptional() @IsString() teacherId?: string;
  @IsOptional() @IsString() room?: string;
}

class UpdateSlotDto {
  @IsOptional() @IsString() subjectId?: string | null;
  @IsOptional() @IsString() teacherId?: string | null;
  @IsOptional() @IsString() room?: string | null;
}

/** What the service reads back to decide a clash — ids plus the names the message needs. */
const SLOT_CONTEXT = {
  classRoom: { select: { name: true } },
  period: { select: { name: true, isBreak: true, order: true, startsMin: true, endsMin: true } },
  subject: { select: { name: true, code: true } },
  teacher: { select: { name: true } },
} as const;

type SlotWithContext = {
  id: string;
  classId: string;
  periodId: string;
  weekday: number;
  teacherId: string | null;
  classRoom: { name: string };
  period: { name: string; isBreak: boolean };
};

/** Bridge from a stored row to the shape the pure clash rules speak. */
function toAssignment(s: SlotWithContext, teacherName?: string | null): Assignment {
  return {
    id: s.id,
    classId: s.classId,
    className: s.classRoom.name,
    periodId: s.periodId,
    periodName: s.period.name,
    periodIsBreak: s.period.isBreak,
    weekday: s.weekday,
    teacherId: s.teacherId,
    teacherName: teacherName ?? null,
  };
}

@Injectable()
export class TimetableService {
  constructor(private db: PrismaService) {}

  // ── The shape of the school day ────────────────────────────────────

  async periods(auth: AuthUser) {
    const periods = await this.db.timetablePeriod.findMany({
      where: { schoolId: auth.schoolId },
      orderBy: [{ order: 'asc' }, { startsMin: 'asc' }],
    });
    return periods.map((p) => ({
      ...p,
      startsAt: formatMinutes(p.startsMin),
      endsAt: formatMinutes(p.endsMin),
    }));
  }

  async createPeriod(auth: AuthUser, dto: PeriodDto) {
    if (dto.startsMin >= dto.endsMin) {
      throw new BadRequestException('A period must end after it starts');
    }
    const existing = await this.db.timetablePeriod.findMany({ where: { schoolId: auth.schoolId } });
    const overlap = findPeriodOverlap({ ...dto }, existing);
    if (overlap) {
      throw new ConflictException(
        `That time overlaps ${overlap.name} (${formatMinutes(overlap.startsMin)}–${formatMinutes(overlap.endsMin)})`,
      );
    }
    const period = await this.db.timetablePeriod.create({
      data: {
        schoolId: auth.schoolId,
        name: dto.name,
        startsMin: dto.startsMin,
        endsMin: dto.endsMin,
        // Default the order to the end of the day, which is where a new period almost always goes.
        order: dto.order ?? existing.length,
        isBreak: dto.isBreak ?? false,
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'timetable.period.create',
      'TimetablePeriod',
      period.id,
      { name: dto.name },
    );
    return period;
  }

  async updatePeriod(auth: AuthUser, id: string, dto: UpdatePeriodDto) {
    const existing = await this.db.timetablePeriod.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!existing) throw new NotFoundException('Period not found');

    const merged = {
      id,
      name: dto.name ?? existing.name,
      startsMin: dto.startsMin ?? existing.startsMin,
      endsMin: dto.endsMin ?? existing.endsMin,
      isBreak: dto.isBreak ?? existing.isBreak,
    };
    if (merged.startsMin >= merged.endsMin) {
      throw new BadRequestException('A period must end after it starts');
    }
    const others = await this.db.timetablePeriod.findMany({ where: { schoolId: auth.schoolId } });
    const overlap = findPeriodOverlap(merged, others);
    if (overlap) {
      throw new ConflictException(
        `That time overlaps ${overlap.name} (${formatMinutes(overlap.startsMin)}–${formatMinutes(overlap.endsMin)})`,
      );
    }

    // Turning a teaching period into a break would strand the lessons already in it, so make the
    // timetabler clear them first rather than silently hiding work they did.
    if (merged.isBreak && !existing.isBreak) {
      const lessons = await this.db.timetableSlot.count({
        where: { schoolId: auth.schoolId, periodId: id },
      });
      if (lessons > 0) {
        throw new BadRequestException(
          'Clear the lessons timetabled in this period before making it a break',
        );
      }
    }

    const period = await this.db.timetablePeriod.update({
      where: { id },
      data: {
        name: merged.name,
        startsMin: merged.startsMin,
        endsMin: merged.endsMin,
        isBreak: merged.isBreak,
        ...(dto.order !== undefined ? { order: dto.order } : {}),
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'timetable.period.update',
      'TimetablePeriod',
      id,
      dto as object,
    );
    return period;
  }

  async deletePeriod(auth: AuthUser, id: string) {
    const period = await this.db.timetablePeriod.findFirst({
      where: { id, schoolId: auth.schoolId },
      include: { _count: { select: { slots: true } } },
    });
    if (!period) throw new NotFoundException('Period not found');
    // The schema cascades, which is exactly why this guard is here: deleting a period would take
    // every lesson in it down with it across every class, silently.
    if (period._count.slots > 0) {
      throw new BadRequestException(
        `${period.name} still has ${period._count.slots} lesson(s) timetabled. Clear them first.`,
      );
    }
    await this.db.timetablePeriod.delete({ where: { id } });
    await this.db.audit(auth.schoolId, auth.sub, 'timetable.period.delete', 'TimetablePeriod', id);
    return { deleted: true };
  }

  // ── Assigning lessons ──────────────────────────────────────────────

  /**
   * Everything that could stand in the way of a placement on that weekday.
   *
   * Deliberately the whole school's slots for the day and not just the class's: a teacher clash
   * lives in another class by definition, so a narrower query would find nothing and the check
   * would pass every time.
   */
  private async dayAssignments(auth: AuthUser, weekday: number): Promise<Assignment[]> {
    const slots = await this.db.timetableSlot.findMany({
      where: { schoolId: auth.schoolId, weekday },
      include: SLOT_CONTEXT,
    });
    return slots.map((s) => toAssignment(s, s.teacher?.name));
  }

  async assign(auth: AuthUser, dto: SlotDto) {
    const [cls, period] = await Promise.all([
      this.db.classRoom.findFirst({ where: { id: dto.classId, schoolId: auth.schoolId } }),
      this.db.timetablePeriod.findFirst({ where: { id: dto.periodId, schoolId: auth.schoolId } }),
    ]);
    if (!cls) throw new NotFoundException('Class not found');
    if (!period) throw new NotFoundException('Period not found');

    const { subjectId, teacher } = await this.resolveSubjectAndTeacher(auth, dto);

    const proposed: Assignment = {
      classId: cls.id,
      className: cls.name,
      periodId: period.id,
      periodName: period.name,
      periodIsBreak: period.isBreak,
      weekday: dto.weekday,
      teacherId: teacher?.id ?? null,
      teacherName: teacher?.name ?? null,
    };
    const clash = findClash(proposed, await this.dayAssignments(auth, dto.weekday));
    // 409, not 500: the unique index on (class, period, weekday) would also catch the class case,
    // but as a Prisma error nobody outside the API can read. This gets in first, in English.
    if (clash) throw new ConflictException(clash.message);

    const slot = await this.db.timetableSlot.create({
      data: {
        schoolId: auth.schoolId,
        classId: cls.id,
        periodId: period.id,
        weekday: dto.weekday,
        subjectId: subjectId ?? null,
        teacherId: teacher?.id ?? null,
        room: dto.room ?? null,
      },
      include: SLOT_CONTEXT,
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'timetable.slot.assign',
      'TimetableSlot',
      slot.id,
      {
        class: cls.name,
        period: period.name,
        weekday: WEEKDAYS[dto.weekday - 1],
      },
    );
    return slot;
  }

  async updateSlot(auth: AuthUser, id: string, dto: UpdateSlotDto) {
    const slot = await this.db.timetableSlot.findFirst({
      where: { id, schoolId: auth.schoolId },
      include: SLOT_CONTEXT,
    });
    if (!slot) throw new NotFoundException('Timetable slot not found');

    const { subjectId, teacher } = await this.resolveSubjectAndTeacher(auth, {
      subjectId: dto.subjectId ?? undefined,
      teacherId: dto.teacherId ?? undefined,
    });
    const nextTeacherId = dto.teacherId === undefined ? slot.teacherId : (teacher?.id ?? null);

    // Re-check against the day with this row's own id carried through, so a slot that only
    // changes room or subject is never reported as clashing with itself.
    const proposed = { ...toAssignment(slot, slot.teacher?.name), teacherId: nextTeacherId };
    if (dto.teacherId !== undefined) proposed.teacherName = teacher?.name ?? null;
    const clash = findClash(proposed, await this.dayAssignments(auth, slot.weekday));
    if (clash) throw new ConflictException(clash.message);

    const updated = await this.db.timetableSlot.update({
      where: { id },
      data: {
        ...(dto.subjectId !== undefined ? { subjectId: subjectId ?? null } : {}),
        ...(dto.teacherId !== undefined ? { teacherId: nextTeacherId } : {}),
        ...(dto.room !== undefined ? { room: dto.room || null } : {}),
      },
      include: SLOT_CONTEXT,
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'timetable.slot.update',
      'TimetableSlot',
      id,
      dto as object,
    );
    return updated;
  }

  async clearSlot(auth: AuthUser, id: string) {
    const slot = await this.db.timetableSlot.findFirst({
      where: { id, schoolId: auth.schoolId },
      include: SLOT_CONTEXT,
    });
    if (!slot) throw new NotFoundException('Timetable slot not found');
    await this.db.timetableSlot.delete({ where: { id } });
    await this.db.audit(auth.schoolId, auth.sub, 'timetable.slot.clear', 'TimetableSlot', id, {
      class: slot.classRoom.name,
      period: slot.period.name,
      weekday: WEEKDAYS[slot.weekday - 1],
    });
    return { deleted: true };
  }

  /**
   * Resolve the two foreign keys a slot can carry, refusing anything from another school.
   *
   * There is no automatic tenant scoping, so an id arriving in the body is untrusted until it has
   * been found inside `auth.schoolId` — otherwise one school could staff its timetable with
   * another school's teachers.
   */
  private async resolveSubjectAndTeacher(
    auth: AuthUser,
    dto: { subjectId?: string; teacherId?: string },
  ) {
    let subjectId: string | undefined;
    if (dto.subjectId) {
      const subject = await this.db.subject.findFirst({
        where: { id: dto.subjectId, schoolId: auth.schoolId },
      });
      if (!subject) throw new NotFoundException('Subject not found');
      subjectId = subject.id;
    }
    let teacher: { id: string; name: string } | undefined;
    if (dto.teacherId) {
      const found = await this.db.user.findFirst({
        where: { id: dto.teacherId, schoolId: auth.schoolId, active: true },
        select: { id: true, name: true },
      });
      if (!found) throw new NotFoundException('Staff member not found');
      teacher = found;
    }
    return { subjectId, teacher };
  }

  // ── Reading the grid ───────────────────────────────────────────────

  /** The timetable a class sees: every period down the page, Monday to Friday across. */
  async byClass(auth: AuthUser, classId: string) {
    const cls = await this.db.classRoom.findFirst({
      where: { id: classId, schoolId: auth.schoolId },
    });
    if (!cls) throw new NotFoundException('Class not found');
    const slots = await this.db.timetableSlot.findMany({
      where: { schoolId: auth.schoolId, classId },
      include: SLOT_CONTEXT,
    });
    return {
      scope: { kind: 'CLASS' as const, id: cls.id, name: cls.name },
      periods: await this.periods(auth),
      slots: slots.map((s) => ({
        id: s.id,
        periodId: s.periodId,
        weekday: s.weekday,
        classId: s.classId,
        className: s.classRoom.name,
        subjectId: s.subjectId,
        subject: s.subject?.name ?? null,
        teacherId: s.teacherId,
        teacher: s.teacher?.name ?? null,
        room: s.room,
      })),
    };
  }

  /** The same grid from the other side: where one member of staff is, all week. */
  async byTeacher(auth: AuthUser, teacherId: string) {
    const teacher = await this.db.user.findFirst({
      where: { id: teacherId, schoolId: auth.schoolId },
      select: { id: true, name: true },
    });
    if (!teacher) throw new NotFoundException('Staff member not found');
    const slots = await this.db.timetableSlot.findMany({
      where: { schoolId: auth.schoolId, teacherId },
      include: SLOT_CONTEXT,
    });
    return {
      scope: { kind: 'TEACHER' as const, id: teacher.id, name: teacher.name },
      periods: await this.periods(auth),
      slots: slots.map((s) => ({
        id: s.id,
        periodId: s.periodId,
        weekday: s.weekday,
        classId: s.classId,
        className: s.classRoom.name,
        subjectId: s.subjectId,
        subject: s.subject?.name ?? null,
        teacherId: s.teacherId,
        teacher: s.teacher?.name ?? null,
        room: s.room,
      })),
    };
  }

  /**
   * Everything the timetable screen needs to populate its pickers.
   *
   * Served from here rather than `/users` because listing staff there is owner/head only, and a
   * teacher looking up their own timetable still needs to find their name in a list.
   */
  async options(auth: AuthUser) {
    const [classes, subjects, teachers] = await Promise.all([
      this.db.classRoom.findMany({
        where: { schoolId: auth.schoolId },
        include: { level: { select: { name: true, order: true } } },
        orderBy: [{ level: { order: 'asc' } }, { name: 'asc' }],
      }),
      this.db.subject.findMany({
        where: { schoolId: auth.schoolId },
        orderBy: [{ isCore: 'desc' }, { name: 'asc' }],
        select: { id: true, name: true, code: true },
      }),
      this.db.user.findMany({
        where: {
          schoolId: auth.schoolId,
          active: true,
          role: { in: ['TEACHER', 'HEAD', 'OWNER'] },
        },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, role: true },
      }),
    ]);
    return {
      classes: classes.map((c) => ({ id: c.id, name: c.name, level: c.level.name })),
      subjects,
      teachers,
      weekdays: WEEKDAYS.map((name, i) => ({ value: i + 1, name })),
    };
  }
}

@Controller('timetable')
// The whole feature is one entitlement — there is no half a timetable.
@RequireEntitlement('timetable.core')
export class TimetableController {
  constructor(private svc: TimetableService) {}

  @Get('options')
  options(@CurrentUser() user: AuthUser) {
    return this.svc.options(user);
  }

  @Get('periods')
  periods(@CurrentUser() user: AuthUser) {
    return this.svc.periods(user);
  }

  @Post('periods')
  @Roles('OWNER', 'HEAD')
  createPeriod(@CurrentUser() user: AuthUser, @Body() dto: PeriodDto) {
    return this.svc.createPeriod(user, dto);
  }

  @Patch('periods/:id')
  @Roles('OWNER', 'HEAD')
  updatePeriod(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePeriodDto,
  ) {
    return this.svc.updatePeriod(user, id, dto);
  }

  @Delete('periods/:id')
  @Roles('OWNER', 'HEAD')
  deletePeriod(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deletePeriod(user, id);
  }

  @Post('slots')
  @Roles('OWNER', 'HEAD')
  assign(@CurrentUser() user: AuthUser, @Body() dto: SlotDto) {
    return this.svc.assign(user, dto);
  }

  @Patch('slots/:id')
  @Roles('OWNER', 'HEAD')
  updateSlot(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateSlotDto) {
    return this.svc.updateSlot(user, id, dto);
  }

  @Delete('slots/:id')
  @Roles('OWNER', 'HEAD')
  clearSlot(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.clearSlot(user, id);
  }

  // Reading is open to any signed-in member of staff — a teacher has to be able to look up both
  // their own week and the class they are covering for.
  @Get('class/:classId')
  byClass(@CurrentUser() user: AuthUser, @Param('classId') classId: string) {
    return this.svc.byClass(user, classId);
  }

  @Get('teacher/:teacherId')
  byTeacher(@CurrentUser() user: AuthUser, @Param('teacherId') teacherId: string) {
    return this.svc.byTeacher(user, teacherId);
  }
}

@Module({ controllers: [TimetableController], providers: [TimetableService] })
export class TimetableModule {}
