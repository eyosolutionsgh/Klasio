/**
 * Staff attendance and leave (FEATURES.md §3/§17).
 *
 * The staff register mirrors the pupil one — one mark per person per day, upserted on a
 * composite key so a correction replaces rather than duplicates. Leave is a request/decision
 * pair with one hard rule the permission system cannot express on its own: nobody decides their
 * own request, whatever they hold. Separation of duties in its smallest form.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequireEntitlement, RequirePermission } from '../common/auth';

const STAFF_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const;
const LEAVE_KINDS = ['ANNUAL', 'SICK', 'MATERNITY', 'CASUAL', 'STUDY', 'OTHER'] as const;

class MarkStaffDto {
  @IsString() userId: string;
  @IsDateString() date: string;
  @IsIn(STAFF_STATUSES) status: (typeof STAFF_STATUSES)[number];
}

class LeaveRequestDto {
  @IsIn(LEAVE_KINDS) kind: (typeof LEAVE_KINDS)[number];
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
  @IsString() @MinLength(6) @MaxLength(500) reason: string;
}

class LeaveDecisionDto {
  @IsIn(['APPROVED', 'DECLINED']) status: 'APPROVED' | 'DECLINED';
  @IsOptional() @IsString() @MaxLength(500) decisionNote?: string;
}

/** Midnight of the given day, so a date-keyed upsert always lands on the same row. */
function dayOf(date: string): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class HrService {
  constructor(private db: PrismaService) {}

  // ── Staff register ─────────────────────────────────────────────────

  /** Everyone who can be marked today, with today's mark where one exists. */
  async roster(auth: AuthUser, date?: string) {
    const day = dayOf(date ?? new Date().toISOString());
    const [staff, marks, onLeave] = await Promise.all([
      this.db.user.findMany({
        where: { schoolId: auth.schoolId, active: true, role: { not: 'GUARDIAN' } },
        select: { id: true, name: true, staffRole: { select: { name: true } }, role: true },
        orderBy: { name: 'asc' },
      }),
      this.db.staffAttendanceRecord.findMany({
        where: { schoolId: auth.schoolId, date: day },
      }),
      // Approved leave covering this day shows on the register, so a marker is not left
      // wondering whether an absence is unexplained.
      this.db.leaveRequest.findMany({
        where: {
          schoolId: auth.schoolId,
          status: 'APPROVED',
          startDate: { lte: day },
          endDate: { gte: day },
        },
        select: { userId: true, kind: true },
      }),
    ]);
    const markByUser = new Map(marks.map((m) => [m.userId, m.status]));
    const leaveByUser = new Map(onLeave.map((l) => [l.userId, l.kind]));
    return staff.map((s) => ({
      userId: s.id,
      name: s.name,
      roleName: s.staffRole?.name ?? (s.role === 'OWNER' ? 'Proprietor' : s.role),
      status: markByUser.get(s.id) ?? null,
      onLeave: leaveByUser.get(s.id) ?? null,
    }));
  }

  async mark(auth: AuthUser, dto: MarkStaffDto) {
    const user = await this.db.user.findFirst({
      where: { id: dto.userId, schoolId: auth.schoolId, role: { not: 'GUARDIAN' } },
    });
    if (!user) throw new NotFoundException('Staff member not found');
    const day = dayOf(dto.date);
    await this.db.staffAttendanceRecord.upsert({
      where: {
        schoolId_userId_date: { schoolId: auth.schoolId, userId: dto.userId, date: day },
      },
      create: {
        schoolId: auth.schoolId,
        userId: dto.userId,
        date: day,
        status: dto.status,
        recordedById: auth.sub,
      },
      update: { status: dto.status, recordedById: auth.sub, recordedAt: new Date() },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'hr.attendance.mark', 'User', dto.userId, {
      date: dto.date,
      status: dto.status,
    });
    return { ok: true };
  }

  // ── Leave ──────────────────────────────────────────────────────────

  async requestLeave(auth: AuthUser, dto: LeaveRequestDto) {
    const start = dayOf(dto.startDate);
    const end = dayOf(dto.endDate);
    if (end < start) throw new BadRequestException('Leave cannot end before it starts');

    // A second live request over the same days is a duplicate, not a new ask.
    const overlapping = await this.db.leaveRequest.findFirst({
      where: {
        schoolId: auth.schoolId,
        userId: auth.sub,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: end },
        endDate: { gte: start },
      },
    });
    if (overlapping) {
      throw new BadRequestException(
        'You already have a pending or approved request over those days',
      );
    }

    const req = await this.db.leaveRequest.create({
      data: {
        schoolId: auth.schoolId,
        userId: auth.sub,
        kind: dto.kind,
        startDate: start,
        endDate: end,
        reason: dto.reason.trim(),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'hr.leave.request', 'User', auth.sub, {
      kind: dto.kind,
      startDate: dto.startDate,
      endDate: dto.endDate,
    });
    return { id: req.id, status: req.status };
  }

  async myLeave(auth: AuthUser) {
    const rows = await this.db.leaveRequest.findMany({
      where: { schoolId: auth.schoolId, userId: auth.sub },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((r) => this.shape(r, null));
  }

  async cancelLeave(auth: AuthUser, id: string) {
    const req = await this.db.leaveRequest.findFirst({
      where: { id, schoolId: auth.schoolId, userId: auth.sub },
    });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== 'PENDING') {
      throw new BadRequestException('Only a pending request can be withdrawn');
    }
    await this.db.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
    return { ok: true };
  }

  async listLeave(auth: AuthUser, status?: string) {
    const rows = await this.db.leaveRequest.findMany({
      where: {
        schoolId: auth.schoolId,
        ...(status ? { status: status as 'PENDING' | 'APPROVED' | 'DECLINED' } : {}),
      },
      include: { user: { select: { name: true, staffRole: { select: { name: true } } } } },
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
      take: 200,
    });
    return rows.map((r) => this.shape(r, r.user));
  }

  async decideLeave(auth: AuthUser, id: string, dto: LeaveDecisionDto) {
    const req = await this.db.leaveRequest.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== 'PENDING') throw new BadRequestException('That request is already decided');
    // The one rule the permission grid cannot carry: holding hr.leave never covers your own ask.
    if (req.userId === auth.sub) {
      throw new BadRequestException('Someone else must decide your own leave');
    }
    await this.db.leaveRequest.update({
      where: { id },
      data: {
        status: dto.status,
        decisionNote: dto.decisionNote,
        decidedById: auth.sub,
        decidedAt: new Date(),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'hr.leave.decide', 'User', req.userId, {
      status: dto.status,
    });
    return { ok: true, status: dto.status };
  }

  private shape(
    r: {
      id: string;
      kind: string;
      startDate: Date;
      endDate: Date;
      reason: string;
      status: string;
      decisionNote: string | null;
      createdAt: Date;
    },
    user: { name: string; staffRole: { name: string } | null } | null,
  ) {
    return {
      id: r.id,
      ...(user ? { staff: user.name, roleName: user.staffRole?.name ?? null } : {}),
      kind: r.kind,
      startDate: r.startDate,
      endDate: r.endDate,
      reason: r.reason,
      status: r.status,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt,
    };
  }
}

@Controller('hr')
@RequireEntitlement('hr.attendance')
export class HrController {
  constructor(private svc: HrService) {}

  @Get('attendance')
  @RequirePermission('hr.attendance')
  roster(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    return this.svc.roster(user, date);
  }

  @Post('attendance/mark')
  @RequirePermission('hr.attendance')
  mark(@CurrentUser() user: AuthUser, @Body() dto: MarkStaffDto) {
    return this.svc.mark(user, dto);
  }

  /** Any signed-in member of staff may ask for leave — no permission needed for your own. */
  @Post('leave')
  requestLeave(@CurrentUser() user: AuthUser, @Body() dto: LeaveRequestDto) {
    return this.svc.requestLeave(user, dto);
  }

  @Get('leave/mine')
  myLeave(@CurrentUser() user: AuthUser) {
    return this.svc.myLeave(user);
  }

  @Post('leave/:id/cancel')
  cancelLeave(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.cancelLeave(user, id);
  }

  @Get('leave')
  @RequirePermission('hr.leave')
  listLeave(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.svc.listLeave(user, status);
  }

  @Patch('leave/:id')
  @RequirePermission('hr.leave')
  decideLeave(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: LeaveDecisionDto,
  ) {
    return this.svc.decideLeave(user, id, dto);
  }
}

@Module({
  controllers: [HrController],
  providers: [HrService],
  exports: [HrService],
})
export class HrModule {}
