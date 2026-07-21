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
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { StreamableFile } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequireEntitlement, RequirePermission } from '../common/auth';
import { computePay } from '../common/payroll';
import { payslipPdf } from '../common/pdf';
import { storage } from '../common/storage';
import { Cell, toCsv } from '../common/export';

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

// ── Payroll ──────────────────────────────────────────────────────────

class PayProfileDto {
  @IsString() userId: string;
  @IsNumber() @Min(0) basicSalary: number;
  @IsOptional() @IsNumber() @Min(0) allowances?: number;
  @IsOptional() @IsNumber() @Min(0) deductions?: number;
  @IsOptional() @IsIn(['BANK', 'MOMO']) payoutMethod?: 'BANK' | 'MOMO';
  @IsOptional() @IsString() @MaxLength(60) payoutAccount?: string;
  @IsOptional() @IsString() @MaxLength(120) payoutName?: string;
}

class CreateRunDto {
  /** Calendar month, as YYYY-MM. */
  @IsString() period: string;
}

@Injectable()
export class PayrollService {
  constructor(private db: PrismaService) {}

  /** Everyone payable, with their profile where one exists — the setup screen's list. */
  async profiles(auth: AuthUser) {
    const staff = await this.db.user.findMany({
      where: { schoolId: auth.schoolId, active: true, role: { not: 'GUARDIAN' } },
      select: {
        id: true,
        name: true,
        staffRole: { select: { name: true } },
        payProfile: true,
      },
      orderBy: { name: 'asc' },
    });
    return staff.map((s) => ({
      userId: s.id,
      name: s.name,
      roleName: s.staffRole?.name ?? null,
      profile: s.payProfile
        ? {
            basicSalary: Number(s.payProfile.basicSalary),
            allowances: Number(s.payProfile.allowances),
            deductions: Number(s.payProfile.deductions),
            payoutMethod: s.payProfile.payoutMethod,
            payoutAccount: s.payProfile.payoutAccount,
            payoutName: s.payProfile.payoutName,
          }
        : null,
    }));
  }

  async saveProfile(auth: AuthUser, dto: PayProfileDto) {
    const user = await this.db.user.findFirst({
      where: { id: dto.userId, schoolId: auth.schoolId, role: { not: 'GUARDIAN' } },
    });
    if (!user) throw new NotFoundException('Staff member not found');
    await this.db.staffPayProfile.upsert({
      where: { userId: dto.userId },
      create: {
        schoolId: auth.schoolId,
        userId: dto.userId,
        basicSalary: dto.basicSalary,
        allowances: dto.allowances ?? 0,
        deductions: dto.deductions ?? 0,
        payoutMethod: dto.payoutMethod ?? 'BANK',
        payoutAccount: dto.payoutAccount,
        payoutName: dto.payoutName,
      },
      update: {
        basicSalary: dto.basicSalary,
        allowances: dto.allowances ?? 0,
        deductions: dto.deductions ?? 0,
        payoutMethod: dto.payoutMethod ?? 'BANK',
        payoutAccount: dto.payoutAccount ?? null,
        payoutName: dto.payoutName ?? null,
      },
    });
    // The figure itself stays out of the audit detail — the trail says who changed whose pay,
    // not what everyone earns.
    await this.db.audit(auth.schoolId, auth.sub, 'hr.payroll.profile', 'User', dto.userId);
    return { ok: true };
  }

  /** Compute one month for everyone with a profile. Snapshot on the line, DRAFT until approved. */
  async createRun(auth: AuthUser, dto: CreateRunDto) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(dto.period)) {
      throw new BadRequestException('The period must look like 2026-07');
    }
    const existing = await this.db.payRun.findUnique({
      where: { schoolId_period: { schoolId: auth.schoolId, period: dto.period } },
    });
    if (existing) {
      if (existing.status === 'APPROVED') {
        throw new BadRequestException('That month is approved and cannot be recomputed');
      }
      // Recomputing a draft replaces it — the run only becomes history at approval.
      await this.db.payRun.delete({ where: { id: existing.id } });
    }

    const profiles = await this.db.staffPayProfile.findMany({
      where: { schoolId: auth.schoolId, user: { active: true } },
      include: { user: { select: { name: true, staffRole: { select: { name: true } } } } },
    });
    if (profiles.length === 0) {
      throw new BadRequestException('Nobody has a pay profile yet — set salaries first');
    }

    const run = await this.db.payRun.create({
      data: {
        schoolId: auth.schoolId,
        period: dto.period,
        createdById: auth.sub,
        lines: {
          create: profiles.map((p) => {
            const line = computePay({
              basic: Number(p.basicSalary),
              allowances: Number(p.allowances),
              otherDeductions: Number(p.deductions),
            });
            return {
              schoolId: auth.schoolId,
              userId: p.userId,
              staffName: p.user.name,
              roleName: p.user.staffRole?.name ?? null,
              basic: line.basic,
              allowances: line.allowances,
              gross: line.gross,
              ssnitEmployee: line.ssnitEmployee,
              taxable: line.taxable,
              paye: line.paye,
              otherDeductions: line.otherDeductions,
              net: line.net,
              ssnitEmployer: line.ssnitEmployer,
              payoutMethod: p.payoutMethod,
              payoutAccount: p.payoutAccount,
              payoutName: p.payoutName ?? p.user.name,
            };
          }),
        },
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'hr.payroll.run', 'PayRun', run.id, {
      period: dto.period,
      staff: profiles.length,
    });
    return this.run(auth, run.id);
  }

  async runs(auth: AuthUser) {
    const rows = await this.db.payRun.findMany({
      where: { schoolId: auth.schoolId },
      include: {
        lines: { select: { net: true, paye: true, ssnitEmployee: true, ssnitEmployer: true } },
      },
      orderBy: { period: 'desc' },
      take: 24,
    });
    return rows.map((r) => ({
      id: r.id,
      period: r.period,
      status: r.status,
      staff: r.lines.length,
      totalNet: r.lines.reduce((s, l) => s + Number(l.net), 0),
      totalPaye: r.lines.reduce((s, l) => s + Number(l.paye), 0),
      totalSsnit: r.lines.reduce(
        (s, l) => s + Number(l.ssnitEmployee) + Number(l.ssnitEmployer),
        0,
      ),
    }));
  }

  async run(auth: AuthUser, id: string) {
    const run = await this.db.payRun.findFirst({
      where: { id, schoolId: auth.schoolId },
      include: { lines: { orderBy: { staffName: 'asc' } } },
    });
    if (!run) throw new NotFoundException('Pay run not found');
    return {
      id: run.id,
      period: run.period,
      status: run.status,
      lines: run.lines.map((l) => ({
        userId: l.userId,
        staffName: l.staffName,
        roleName: l.roleName,
        basic: Number(l.basic),
        allowances: Number(l.allowances),
        gross: Number(l.gross),
        ssnitEmployee: Number(l.ssnitEmployee),
        paye: Number(l.paye),
        otherDeductions: Number(l.otherDeductions),
        net: Number(l.net),
        ssnitEmployer: Number(l.ssnitEmployer),
        payoutMethod: l.payoutMethod,
      })),
    };
  }

  async approveRun(auth: AuthUser, id: string) {
    const run = await this.db.payRun.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!run) throw new NotFoundException('Pay run not found');
    if (run.status === 'APPROVED') throw new BadRequestException('Already approved');
    await this.db.payRun.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: auth.sub, approvedAt: new Date() },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'hr.payroll.approve', 'PayRun', id, {
      period: run.period,
    });
    return { ok: true };
  }

  async payslip(auth: AuthUser, runId: string, userId: string) {
    const line = await this.db.payRunLine.findFirst({
      where: { payRunId: runId, userId, schoolId: auth.schoolId },
      include: { payRun: { select: { period: true } } },
    });
    if (!line) throw new NotFoundException('No payslip for that person in that month');
    const school = await this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } });
    const buffer = await payslipPdf({
      school: {
        name: school.name,
        motto: school.motto,
        address: school.address,
        phone: school.phone,
        brandColor: school.brandColor,
        logo: school.logoUrl
          ? await storage()
              .get(school.logoUrl)
              .catch(() => null)
          : null,
      },
      period: line.payRun.period,
      staffName: line.staffName,
      roleName: line.roleName,
      figures: {
        basic: Number(line.basic),
        allowances: Number(line.allowances),
        gross: Number(line.gross),
        ssnitEmployee: Number(line.ssnitEmployee),
        taxable: Number(line.taxable),
        paye: Number(line.paye),
        otherDeductions: Number(line.otherDeductions),
        net: Number(line.net),
        ssnitEmployer: Number(line.ssnitEmployer),
      },
    });
    return {
      buffer,
      filename: `payslip-${line.payRun.period}-${line.staffName.replace(/\s+/g, '-')}.pdf`,
    };
  }

  /** The file the bank (or MoMo bulk-pay) takes: name, account, amount, for one method. */
  async payoutFile(auth: AuthUser, runId: string, method: 'BANK' | 'MOMO') {
    const run = await this.db.payRun.findFirst({
      where: { id: runId, schoolId: auth.schoolId },
      include: { lines: { where: { payoutMethod: method }, orderBy: { staffName: 'asc' } } },
    });
    if (!run) throw new NotFoundException('Pay run not found');
    const headers = [
      'Name',
      method === 'BANK' ? 'Account Number' : 'MoMo Number',
      'Amount',
      'Narration',
    ];
    const rows: Cell[][] = run.lines.map((l) => [
      l.payoutName ?? l.staffName,
      l.payoutAccount ?? '',
      Number(l.net),
      `Salary ${run.period}`,
    ]);
    return {
      buffer: toCsv(headers, rows),
      filename: `payout-${method.toLowerCase()}-${run.period}.csv`,
    };
  }
}

@Controller('payroll')
@RequireEntitlement('hr.payroll')
export class PayrollController {
  constructor(private svc: PayrollService) {}

  @Get('profiles')
  @RequirePermission('hr.payroll')
  profiles(@CurrentUser() user: AuthUser) {
    return this.svc.profiles(user);
  }

  @Post('profiles')
  @RequirePermission('hr.payroll')
  saveProfile(@CurrentUser() user: AuthUser, @Body() dto: PayProfileDto) {
    return this.svc.saveProfile(user, dto);
  }

  @Get('runs')
  @RequirePermission('hr.payroll')
  runs(@CurrentUser() user: AuthUser) {
    return this.svc.runs(user);
  }

  @Post('runs')
  @RequirePermission('hr.payroll')
  createRun(@CurrentUser() user: AuthUser, @Body() dto: CreateRunDto) {
    return this.svc.createRun(user, dto);
  }

  @Get('runs/:id')
  @RequirePermission('hr.payroll')
  run(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.run(user, id);
  }

  @Post('runs/:id/approve')
  @RequirePermission('hr.payroll')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.approveRun(user, id);
  }

  @Get('runs/:id/payslips/:userId')
  @RequirePermission('hr.payroll')
  async payslip(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    const { buffer, filename } = await this.svc.payslip(user, id, userId);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get('runs/:id/payout')
  @RequirePermission('hr.payroll')
  async payout(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('method') method = 'BANK',
  ) {
    if (method !== 'BANK' && method !== 'MOMO') {
      throw new BadRequestException('method must be BANK or MOMO');
    }
    const { buffer, filename } = await this.svc.payoutFile(user, id, method);
    return new StreamableFile(buffer, {
      type: 'text/csv',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}

@Module({
  controllers: [HrController, PayrollController],
  providers: [HrService, PayrollService],
  exports: [HrService],
})
export class HrModule {}
