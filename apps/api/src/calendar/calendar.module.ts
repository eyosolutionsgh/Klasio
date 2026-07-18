import {
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
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { EventAudience } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequireEntitlement, Roles } from '../common/auth';

class CreateEventDto {
  @IsString() @MinLength(3) title: string;
  @IsOptional() @IsString() details?: string;
  @IsDateString() startsAt: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsBoolean() allDay?: boolean;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsEnum(EventAudience) audience?: EventAudience;
  /** Omit for a whole-school event; set to confine it to one level's classes and families. */
  @IsOptional() @IsString() levelId?: string;
}

class UpdateEventDto {
  @IsOptional() @IsString() @MinLength(3) title?: string;
  @IsOptional() @IsString() details?: string;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsBoolean() allDay?: boolean;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsEnum(EventAudience) audience?: EventAudience;
  @IsOptional() @IsString() levelId?: string;
}

/** Midnight today, so "upcoming" still includes an event happening this morning. */
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * A bare date ("2026-09-14") parses as midnight, which would exclude everything on the closing
 * day of the range. Push it to the end of that day; full timestamps are left alone.
 */
function rangeEnd(value: string): Date {
  const d = new Date(value);
  if (!value.includes('T')) d.setHours(23, 59, 59, 999);
  return d;
}

@Injectable()
export class CalendarService {
  constructor(private db: PrismaService) {}

  /** Staff see every event, whatever its audience — they are the ones who publish them. */
  async list(auth: AuthUser, from?: string, to?: string, audience?: EventAudience) {
    const events = await this.db.calendarEvent.findMany({
      where: {
        schoolId: auth.schoolId,
        ...(from || to
          ? {
              startsAt: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: rangeEnd(to) } : {}),
              },
            }
          : {}),
        ...(audience ? { audience } : {}),
      },
      include: { level: { select: { name: true } } },
      orderBy: { startsAt: 'asc' },
      take: 300,
    });
    return events.map((e) => ({
      id: e.id,
      title: e.title,
      details: e.details,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      allDay: e.allDay,
      location: e.location,
      audience: e.audience,
      levelId: e.levelId,
      levelName: e.level?.name ?? null,
    }));
  }

  private async assertLevel(auth: AuthUser, levelId?: string) {
    if (!levelId) return;
    const level = await this.db.level.findFirst({
      where: { id: levelId, schoolId: auth.schoolId },
    });
    if (!level) throw new NotFoundException('That level does not exist');
  }

  async create(auth: AuthUser, dto: CreateEventDto) {
    await this.assertLevel(auth, dto.levelId);
    const event = await this.db.calendarEvent.create({
      data: {
        schoolId: auth.schoolId,
        title: dto.title,
        details: dto.details,
        startsAt: new Date(dto.startsAt),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        allDay: dto.allDay ?? true,
        location: dto.location,
        audience: dto.audience ?? 'ALL',
        levelId: dto.levelId ?? null,
        createdById: auth.sub,
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'calendar.event.create',
      'CalendarEvent',
      event.id,
      {
        title: event.title,
      },
    );
    return event;
  }

  async update(auth: AuthUser, id: string, dto: UpdateEventDto) {
    const existing = await this.db.calendarEvent.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!existing) throw new NotFoundException('Event not found');
    await this.assertLevel(auth, dto.levelId);
    const event = await this.db.calendarEvent.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.details !== undefined ? { details: dto.details } : {}),
        ...(dto.startsAt !== undefined ? { startsAt: new Date(dto.startsAt) } : {}),
        ...(dto.endsAt !== undefined ? { endsAt: dto.endsAt ? new Date(dto.endsAt) : null } : {}),
        ...(dto.allDay !== undefined ? { allDay: dto.allDay } : {}),
        ...(dto.location !== undefined ? { location: dto.location } : {}),
        ...(dto.audience !== undefined ? { audience: dto.audience } : {}),
        // An empty string is how the form says "whole school again".
        ...(dto.levelId !== undefined ? { levelId: dto.levelId || null } : {}),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'calendar.event.update', 'CalendarEvent', id, {
      title: event.title,
    });
    return event;
  }

  async remove(auth: AuthUser, id: string) {
    const event = await this.db.calendarEvent.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!event) throw new NotFoundException('Event not found');
    await this.db.calendarEvent.delete({ where: { id } });
    await this.db.audit(auth.schoolId, auth.sub, 'calendar.event.delete', 'CalendarEvent', id, {
      title: event.title,
    });
    return { deleted: true };
  }

  /**
   * The subset of the calendar a family or a pupil may see, used by the guardian and student
   * portals. Two filters do the work: the audience the event was written for, and the level it
   * was confined to — a Class 4 outing is not news to a JHS parent.
   *
   * STAFF events never appear here, because `audience` is only ever GUARDIANS or STUDENTS.
   */
  async feed(schoolId: string, audience: 'GUARDIANS' | 'STUDENTS', levelIds: string[]) {
    const events = await this.db.calendarEvent.findMany({
      where: {
        schoolId,
        audience: { in: ['ALL', audience] },
        OR: [{ levelId: null }, { levelId: { in: levelIds } }],
        startsAt: { gte: startOfToday() },
      },
      include: { level: { select: { name: true } } },
      orderBy: { startsAt: 'asc' },
      take: 30,
    });
    return events.map((e) => ({
      id: e.id,
      title: e.title,
      details: e.details,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      allDay: e.allDay,
      location: e.location,
      levelName: e.level?.name ?? null,
    }));
  }
}

/**
 * The calendar ships with announcements in the comms bundle, so it is gated on the same code —
 * a school that may post notices may also publish term dates.
 */
@Controller('calendar')
@RequireEntitlement('comms.announcements')
export class CalendarController {
  constructor(private svc: CalendarService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('audience') audience?: EventAudience,
  ) {
    return this.svc.list(user, from, to, audience);
  }

  @Post()
  @Roles('OWNER', 'HEAD', 'FRONT_DESK')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateEventDto) {
    return this.svc.create(user, dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'HEAD', 'FRONT_DESK')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.svc.update(user, id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'HEAD', 'FRONT_DESK')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}

@Module({
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
