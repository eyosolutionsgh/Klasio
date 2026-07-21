import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FileInterceptor } from '@nestjs/platform-express';
import { DOCUMENT_TYPES, MAX_UPLOAD_BYTES, objectKey, storage } from '../common/storage';

/** Minimal shape of the raw-body request — avoids depending on @types/express. */
interface RawRequest {
  rawBody?: Buffer;
  body?: unknown;
  headers: Record<string, string | undefined>;
}

/** Minimal shape of a Multer upload — avoids depending on @types/multer. */
interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}
import { DepositStatus, PaymentMethod, Prisma } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaService, withTenant } from '../prisma/prisma.service';
import { markSchedule, scheduleTotals } from '../common/installments';
import { concessionsFor, rankSiblings } from '../common/concessions';
import { SmsModule, SmsService } from '../sms/sms.module';
import { IntegrationsModule, IntegrationsService } from '../integrations/integrations.module';
import {
  AuthUser,
  CurrentUser,
  Public,
  RequireEntitlement,
  RequirePermission,
} from '../common/auth';
import { verifyQstashSignature } from '../common/qstash';
import { receiptPdf, statementPdf, tableReportPdf } from '../common/pdf';
import { statementLines } from '../common/statement';
import { toCsv, toXlsx, Cell } from '../common/export';
import { balanceOf } from '../common/ledger';
import { nextInSequence, refNumber } from '../common/sequences';
import { MESSAGE_TEMPLATES, listTemplates, renderMessage } from '../common/templates';
import { journalLines, journalTotals } from '../common/journal';
import { PageQuery, dateWindow, orderBy, pageArgs, toPage } from '../common/list-query';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** One family's arrears as of a term. Computed, never a row — see `FeesService.defaulters`. */
interface DefaulterRow {
  studentId: string;
  name: string;
  admissionNo: string;
  className: string;
  /** Carried so the list can be filtered by class without a second lookup per row. */
  classId: string | null;
  phone: string | null;
  balance: number;
}

/**
 * Which columns the defaulter list may be ordered by, and how each is read off a row.
 *
 * Functions rather than Prisma paths, because this list is not a query. A balance is folded out
 * of the ledger by `balanceOf` — a REVERSAL cancels one named entry — so there is no `groupBy`
 * that yields it and nothing for the database to sort or offset by. Everything happens on the
 * computed rows; the allowlist survives only so that an unrecognised `sort` from a stale bookmark
 * falls back to "largest debt first" rather than erroring.
 */
const DEFAULTER_SORTS: Record<string, (r: DefaulterRow) => string | number> = {
  name: (r) => r.name.toLowerCase(),
  admissionNo: (r) => r.admissionNo,
  className: (r) => r.className,
  balance: (r) => r.balance,
};

/**
 * Sortable columns on the bank-deposit queue. Dotted values reach through the relation, exactly
 * as the register's allowlist does. `proof` is absent: sorting by whether a file is attached
 * would order the queue by something the reviewer already sees at a glance.
 */
const DEPOSIT_SORTS: Record<string, string | string[]> = {
  student: ['student.lastName', 'student.firstName'],
  admissionNo: 'student.admissionNo',
  reference: 'reference',
  amount: 'amount',
  bankName: 'bankName',
  depositedAt: 'depositedAt',
  status: 'status',
  createdAt: 'createdAt',
};

/**
 * Filters for the defaulter list.
 *
 * `from`/`to` come with `PageQuery` but are deliberately ignored here. An arrear is a running
 * total, not an event: "everyone who owed money in March" is not a question the ledger can
 * answer by date, and answering a near-miss of it would report a number a bursar would then
 * chase. `termId` is the as-of point, and it is the only time input this list takes.
 */
class ListDefaultersDto extends PageQuery {
  @IsString() termId: string;
  @IsOptional() @IsString() classId?: string;
  /** Matches a name or an admission number, like the register's search does. */
  @IsOptional() @IsString() q?: string;
}

/** Filters for the bank-deposit queue. `from`/`to` window the deposit date — see `listDeposits`. */
class ListDepositsDto extends PageQuery {
  @IsOptional() @IsEnum(DepositStatus) status?: DepositStatus;
  @IsOptional() @IsString() studentId?: string;
}

class RecordPaymentDto {
  @IsString() studentId: string;
  @IsNumber() @IsPositive() amount: number;
  @IsEnum(PaymentMethod) method: PaymentMethod;
  @IsOptional() @IsString() note?: string;
  /** Term the money settles. Defaults to the current term; set it to clear an older arrear. */
  @IsOptional() @IsString() termId?: string;
}

class ReverseDto {
  /** Required: an unexplained reversal is indistinguishable from someone hiding a payment. */
  @IsString() @MinLength(4) reason: string;
}

class FeeClearanceDto {
  @IsString() studentId: string;
  @IsString() termId: string;
  /** Same rule as a reversal or a scholarship: state why, or it is a favour rather than a decision. */
  @IsString() @MinLength(4) reason: string;
}

class ConcessionDto {
  @IsString() studentId: string;
  @IsNumber() @IsPositive() amount: number;
  @IsIn(['DISCOUNT', 'WAIVER']) type: 'DISCOUNT' | 'WAIVER';
  /** Required: a concession without a stated reason is indistinguishable from a mistake. */
  @IsString() @MinLength(4) reason: string;
  @IsOptional() @IsString() termId?: string;
}

class ReminderScheduleDto {
  @IsBoolean() enabled: boolean;
  /** 0-6, Sunday = 0. Omit for every weekday. */
  @IsOptional() @IsNumber() @Min(0) dayOfWeek?: number;
  @IsOptional() @IsNumber() @Min(0) hour?: number;
}

class StudentFeeItemDto {
  @IsString() feeItemId: string;
  @IsBoolean() subscribed: boolean;
}

class GenerateInvoicesDto {
  @IsString() termId: string;
  @IsOptional() @IsString() classId?: string;
}

class FeeItemDto {
  @IsString() termId: string;
  @IsString() @MinLength(2) name: string;
  @IsNumber() @Min(0) amount: number;
  @IsOptional() @IsString() levelId?: string;
  @IsOptional() @IsBoolean() optional?: boolean;
}

class BankDepositDto {
  @IsString() studentId: string;
  // Multipart fields arrive as strings, so coerce before validating.
  @Type(() => Number) @IsNumber() @IsPositive() amount: number;
  @IsDateString() depositedAt: string;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() bankRef?: string;
  @IsOptional() @IsString() note?: string;
}

class UpdateFeeItemDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsString() levelId?: string | null;
  @IsOptional() @IsBoolean() optional?: boolean;
}

/** One slice of a payment plan. Validated in the service against the bill it splits. */
class InstallmentPartDto {
  @IsNumber() @IsPositive() amount: number;
  @IsDateString() dueDate: string;
  @IsOptional() @IsString() note?: string;
}

class InstallmentPlanDto {
  @IsString() studentId: string;
  @IsOptional() @IsString() invoiceId?: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InstallmentPartDto)
  parts: InstallmentPartDto[];
}

class ConcessionRuleDto {
  @IsString() @MinLength(2) name: string;
  @IsIn(['SCHOLARSHIP', 'SIBLING']) kind: 'SCHOLARSHIP' | 'SIBLING';
  @IsIn(['PERCENT', 'AMOUNT']) basis: 'PERCENT' | 'AMOUNT';
  @IsNumber() @IsPositive() value: number;
  /** SIBLING only: which child the discount starts at, eldest first. */
  @IsOptional() @IsInt() @Min(2) fromSibling?: number;
  @IsOptional() @IsString() levelId?: string;
  @IsOptional() @IsDateString() startsOn?: string;
  @IsOptional() @IsDateString() endsOn?: string;
}

class AwardDto {
  @IsString() ruleId: string;
  @IsString() studentId: string;
  /** A scholarship without a stated reason is a favour, not a policy. */
  @IsString() @MinLength(4) reason: string;
}

class RolloverDto {
  @IsString() fromTermId: string;
  @IsString() toTermId: string;
}

class TopUpDto {
  @IsInt() @Min(1) credits: number;
  /** How the school paid for them — ties the credits to a real transfer. */
  @IsString() @MinLength(3) reference: string;
}

/**
 * The year a reference carries.
 *
 * Was hardcoded to 2026, which would have printed "RCP-2026-00041" on a receipt issued in
 * January 2027. The sequence itself is global and never resets, so no number can collide — only
 * the label was wrong, which is exactly the kind of thing nobody notices until a parent queries a
 * receipt.
 */
const refYear = () => new Date().getFullYear();

@Injectable()
export class FeesService {
  constructor(
    private db: PrismaService,
    private sms: SmsService,
    private integrations: IntegrationsService,
  ) {}

  /**
   * Ledger filter for "everything owed as of this term" — that term and every earlier one, plus
   * entries with no term (opening balances carried in at onboarding).
   *
   * What a family owes is cumulative: a payment made this term against last term's arrears has
   * to net against last term's invoice. Scoping a balance to a single term reports money as
   * outstanding that has already been collected.
   */
  private async asOfTerm(auth: AuthUser, termId: string) {
    const target = await this.db.term.findFirst({
      where: { id: termId, academicYear: { schoolId: auth.schoolId } },
    });
    if (!target) throw new NotFoundException('Term not found');
    const terms = await this.db.term.findMany({
      where: {
        academicYear: { schoolId: auth.schoolId },
        startDate: { lte: target.startDate },
      },
      select: { id: true },
    });
    return {
      schoolId: auth.schoolId,
      OR: [{ termId: { in: terms.map((t) => t.id) } }, { termId: null }],
    };
  }

  async overview(auth: AuthUser, termId: string) {
    const [invoiced, collected, byMethod, recent, defaulters] = await Promise.all([
      this.db.ledgerEntry.aggregate({
        where: { schoolId: auth.schoolId, termId, type: 'INVOICE' },
        _sum: { amount: true },
      }),
      this.db.ledgerEntry.aggregate({
        where: { schoolId: auth.schoolId, termId, type: { in: ['PAYMENT', 'DISCOUNT', 'WAIVER'] } },
        _sum: { amount: true },
      }),
      this.db.ledgerEntry.groupBy({
        by: ['method'],
        where: { schoolId: auth.schoolId, termId, type: 'PAYMENT' },
        _sum: { amount: true },
      }),
      this.db.ledgerEntry.findMany({
        where: { schoolId: auth.schoolId, type: 'PAYMENT' },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          student: {
            select: { firstName: true, lastName: true, classRoom: { select: { name: true } } },
          },
          receipt: { select: { number: true } },
        },
      }),
      this.defaulters(auth, termId),
    ]);
    const defaulterCount = defaulters.length;
    const money = (n: number) => Math.round(n * 100) / 100;
    // Invoiced and collected are this term's cash flow. Outstanding is not: it is what families
    // still owe in total, so it sums the cumulative balances rather than this term's difference.
    const outstanding = defaulters.reduce((sum, d) => sum + d.balance, 0);
    return {
      invoiced: money(Number(invoiced._sum.amount ?? 0)),
      collected: money(Number(collected._sum.amount ?? 0)),
      outstanding: money(outstanding),
      byMethod: byMethod.map((m) => ({ method: m.method, amount: Number(m._sum.amount ?? 0) })),
      recentPayments: recent.map((p) => ({
        id: p.id,
        student: `${p.student.firstName} ${p.student.lastName}`,
        className: p.student.classRoom?.name ?? '—',
        amount: Number(p.amount),
        method: p.method,
        reference: p.reference,
        receiptNumber: p.receipt?.number,
        createdAt: p.createdAt,
      })),
      defaulterCount,
    };
  }

  async items(auth: AuthUser, termId: string) {
    const items = await this.db.feeItem.findMany({ where: { schoolId: auth.schoolId, termId } });
    return items.map((i) => ({ ...i, amount: Number(i.amount) }));
  }

  async createFeeItem(auth: AuthUser, dto: FeeItemDto) {
    if (dto.levelId) {
      const level = await this.db.level.findFirst({
        where: { id: dto.levelId, schoolId: auth.schoolId },
      });
      if (!level) throw new NotFoundException('Level not found');
    }
    const item = await this.db.feeItem.create({
      data: {
        schoolId: auth.schoolId,
        termId: dto.termId,
        name: dto.name,
        amount: new Prisma.Decimal(dto.amount),
        levelId: dto.levelId ?? null,
        optional: dto.optional ?? false,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'fees.item.create', 'FeeItem', item.id, {
      name: item.name,
      amount: dto.amount,
    });
    return { ...item, amount: Number(item.amount) };
  }

  async updateFeeItem(auth: AuthUser, id: string, dto: UpdateFeeItemDto) {
    const existing = await this.db.feeItem.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!existing) throw new NotFoundException('Fee item not found');
    const item = await this.db.feeItem.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.amount !== undefined ? { amount: new Prisma.Decimal(dto.amount) } : {}),
        ...(dto.levelId !== undefined ? { levelId: dto.levelId || null } : {}),
        ...(dto.optional !== undefined ? { optional: dto.optional } : {}),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'fees.item.update', 'FeeItem', id, dto as object);
    return { ...item, amount: Number(item.amount) };
  }

  /**
   * Remove a fee item from the structure. Invoices already issued are untouched — each one
   * carries its own `lines` snapshot, so the ledger and past bills stay exactly as billed.
   */
  async deleteFeeItem(auth: AuthUser, id: string) {
    const existing = await this.db.feeItem.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!existing) throw new NotFoundException('Fee item not found');
    await this.db.feeItem.delete({ where: { id } });
    await this.db.audit(auth.schoolId, auth.sub, 'fees.item.delete', 'FeeItem', id, {
      name: existing.name,
    });
    return { deleted: true, id };
  }

  /** Bulk-generate term invoices for all active students (or one class). Skips students already invoiced. */
  async generateInvoices(auth: AuthUser, dto: GenerateInvoicesDto) {
    const allItems = await this.db.feeItem.findMany({
      where: { schoolId: auth.schoolId, termId: dto.termId },
    });
    const compulsory = allItems.filter((i) => !i.optional);
    if (compulsory.length === 0) {
      throw new BadRequestException('No fee items configured for this term');
    }
    const students = await this.db.student.findMany({
      where: {
        schoolId: auth.schoolId,
        status: 'ACTIVE',
        ...(dto.classId ? { classId: dto.classId } : {}),
      },
    });
    const existing = await this.db.invoice.findMany({
      where: { schoolId: auth.schoolId, termId: dto.termId },
      select: { studentId: true },
    });
    const invoiced = new Set(existing.map((e) => e.studentId));

    // Optional items (transport, feeding) only reach the students who take them, so each
    // invoice is the compulsory list plus that student's own subscriptions.
    const optionalById = new Map(allItems.filter((i) => i.optional).map((i) => [i.id, i]));
    const subs = await this.db.studentFeeItem.findMany({
      where: { schoolId: auth.schoolId, feeItem: { termId: dto.termId, optional: true } },
      select: { studentId: true, feeItemId: true },
    });
    const extrasFor = new Map<string, { name: string; amount: number }[]>();
    for (const s of subs) {
      const item = optionalById.get(s.feeItemId);
      if (!item) continue;
      const list = extrasFor.get(s.studentId) ?? [];
      list.push({ name: item.name, amount: Number(item.amount) });
      extrasFor.set(s.studentId, list);
    }

    const baseLines = compulsory.map((i) => ({ name: i.name, amount: Number(i.amount) }));
    const baseTotal = baseLines.reduce((a, l) => a + l.amount, 0);
    // Claim the whole block of invoice numbers up front. Deriving each from `count + created`
    // meant two runs for different classes started from the same base and collided on the
    // invoice's unique number, aborting one of them part-way through.
    const pending = students.filter((st) => !invoiced.has(st.id));
    const firstNumber =
      pending.length > 0
        ? await nextInSequence(this.db, auth.schoolId, 'INVOICE', pending.length)
        : 0;

    // Concessions are resolved once for the whole run, not per student: sibling rank depends on
    // the family, so it cannot be worked out from a student in isolation.
    const { rules, contextFor } = await this.concessionContext(auth.schoolId);

    let created = 0;
    for (const st of pending) {
      const lines = [...baseLines, ...(extrasFor.get(st.id) ?? [])];
      const total = lines.reduce((a, l) => a + l.amount, 0);
      const number = refNumber('INV', firstNumber + created);
      await this.db.invoice.create({
        data: {
          schoolId: auth.schoolId,
          studentId: st.id,
          termId: dto.termId,
          number,
          lines: lines as unknown as Prisma.InputJsonValue,
          total,
        },
      });
      await this.db.ledgerEntry.create({
        data: {
          schoolId: auth.schoolId,
          studentId: st.id,
          termId: dto.termId,
          type: 'INVOICE',
          amount: total,
          reference: `${number}-CHG`,
          note: `Invoice ${number}`,
          createdById: auth.sub,
        },
      });
      // A rule is a policy; the DISCOUNT it produces is the money. In the same request
      // transaction as the invoice, so a bill and its concession can never be half-recorded.
      for (const c of concessionsFor(rules, contextFor(st.id, st.classId), total).applied) {
        await this.db.ledgerEntry.create({
          data: {
            schoolId: auth.schoolId,
            studentId: st.id,
            termId: dto.termId,
            type: 'DISCOUNT' as const,
            amount: new Prisma.Decimal(c.amount),
            // Keyed to the invoice and the rule, so re-running a generation that partly failed
            // cannot apply the same concession twice.
            reference: `${number}-DSC-${c.ruleId.slice(-6)}`,
            note: c.name,
            createdById: auth.sub,
          },
        });
      }
      created++;
    }
    await this.db.audit(auth.schoolId, auth.sub, 'invoices.generate', 'Term', dto.termId, {
      created,
    });
    return { created, skipped: students.length - created, total: baseTotal };
  }

  /**
   * A student's optional extras for a term, with a flag for the ones they take. Invoices already
   * issued are unaffected — they carry their own `lines`, so changing a subscription only
   * changes what the *next* invoice bills.
   */
  async studentFeeItems(auth: AuthUser, studentId: string, termId: string) {
    const student = await this.db.student.findFirst({
      where: { id: studentId, schoolId: auth.schoolId },
    });
    if (!student) throw new NotFoundException('Student not found');
    const [items, subs, invoice] = await Promise.all([
      this.db.feeItem.findMany({
        where: { schoolId: auth.schoolId, termId, optional: true },
        orderBy: { name: 'asc' },
      }),
      this.db.studentFeeItem.findMany({ where: { studentId }, select: { feeItemId: true } }),
      this.db.invoice.findFirst({ where: { schoolId: auth.schoolId, studentId, termId } }),
    ]);
    const taken = new Set(subs.map((s) => s.feeItemId));
    return {
      alreadyInvoiced: !!invoice,
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        amount: Number(i.amount),
        subscribed: taken.has(i.id),
      })),
    };
  }

  async setStudentFeeItem(auth: AuthUser, studentId: string, dto: StudentFeeItemDto) {
    const [student, item] = await Promise.all([
      this.db.student.findFirst({ where: { id: studentId, schoolId: auth.schoolId } }),
      this.db.feeItem.findFirst({ where: { id: dto.feeItemId, schoolId: auth.schoolId } }),
    ]);
    if (!student) throw new NotFoundException('Student not found');
    if (!item) throw new NotFoundException('Fee item not found');
    if (!item.optional) {
      throw new BadRequestException('Compulsory items are billed to everyone already');
    }

    if (dto.subscribed) {
      await this.db.studentFeeItem.upsert({
        where: { studentId_feeItemId: { studentId, feeItemId: dto.feeItemId } },
        create: { studentId, feeItemId: dto.feeItemId, schoolId: auth.schoolId },
        update: {},
      });
    } else {
      await this.db.studentFeeItem.deleteMany({ where: { studentId, feeItemId: dto.feeItemId } });
    }
    await this.db.audit(auth.schoolId, auth.sub, 'fees.studentItem.set', 'Student', studentId, {
      feeItemId: dto.feeItemId,
      subscribed: dto.subscribed,
    });
    return { ok: true };
  }

  /**
   * The wording of every automatic message, editable in one place. The catalogue and rendering
   * live in common/templates.ts; these endpoints stay here because the reminder settings page
   * has always talked to /fees, and the other kinds now ride along.
   */
  async listTemplates(auth: AuthUser) {
    return listTemplates(this.db, auth.schoolId);
  }

  async saveTemplate(auth: AuthUser, kind: string, body: string) {
    if (!(kind in MESSAGE_TEMPLATES)) throw new BadRequestException('Unknown template');
    if (!body.trim()) throw new BadRequestException('The message cannot be empty');
    await this.db.messageTemplate.upsert({
      where: { schoolId_kind: { schoolId: auth.schoolId, kind } },
      create: { schoolId: auth.schoolId, kind, body },
      update: { body },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'fees.template.save', 'School', auth.schoolId, {
      kind,
    });
    return { ok: true };
  }

  /** The school's reminder schedule — read and written by the settings page, run by the worker. */
  async reminderSchedule(auth: AuthUser) {
    const job = await this.db.scheduledJob.findUnique({
      where: { schoolId_kind: { schoolId: auth.schoolId, kind: 'FEE_REMINDERS' } },
    });
    return job ?? { kind: 'FEE_REMINDERS', enabled: false, dayOfWeek: 1, hour: 9, lastRunAt: null };
  }

  async setReminderSchedule(auth: AuthUser, dto: ReminderScheduleDto) {
    const data = { enabled: dto.enabled, dayOfWeek: dto.dayOfWeek ?? null, hour: dto.hour ?? 9 };
    await this.db.scheduledJob.upsert({
      where: { schoolId_kind: { schoolId: auth.schoolId, kind: 'FEE_REMINDERS' } },
      create: { schoolId: auth.schoolId, kind: 'FEE_REMINDERS', ...data },
      update: data,
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'fees.reminders.schedule',
      'School',
      auth.schoolId,
      data,
    );
    return this.reminderSchedule(auth);
  }

  /**
   * Remind families who owe money. Escalates on size of debt rather than on a count of previous
   * nudges: a family owing a few cedis and one owing a term's fees should not hear the same
   * thing. One message per student per term per day, so a re-run never double-sends.
   */
  async sendReminders(auth: AuthUser, termId: string, dryRun = false) {
    const [defaulters, school, term] = await Promise.all([
      this.defaulters(auth, termId),
      this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } }),
      this.db.term.findUnique({ where: { id: termId } }),
    ]);
    const nextTermBegins = term?.nextTermBegins;
    const money = (n: number) =>
      `${school.currency} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2 })}`;

    const kindOf = (heavy: boolean) => (heavy ? 'FEE_REMINDER_FIRM' : 'FEE_REMINDER_GENTLE');
    const stamp = new Date().toISOString().slice(0, 10);
    let sent = 0;
    let skipped = 0;
    const planned: { name: string; balance: number; tone: string }[] = [];

    for (const d of defaulters) {
      if (!d.phone) {
        skipped++;
        continue;
      }
      // Escalation: a gentle note under a third of a term's bill, firmer above it.
      const heavy = d.balance >= 500;
      const tone = heavy ? 'firm' : 'gentle';
      planned.push({ name: d.name, balance: d.balance, tone });
      if (dryRun) continue;

      const batchId = `FEEREM-${termId}-${stamp}-${d.studentId}`;
      if (await this.sms.alreadySent(auth.schoolId, batchId)) {
        skipped++;
        continue;
      }
      const body = await renderMessage(this.db, auth.schoolId, kindOf(heavy), {
        school: school.name,
        student: d.name,
        amount: money(d.balance),
        nextTerm: nextTermBegins
          ? '; next term begins ' +
            new Date(nextTermBegins).toLocaleDateString('en-GH', { day: 'numeric', month: 'long' })
          : '',
      });
      const res = await this.sms.sendToPhones({
        schoolId: auth.schoolId,
        createdById: auth.sub,
        phones: [d.phone],
        body,
        batchId,
      });
      sent += res.sent;
      skipped += res.skipped;
    }
    if (!dryRun) {
      await this.db.audit(auth.schoolId, auth.sub, 'fees.reminders', 'Term', termId, {
        candidates: defaulters.length,
        sent,
        skipped,
      });
    }
    return { candidates: defaulters.length, sent, skipped, dryRun, planned: planned.slice(0, 50) };
  }

  /**
   * Who owes money as of this term, counting arrears carried in from earlier terms.
   *
   * Always the whole set. Everything that reports a figure — the overview's outstanding total,
   * the reminder run, the export — needs every family, so this stays uncapped and unpaged and
   * `listDefaulters` slices it for a screen. Paging here would have made the school's
   * outstanding-fees figure a function of which page happened to be open.
   */
  async defaulters(auth: AuthUser, termId: string): Promise<DefaulterRow[]> {
    const entries = await this.db.ledgerEntry.findMany({
      where: await this.asOfTerm(auth, termId),
      include: {
        student: {
          select: {
            firstName: true,
            lastName: true,
            admissionNo: true,
            classId: true,
            classRoom: { select: { name: true } },
            guardians: {
              /**
               * BLOCKED is excluded, as it is in every other automatic sender (attendance,
               * assessment, pickup). This one was missed.
               *
               * The flag means a named adult must not collect this child — usually a custody
               * order. Texting them the child's name and the family's balance tells them the
               * child is still enrolled here, which is frequently the single fact the flag exists
               * to withhold.
               */
              where: { isPrimary: true, custodyFlag: { not: 'BLOCKED' } },
              include: { guardian: { select: { phone: true } } },
            },
          },
        },
      },
    });
    const byStudent = new Map<string, Omit<DefaulterRow, 'studentId'>>();
    // Group first, then sum: a reversal cancels an entry belonging to the same child, so the
    // balance has to be derived per student rather than accumulated entry by entry.
    const rowsFor = new Map<string, typeof entries>();
    for (const e of entries) {
      const cur = byStudent.get(e.studentId) ?? {
        name: `${e.student.firstName} ${e.student.lastName}`,
        admissionNo: e.student.admissionNo,
        className: e.student.classRoom?.name ?? '—',
        classId: e.student.classId,
        phone: e.student.guardians[0]?.guardian.phone ?? null,
        balance: 0,
      };
      byStudent.set(e.studentId, cur);
      rowsFor.set(e.studentId, [...(rowsFor.get(e.studentId) ?? []), e]);
    }
    for (const [studentId, v] of byStudent) v.balance = balanceOf(rowsFor.get(studentId) ?? []);

    return [...byStudent.entries()]
      .filter(([, v]) => v.balance > 0.005)
      .map(([studentId, v]) => ({ studentId, ...v }))
      .sort((a, b) => b.balance - a.balance);
  }

  /**
   * The defaulter list as a screen sees it: filtered, sorted, and one page at a time.
   *
   * The web page used to render `defaulters.slice(0, 12)` against an uncapped array, so a school
   * with ninety families in arrears saw twelve of them and was told nothing about the rest — the
   * same silent truncation the register had, and worse here, because the twelve on screen sat
   * directly beneath an "Outstanding" tile counting all ninety.
   *
   * `total` counts everyone matching the filters, never the slice. The money on the page still
   * comes from `overview()`, which sums the whole set and does not page — turning a page must not
   * be able to change what a school believes it is owed.
   */
  /**
   * Let one child's family read a held report despite the balance.
   *
   * The reason is required for the same reason a scholarship's is: an override without a stated
   * reason is a favour, and the next bursar cannot tell a payment plan from a friendship.
   */
  async grantClearance(auth: AuthUser, dto: FeeClearanceDto) {
    const [student, term] = await Promise.all([
      this.db.student.findFirst({ where: { id: dto.studentId, schoolId: auth.schoolId } }),
      this.db.term.findFirst({
        where: { id: dto.termId, academicYear: { schoolId: auth.schoolId } },
      }),
    ]);
    if (!student) throw new NotFoundException('Student not found');
    if (!term) throw new NotFoundException('Term not found');

    const row = await this.db.feeClearance.upsert({
      where: { studentId_termId: { studentId: dto.studentId, termId: dto.termId } },
      create: {
        schoolId: auth.schoolId,
        studentId: dto.studentId,
        termId: dto.termId,
        reason: dto.reason.trim(),
        grantedById: auth.sub,
      },
      update: { reason: dto.reason.trim(), grantedById: auth.sub },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'fees.clearance.grant', 'Student', dto.studentId, {
      termId: dto.termId,
      reason: dto.reason.trim(),
    });
    return { id: row.id, granted: true };
  }

  /** Take a clearance back. Audited, because it re-closes a door that was opened deliberately. */
  async revokeClearance(auth: AuthUser, studentId: string, termId: string) {
    const existing = await this.db.feeClearance.findUnique({
      where: { studentId_termId: { studentId, termId } },
    });
    if (!existing || existing.schoolId !== auth.schoolId) {
      throw new NotFoundException('No clearance on file');
    }
    await this.db.feeClearance.delete({ where: { id: existing.id } });
    await this.db.audit(auth.schoolId, auth.sub, 'fees.clearance.revoke', 'Student', studentId, {
      termId,
    });
    return { revoked: true };
  }

  /** Who has been let through for a term, and why. */
  async listClearances(auth: AuthUser, termId: string) {
    const rows = await this.db.feeClearance.findMany({
      where: { schoolId: auth.schoolId, termId },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      studentId: r.studentId,
      studentName: `${r.student.firstName} ${r.student.lastName}`,
      admissionNo: r.student.admissionNo,
      reason: r.reason,
      createdAt: r.createdAt,
    }));
  }

  async listDefaulters(auth: AuthUser, q: ListDefaultersDto) {
    const all = await this.defaulters(auth, q.termId);
    const needle = q.q?.trim().toLowerCase();
    const matching = all.filter(
      (d) =>
        (!q.classId || d.classId === q.classId) &&
        (!needle ||
          d.name.toLowerCase().includes(needle) ||
          d.admissionNo.toLowerCase().includes(needle)),
    );

    // `defaulters()` already returns biggest debt first, which is the order a bursar works in, so
    // an absent or unrecognised sort leaves that alone rather than re-sorting to something else.
    const read = q.sort ? DEFAULTER_SORTS[q.sort] : undefined;
    const rows = read ? [...matching] : matching;
    if (read) {
      const dir = q.order === 'desc' ? -1 : 1;
      rows.sort((a, b) => {
        const x = read(a);
        const y = read(b);
        return x < y ? -dir : x > y ? dir : 0;
      });
    }

    const { skip, take, page, perPage } = pageArgs(q);
    return toPage(rows.slice(skip, skip + take), matching.length, { page, perPage });
  }

  /**
   * The full statement of account for one child, as a branded PDF — every charge, payment and
   * correction with a running balance. The row arithmetic lives in common/statement.ts and is
   * proved to land on `balanceOf` exactly.
   */
  async statementPdf(auth: AuthUser, studentId: string) {
    const student = await this.db.student.findFirst({
      where: { id: studentId, schoolId: auth.schoolId },
      include: { classRoom: { select: { name: true } } },
    });
    if (!student) throw new NotFoundException('Student not found');
    const [entries, school] = await Promise.all([
      this.db.ledgerEntry.findMany({
        where: { studentId, schoolId: auth.schoolId },
        include: { receipt: { select: { number: true } } },
      }),
      this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } }),
    ]);
    const { lines, totals } = statementLines(
      entries.map((e) => ({
        id: e.id,
        type: e.type,
        amount: e.amount,
        reversedId: e.reversedId,
        method: e.method,
        reference: e.reference,
        receiptNumber: e.receipt?.number ?? null,
        createdAt: e.createdAt,
      })),
    );
    await this.db.audit(auth.schoolId, auth.sub, 'fees.statement', 'Student', studentId);
    return {
      buffer: await statementPdf({
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
        student: {
          name: `${student.firstName} ${student.lastName}`,
          admissionNo: student.admissionNo,
          className: student.classRoom?.name ?? null,
        },
        currency: school.currency,
        rows: lines,
        totals,
        generatedAt: new Date(),
      }),
      filename: `statement-${student.admissionNo}.pdf`,
    };
  }

  /**
   * Every ledger entry in a window, for the accountant. The whole ledger, not a page of it —
   * a total summed from fetched rows is a function of the open page (see project memory), and
   * an export is precisely the place that must never be.
   */
  async ledgerExport(auth: AuthUser, format: string, from?: string, to?: string) {
    const createdAt = dateWindow({ from, to } as PageQuery);
    const entries = await this.db.ledgerEntry.findMany({
      where: { schoolId: auth.schoolId, ...(createdAt ? { createdAt } : {}) },
      include: {
        student: { select: { firstName: true, lastName: true, admissionNo: true } },
        receipt: { select: { number: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const headers = [
      'Date',
      'Reference',
      'Receipt No.',
      'Student',
      'Admission No.',
      'Type',
      'Method',
      'Amount',
      'Reversed Entry',
      'Note',
    ];
    const rows: Cell[][] = entries.map((e) => [
      e.createdAt.toISOString().slice(0, 10),
      e.reference,
      e.receipt?.number ?? '',
      `${e.student.firstName} ${e.student.lastName}`,
      e.student.admissionNo,
      e.type,
      e.method ?? '',
      Number(e.amount),
      e.reversedId ?? '',
      e.note ?? '',
    ]);
    if (format === 'csv') {
      return { buffer: toCsv(headers, rows), type: 'text/csv', filename: 'ledger.csv' };
    }
    return {
      buffer: await toXlsx('Ledger', headers, rows),
      type: XLSX_MIME,
      filename: 'ledger.xlsx',
    };
  }

  /**
   * The double-entry journal for the accountant (FEATURES.md §7): the append-only ledger
   * projected into balanced debit/credit pairs over a small chart of accounts. A projection,
   * never a second ledger — see common/journal.ts.
   */
  async journalExport(auth: AuthUser, format: string, from?: string, to?: string) {
    const createdAt = dateWindow({ from, to } as PageQuery);
    const entries = await this.db.ledgerEntry.findMany({
      where: { schoolId: auth.schoolId, ...(createdAt ? { createdAt } : {}) },
      include: { student: { select: { firstName: true, lastName: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const lines = journalLines(
      entries.map((e) => ({
        id: e.id,
        type: e.type,
        amount: e.amount,
        method: e.method,
        reference: e.reference,
        reversedId: e.reversedId,
        createdAt: e.createdAt,
        studentName: `${e.student.firstName} ${e.student.lastName}`,
      })),
    );
    const totals = journalTotals(lines);
    const headers = ['Date', 'Reference', 'Description', 'Account', 'Debit', 'Credit'];
    const rows: Cell[][] = [
      ...lines.map((l) => [
        l.date.toISOString().slice(0, 10),
        l.reference,
        l.description,
        l.account,
        l.debit ?? '',
        l.credit ?? '',
      ]),
      ['', '', 'TOTALS', '', totals.debits, totals.credits],
    ];
    if (format === 'csv') {
      return { buffer: toCsv(headers, rows), type: 'text/csv', filename: 'journal.csv' };
    }
    if (format === 'pdf') {
      // Paper, for the meeting. CSV is right for an accountant and no answer at all for a board.
      const school = await this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } });
      return {
        buffer: await tableReportPdf({
          school: {
            name: school.name,
            motto: school.motto,
            address: school.address,
            phone: school.phone,
            brandColor: school.brandColor,
          },
          title: 'Double-entry journal',
          subtitle: from || to ? `${from ?? 'the beginning'} to ${to ?? 'today'}` : null,
          headers,
          rows: rows as Array<Array<string | number>>,
          numericColumns: [4, 5],
        }),
        type: 'application/pdf',
        filename: 'journal.pdf',
      };
    }
    return {
      buffer: await toXlsx('Journal', headers, rows),
      type: XLSX_MIME,
      filename: 'journal.xlsx',
    };
  }

  async defaultersExport(auth: AuthUser, termId: string, format: string) {
    const defaulters = await this.defaulters(auth, termId);
    const headers = ['Admission No.', 'Name', 'Class', 'Guardian Phone', 'Balance'];
    const rows: Cell[][] = defaulters.map((d) => [
      d.admissionNo,
      d.name,
      d.className,
      d.phone ?? '',
      d.balance,
    ]);
    if (format === 'csv') {
      return { buffer: toCsv(headers, rows), type: 'text/csv', filename: 'defaulters.csv' };
    }
    if (format === 'pdf') {
      const school = await this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } });
      return {
        buffer: await tableReportPdf({
          school: {
            name: school.name,
            motto: school.motto,
            address: school.address,
            phone: school.phone,
            brandColor: school.brandColor,
          },
          title: 'Outstanding fees',
          subtitle: null,
          headers,
          rows: rows as Array<Array<string | number>>,
          numericColumns: [4],
        }),
        type: 'application/pdf',
        filename: 'defaulters.pdf',
      };
    }
    return {
      buffer: await toXlsx('Defaulters', headers, rows),
      type: XLSX_MIME,
      filename: 'defaulters.xlsx',
    };
  }

  /**
   * Cancel a ledger entry by appending its reversal.
   *
   * This is the correction procedure the schema and CLAUDE.md both describe, and until now it
   * existed only as prose: nothing in the codebase created a REVERSAL, and the readers that
   * consumed one ignored it. So an invoice raised twice, or a payment recorded against the wrong
   * child, could not be undone at all — the ledger is append-only, so there was no edit to fall
   * back on either. A bursar's only recourse was a compensating fake payment, which is exactly the
   * lie the append-only design exists to prevent.
   *
   * Both halves stay in the history. The parent can see the charge and see it cancelled, which is
   * the point of correcting rather than deleting.
   */
  async reverseEntry(auth: AuthUser, entryId: string, dto: ReverseDto) {
    const entry = await this.db.ledgerEntry.findFirst({
      where: { id: entryId, schoolId: auth.schoolId },
    });
    if (!entry) throw new NotFoundException('Ledger entry not found');
    if (entry.type === 'REVERSAL') {
      throw new BadRequestException('A reversal cannot itself be reversed');
    }

    const already = await this.db.ledgerEntry.findFirst({
      where: { schoolId: auth.schoolId, type: 'REVERSAL', reversedId: entryId },
    });
    if (already) {
      // Reversing twice would look like it cancelled twice. It does not — balanceOf ignores the
      // repeat — but saying so plainly beats a silent no-op.
      throw new BadRequestException('That entry has already been reversed');
    }

    const seq = await nextInSequence(this.db, auth.schoolId, 'PAYMENT');
    const reversal = await this.db.ledgerEntry.create({
      data: {
        schoolId: auth.schoolId,
        studentId: entry.studentId,
        // The reversal belongs to the same term as what it cancels, or the term's collection
        // figures would never come back into line.
        termId: entry.termId,
        type: 'REVERSAL',
        amount: entry.amount,
        reference: refNumber('REV', seq),
        reversedId: entry.id,
        note: dto.reason,
        createdById: auth.sub,
      },
    });

    await this.db.audit(auth.schoolId, auth.sub, 'fees.reverse', 'LedgerEntry', entry.id, {
      reversalId: reversal.id,
      reversedType: entry.type,
      amount: Number(entry.amount),
      reason: dto.reason,
    });
    return {
      reversed: true,
      reversalId: reversal.id,
      reference: reversal.reference,
      balance: await this.balanceFor(auth.schoolId, entry.studentId),
    };
  }

  /** The student's balance after the ledger changed — so the caller need not re-fetch. */
  private async balanceFor(schoolId: string, studentId: string) {
    return balanceOf(await this.db.ledgerEntry.findMany({ where: { schoolId, studentId } }));
  }

  /**
   * Grant a discount, waiver or scholarship. It is a ledger entry like any other — append-only,
   * carrying its reason — so the reduction shows in the student's history rather than silently
   * shrinking an invoice. Correcting one means a REVERSAL, never an edit.
   */
  async grantConcession(auth: AuthUser, dto: ConcessionDto) {
    const student = await this.db.student.findFirst({
      where: { id: dto.studentId, schoolId: auth.schoolId },
    });
    if (!student) throw new NotFoundException('Student not found');

    const term = dto.termId
      ? await this.db.term.findFirst({
          where: { id: dto.termId, academicYear: { schoolId: auth.schoolId } },
        })
      : await this.db.term.findFirst({
          where: { isCurrent: true, academicYear: { schoolId: auth.schoolId, isCurrent: true } },
        });
    if (dto.termId && !term) throw new NotFoundException('Term not found');

    /**
     * A concession can never exceed the bill it discounts.
     *
     * common/concessions.ts states this invariant and enforces it for rule-driven discounts; the
     * manual path validated only that the amount was positive. A bursar typing 13,900 instead of
     * 1,390 drove the balance to −12,510, and because every arrears view filters on `balance > 0`
     * the child then vanished from the defaulters list, the reminders and the guardian portal —
     * a data-entry slip that hides itself.
     */
    const owed = await this.balanceFor(auth.schoolId, dto.studentId);
    if (dto.amount > owed + 0.005) {
      throw new BadRequestException(
        owed <= 0.005
          ? 'This student does not owe anything, so there is nothing to discount'
          : `That is more than the student owes (${owed.toFixed(2)}). A concession cannot leave the school owing the family money.`,
      );
    }

    const seq = await nextInSequence(this.db, auth.schoolId, 'PAYMENT');
    const entry = await this.db.ledgerEntry.create({
      data: {
        schoolId: auth.schoolId,
        studentId: dto.studentId,
        termId: term?.id,
        type: dto.type,
        amount: dto.amount,
        reference: refNumber(dto.type === 'WAIVER' ? 'WVR' : 'DSC', seq),
        note: dto.reason,
        createdById: auth.sub,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'fees.concession', 'Student', dto.studentId, {
      type: dto.type,
      amount: dto.amount,
      reason: dto.reason,
      reference: entry.reference,
    });
    return { reference: entry.reference, type: entry.type, amount: Number(entry.amount) };
  }

  /** Record a manual payment (cash/bank/momo recorded at office). Append-only + receipt. */
  /**
   * Tell the school's own systems, when it has asked to be told.
   *
   * Never allowed to fail the thing that triggered it: a school's accounting endpoint being down
   * must not roll back a payment that was taken at the counter.
   */
  private notifyIntegrations(schoolId: string, event: string, payload: Record<string, unknown>) {
    void this.integrations.dispatch(schoolId, event, payload).catch(() => undefined);
  }

  async recordPayment(auth: AuthUser, dto: RecordPaymentDto) {
    const student = await this.db.student.findFirst({
      where: { id: dto.studentId, schoolId: auth.schoolId },
    });
    if (!student) throw new NotFoundException('Student not found');
    // A payment normally settles the current term, but a bursar clearing last term's arrears can
    // say so — the entry then nets against that term rather than inflating this one's collection.
    const term = dto.termId
      ? await this.db.term.findFirst({
          where: { id: dto.termId, academicYear: { schoolId: auth.schoolId } },
        })
      : await this.db.term.findFirst({
          where: { isCurrent: true, academicYear: { schoolId: auth.schoolId, isCurrent: true } },
        });
    if (dto.termId && !term) throw new NotFoundException('Term not found');
    const paySeq = await nextInSequence(this.db, auth.schoolId, 'PAYMENT');
    const rcpSeq = await nextInSequence(this.db, auth.schoolId, 'RECEIPT');
    const entry = await this.db.ledgerEntry.create({
      data: {
        schoolId: auth.schoolId,
        studentId: dto.studentId,
        termId: term?.id,
        type: 'PAYMENT',
        amount: dto.amount,
        method: dto.method,
        reference: refNumber('PAY', paySeq),
        note: dto.note,
        createdById: auth.sub,
      },
    });
    const receipt = await this.db.receipt.create({
      data: {
        schoolId: auth.schoolId,
        ledgerEntryId: entry.id,
        number: refNumber('RCP', rcpSeq),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'payment.record', 'Student', dto.studentId, {
      amount: dto.amount,
      method: dto.method,
      reference: entry.reference,
    });
    this.notifyIntegrations(auth.schoolId, 'payment.recorded', {
      studentId: dto.studentId,
      admissionNo: student.admissionNo,
      amount: dto.amount,
      method: dto.method,
      reference: entry.reference,
      receiptNumber: receipt.number,
    });
    return {
      reference: entry.reference,
      receiptNumber: receipt.number,
      amount: dto.amount,
      student: `${student.firstName} ${student.lastName}`,
    };
  }

  // ── Bank deposits: submit → bursar confirms → ledger ───────────────

  /**
   * Record a claimed bank deposit with its proof. Nothing touches the ledger here — an
   * unverified claim is not money. A bursar must confirm it first.
   */
  async submitDeposit(auth: AuthUser, dto: BankDepositDto, file?: UploadedFileLike) {
    const student = await this.db.student.findFirst({
      where: { id: dto.studentId, schoolId: auth.schoolId },
    });
    if (!student) throw new NotFoundException('Student not found');

    let proofKey: string | null = null;
    if (file?.buffer) {
      if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('Proof file is too large');
      if (!DOCUMENT_TYPES.includes(file.mimetype)) {
        throw new BadRequestException(`Unsupported proof type ${file.mimetype}`);
      }
      proofKey = objectKey(auth.schoolId, 'deposits', dto.studentId, file.originalname);
      await storage().put(proofKey, file.buffer, file.mimetype);
    }

    const term = await this.db.term.findFirst({
      where: { isCurrent: true, academicYear: { schoolId: auth.schoolId, isCurrent: true } },
    });
    // Atomic, like every other document number. count()+1 is not a counter: two parents lodging
    // slips at the same moment get the same reference, the unique index rejects one, and because
    // the request is a single transaction the proof file already written to storage orphans too.
    const seq = await nextInSequence(this.db, auth.schoolId, 'DEPOSIT');
    const deposit = await this.db.bankDeposit.create({
      data: {
        schoolId: auth.schoolId,
        studentId: dto.studentId,
        termId: term?.id ?? null,
        amount: new Prisma.Decimal(dto.amount),
        bankName: dto.bankName ?? null,
        bankRef: dto.bankRef ?? null,
        depositedAt: new Date(dto.depositedAt),
        proofKey,
        note: dto.note ?? null,
        reference: `DEP-${refYear()}-${String(seq).padStart(5, '0')}`,
        submittedById: auth.sub,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'deposit.submit', 'BankDeposit', deposit.id, {
      amount: dto.amount,
      reference: deposit.reference,
    });
    return { id: deposit.id, reference: deposit.reference, status: deposit.status };
  }

  /**
   * The bank-deposit queue, paged.
   *
   * The cap here was `take: 100` with no total, which is the worst shape a review queue can have:
   * a bursar working through claims oldest-first could not tell an empty queue from one whose
   * hundred-and-first item was invisible, and nothing on the screen admitted a limit existed.
   */
  async listDeposits(auth: AuthUser, q: ListDepositsDto) {
    const { skip, take, page, perPage } = pageArgs(q);
    // The window filters `depositedAt` — the day the money left the payer's hands, which is what
    // a bank statement shows — not `createdAt`, the day somebody got round to keying the slip in.
    const deposited = dateWindow(q);
    const where = {
      schoolId: auth.schoolId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(deposited ? { depositedAt: deposited } : {}),
    };

    const [total, deposits] = await Promise.all([
      this.db.bankDeposit.count({ where }),
      this.db.bankDeposit.findMany({
        where,
        orderBy: orderBy<Prisma.BankDepositOrderByWithRelationInput>(q, DEPOSIT_SORTS, {
          createdAt: 'desc',
        }),
        skip,
        take,
        include: {
          student: { select: { firstName: true, lastName: true, admissionNo: true } },
        },
      }),
    ]);

    const rows = deposits.map((d) => ({
      id: d.id,
      reference: d.reference,
      student: `${d.student.firstName} ${d.student.lastName}`,
      admissionNo: d.student.admissionNo,
      amount: Number(d.amount),
      bankName: d.bankName,
      bankRef: d.bankRef,
      depositedAt: d.depositedAt,
      hasProof: !!d.proofKey,
      status: d.status,
      note: d.note,
      reviewNote: d.reviewNote,
      createdAt: d.createdAt,
    }));
    return toPage(rows, total, { page, perPage });
  }

  async readDepositProof(auth: AuthUser, id: string) {
    const deposit = await this.db.bankDeposit.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!deposit?.proofKey) throw new NotFoundException('No proof on file');
    return storage().get(deposit.proofKey);
  }

  /**
   * The one rule the permission grid cannot carry, and the reason `fees.deposit_submit` and
   * `fees.deposits` are separate codes at all: whoever banked the money is never the person who
   * says it arrived. Recording a deposit and confirming it are the two halves of the same
   * fraud, so holding both permissions still does not let you close the loop on your own
   * submission. Rejection is guarded too — quietly rejecting your own entry hides a payment
   * just as well as confirming a fictitious one does.
   */
  private assertNotOwnDeposit(auth: AuthUser, deposit: { submittedById: string | null }) {
    if (deposit.submittedById && deposit.submittedById === auth.sub) {
      throw new ForbiddenException('Someone else must review a deposit you recorded');
    }
  }

  /**
   * Confirm a deposit: this is the moment it becomes money. Appends the PAYMENT entry and
   * mints a receipt, keyed on the deposit's unique reference — LedgerEntry.reference is
   * unique, so a double confirmation credits the student exactly once.
   */
  async confirmDeposit(auth: AuthUser, id: string) {
    const deposit = await this.db.bankDeposit.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!deposit) throw new NotFoundException('Deposit not found');
    this.assertNotOwnDeposit(auth, deposit);
    if (deposit.status === 'REJECTED') {
      throw new BadRequestException('This deposit was rejected');
    }

    const existing = await this.db.ledgerEntry.findUnique({
      where: { schoolId_reference: { schoolId: auth.schoolId, reference: deposit.reference } },
    });
    if (existing) {
      if (deposit.status !== 'CONFIRMED') {
        await this.db.bankDeposit.update({
          where: { id },
          data: { status: 'CONFIRMED', reviewedById: auth.sub, reviewedAt: new Date() },
        });
      }
      return { confirmed: true, alreadyApplied: true, reference: deposit.reference };
    }

    const rcpSeq = await nextInSequence(this.db, auth.schoolId, 'RECEIPT');
    try {
      const entry = await this.db.ledgerEntry.create({
        data: {
          schoolId: auth.schoolId,
          studentId: deposit.studentId,
          termId: deposit.termId,
          type: 'PAYMENT',
          amount: deposit.amount,
          method: 'BANK',
          reference: deposit.reference,
          note: `Bank deposit${deposit.bankName ? ` — ${deposit.bankName}` : ''}${deposit.bankRef ? ` (${deposit.bankRef})` : ''}`,
          createdById: auth.sub,
        },
      });
      await this.db.receipt.create({
        data: {
          schoolId: auth.schoolId,
          ledgerEntryId: entry.id,
          number: refNumber('RCP', rcpSeq),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { confirmed: true, alreadyApplied: true, reference: deposit.reference };
      }
      throw e;
    }

    await this.db.bankDeposit.update({
      where: { id },
      data: { status: 'CONFIRMED', reviewedById: auth.sub, reviewedAt: new Date() },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'deposit.confirm', 'BankDeposit', id, {
      reference: deposit.reference,
      amount: Number(deposit.amount),
    });
    return { confirmed: true, alreadyApplied: false, reference: deposit.reference };
  }

  async rejectDeposit(auth: AuthUser, id: string, reason?: string) {
    const deposit = await this.db.bankDeposit.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!deposit) throw new NotFoundException('Deposit not found');
    this.assertNotOwnDeposit(auth, deposit);
    if (deposit.status === 'CONFIRMED') {
      throw new BadRequestException(
        'This deposit is already in the ledger — post a reversal instead of rejecting it',
      );
    }
    await this.db.bankDeposit.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewNote: reason ?? null,
        reviewedById: auth.sub,
        reviewedAt: new Date(),
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'deposit.reject', 'BankDeposit', id, {
      reason: reason ?? null,
    });
    return { rejected: true };
  }

  /** Branded PDF receipt for a recorded payment, with the running balance as of that payment. */
  /**
   * Build a receipt PDF. Takes a schoolId rather than an AuthUser so the guardian portal can
   * serve a parent their own receipt, passing `restrictToStudentId` to prove the payment
   * belongs to a ward they are allowed to see.
   */
  async receiptPdf(schoolId: string, reference: string, restrictToStudentId?: string) {
    const entry = await this.db.ledgerEntry.findFirst({
      where: {
        schoolId,
        reference,
        type: 'PAYMENT',
        ...(restrictToStudentId ? { studentId: restrictToStudentId } : {}),
      },
      include: {
        receipt: true,
        student: { include: { classRoom: { select: { name: true } } } },
      },
    });
    if (!entry || !entry.receipt) throw new NotFoundException('Receipt not found');
    const school = await this.db.school.findUniqueOrThrow({ where: { id: schoolId } });

    // Running balance up to and including this payment.
    const priorEntries = await this.db.ledgerEntry.findMany({
      where: {
        schoolId,
        studentId: entry.studentId,
        createdAt: { lte: entry.createdAt },
      },
    });
    const balanceAfter = balanceOf(priorEntries);

    // A missing/unreadable photo must never block issuing a receipt.
    const studentPhoto = entry.student.photoUrl
      ? await storage()
          .get(entry.student.photoUrl)
          .catch(() => null)
      : null;

    return receiptPdf({
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
      studentPhoto,
      receiptNumber: entry.receipt.number,
      reference: entry.reference,
      issuedAt: entry.receipt.issuedAt,
      student: {
        name: `${entry.student.firstName} ${entry.student.lastName}`,
        admissionNo: entry.student.admissionNo,
        className: entry.student.classRoom?.name ?? null,
      },
      amount: Number(entry.amount),
      method: entry.method,
      currency: school.currency,
      note: entry.note,
      balanceAfter: Math.round(balanceAfter * 100) / 100,
    });
  }

  // ── Installments ───────────────────────────────────────────────────

  /**
   * Agree a payment plan for a bill.
   *
   * An installment is a promise about *when*, never a second record of the money. Nothing here
   * writes to the ledger, and no balance is ever derived by summing installments — the ledger
   * remains the only source of what is owed. Getting that wrong double-counts a term.
   */
  async setInstallmentPlan(auth: AuthUser, dto: InstallmentPlanDto) {
    const student = await this.db.student.findFirst({
      where: { id: dto.studentId, schoolId: auth.schoolId },
    });
    if (!student) throw new NotFoundException('Student not found');
    if (dto.parts.length === 0) throw new BadRequestException('Add at least one instalment');
    if (dto.parts.some((p) => !(p.amount > 0))) {
      throw new BadRequestException('Every instalment must be more than zero');
    }

    const total = dto.parts.reduce((a, p) => a + p.amount, 0);
    // A plan has to add up to the bill it splits, or it is not a plan for that bill.
    if (dto.invoiceId) {
      const invoice = await this.db.invoice.findFirst({
        where: { id: dto.invoiceId, schoolId: auth.schoolId, studentId: dto.studentId },
      });
      if (!invoice) throw new NotFoundException('Invoice not found for this student');
      if (Math.abs(Math.round((total - Number(invoice.total)) * 100)) > 1) {
        throw new BadRequestException(
          `The instalments add up to ${total.toFixed(2)} but the bill is ${Number(invoice.total).toFixed(2)}`,
        );
      }
    }

    const term = await this.db.term.findFirst({
      where: { isCurrent: true, academicYear: { schoolId: auth.schoolId, isCurrent: true } },
    });

    // Replace rather than append: a student has one live plan per invoice, and leaving the old
    // rows behind would silently double the schedule.
    await this.db.installment.deleteMany({
      where: {
        schoolId: auth.schoolId,
        studentId: dto.studentId,
        ...(dto.invoiceId ? { invoiceId: dto.invoiceId } : { invoiceId: null }),
      },
    });
    await this.db.installment.createMany({
      data: dto.parts.map((part, i) => ({
        schoolId: auth.schoolId,
        studentId: dto.studentId,
        invoiceId: dto.invoiceId ?? null,
        termId: term?.id ?? null,
        sequence: i + 1,
        amount: new Prisma.Decimal(part.amount),
        dueDate: new Date(part.dueDate),
        note: part.note ?? null,
      })),
    });

    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'fees.installment-plan',
      'Student',
      dto.studentId,
      {
        parts: dto.parts.length,
        total,
      },
    );
    return this.installments(auth, dto.studentId);
  }

  /**
   * A student's schedule, each instalment marked against what has actually been paid.
   *
   * Credit is applied oldest-first. That is a presentation choice, not a second ledger: the
   * money is untouched, we are only saying which promise it covers.
   */
  async installments(auth: AuthUser, studentId: string) {
    const rows = await this.db.installment.findMany({
      where: { schoolId: auth.schoolId, studentId },
      orderBy: [{ dueDate: 'asc' }, { sequence: 'asc' }],
    });
    if (rows.length === 0) return { parts: [], paidTotal: 0, scheduledTotal: 0, overdue: 0 };

    // Progress is measured against what is still owed, not against every payment ever made.
    // See common/installments.ts — the first version counted historic payments and marked a
    // freshly agreed plan fully settled.
    const entries = await this.db.ledgerEntry.findMany({
      where: { schoolId: auth.schoolId, studentId },
    });
    const owed = balanceOf(entries);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const marked = markSchedule(
      rows.map((r) => ({
        id: r.id,
        sequence: r.sequence,
        amount: Number(r.amount),
        dueDate: r.dueDate,
        note: r.note,
      })),
      Math.round(owed * 100) / 100,
      today,
    );

    return { parts: marked, ...scheduleTotals(marked) };
  }

  // ── Fee structure rollover ─────────────────────────────────────────

  /**
   * Copy a term's fee items into the next term.
   *
   * Without this a school retypes its whole fee structure three times a year, and invoice
   * generation simply refuses until they do. Items already in the target term are left alone and
   * reported as skipped — re-running must never duplicate a fee.
   */
  async rolloverFeeItems(auth: AuthUser, dto: RolloverDto) {
    const [from, to] = await Promise.all([
      this.db.term.findFirst({
        where: { id: dto.fromTermId, academicYear: { schoolId: auth.schoolId } },
      }),
      this.db.term.findFirst({
        where: { id: dto.toTermId, academicYear: { schoolId: auth.schoolId } },
      }),
    ]);
    if (!from || !to) throw new NotFoundException('Term not found');
    if (from.id === to.id) throw new BadRequestException('Choose two different terms');

    const [source, existing] = await Promise.all([
      this.db.feeItem.findMany({ where: { schoolId: auth.schoolId, termId: from.id } }),
      this.db.feeItem.findMany({ where: { schoolId: auth.schoolId, termId: to.id } }),
    ]);
    if (source.length === 0) throw new BadRequestException(`${from.name} has no fee items to copy`);

    const seen = new Set(existing.map((e) => `${e.name}::${e.levelId ?? ''}`));
    const fresh = source.filter((i) => !seen.has(`${i.name}::${i.levelId ?? ''}`));

    if (fresh.length > 0) {
      await this.db.feeItem.createMany({
        data: fresh.map((i) => ({
          schoolId: auth.schoolId,
          termId: to.id,
          levelId: i.levelId,
          name: i.name,
          amount: i.amount,
          optional: i.optional,
        })),
      });
    }

    await this.db.audit(auth.schoolId, auth.sub, 'fees.rollover', 'Term', to.id, {
      from: from.name,
      to: to.name,
      copied: fresh.length,
      skipped: source.length - fresh.length,
    });
    return { copied: fresh.length, skipped: source.length - fresh.length, toTerm: to.name };
  }

  // ── SMS credits ────────────────────────────────────────────────────

  /**
   * Record SMS credits the school has bought.
   *
   * Credits were only ever decremented, so a school ran dry with no way back. This records a
   * purchase settled outside the system (bank transfer or MoMo to the vendor) and the reference
   * ties it to that payment — deliberately not a card checkout, since we are not selling credits
   * through the gateway parents pay school fees with.
   */
  async topUpSms(auth: AuthUser, dto: TopUpDto) {
    const school = await this.db.school.update({
      where: { id: auth.schoolId },
      data: { smsCredits: { increment: dto.credits } },
      select: { smsCredits: true },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'sms.topup', 'School', auth.schoolId, {
      credits: dto.credits,
      reference: dto.reference,
    });
    return { credits: school.smsCredits, added: dto.credits };
  }

  // ── Concession rules ───────────────────────────────────────────────

  /**
   * Everything needed to price concessions for a whole invoicing run.
   *
   * Built once per run rather than per student because sibling rank is a property of the
   * *family*: you cannot tell whether a child is a second child by looking only at that child.
   * Families are grouped by guardian, which is already deduplicated by phone across siblings
   * (see students.module.ts), so two records of the same parent do not split one family in two.
   */
  private async concessionContext(schoolId: string) {
    const [rules, awards, links, levels] = await Promise.all([
      this.db.concessionRule.findMany({ where: { schoolId, active: true } }),
      this.db.concessionAward.findMany({
        where: { schoolId },
        select: { studentId: true, ruleId: true },
      }),
      this.db.studentGuardian.findMany({
        where: { student: { schoolId, status: 'ACTIVE' } },
        select: {
          guardianId: true,
          student: { select: { id: true, createdAt: true, admissionNo: true } },
        },
      }),
      this.db.classRoom.findMany({ where: { schoolId }, select: { id: true, levelId: true } }),
    ]);

    // One family per guardian. A child linked to two guardians appears in both, and takes the
    // best (lowest) rank — being the eldest in one parent's family is enough to pay in full.
    const byGuardian = new Map<
      string,
      { studentId: string; enrolledOn: Date; admissionNo: string }[]
    >();
    for (const l of links) {
      const list = byGuardian.get(l.guardianId) ?? [];
      list.push({
        studentId: l.student.id,
        enrolledOn: l.student.createdAt,
        admissionNo: l.student.admissionNo,
      });
      byGuardian.set(l.guardianId, list);
    }

    const bestRank = new Map<string, number>();
    for (const family of byGuardian.values()) {
      for (const [studentId, rank] of rankSiblings(family)) {
        bestRank.set(studentId, Math.min(bestRank.get(studentId) ?? Infinity, rank));
      }
    }

    const awardsByStudent = new Map<string, string[]>();
    for (const a of awards) {
      awardsByStudent.set(a.studentId, [...(awardsByStudent.get(a.studentId) ?? []), a.ruleId]);
    }
    const levelOfClass = new Map(levels.map((c) => [c.id, c.levelId]));

    return {
      rules: rules.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        basis: r.basis,
        value: Number(r.value),
        fromSibling: r.fromSibling,
        levelId: r.levelId,
        active: r.active,
        startsOn: r.startsOn,
        endsOn: r.endsOn,
      })),
      contextFor: (studentId: string, classId: string | null) => ({
        studentId,
        levelId: classId ? (levelOfClass.get(classId) ?? null) : null,
        // A child with no guardian on file is nobody's sibling, so ranks first and pays in full.
        siblingRank: bestRank.get(studentId) ?? 1,
        awardedRuleIds: awardsByStudent.get(studentId) ?? [],
      }),
    };
  }

  async concessionRules(auth: AuthUser) {
    const rows = await this.db.concessionRule.findMany({
      where: { schoolId: auth.schoolId },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { awards: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      basis: r.basis,
      value: Number(r.value),
      fromSibling: r.fromSibling,
      levelId: r.levelId,
      active: r.active,
      startsOn: r.startsOn,
      endsOn: r.endsOn,
      awardCount: r._count.awards,
    }));
  }

  async createConcessionRule(auth: AuthUser, dto: ConcessionRuleDto) {
    if (dto.basis === 'PERCENT' && (dto.value <= 0 || dto.value > 100)) {
      throw new BadRequestException('A percentage must be between 0 and 100');
    }
    if (dto.kind === 'SIBLING' && dto.fromSibling != null && dto.fromSibling < 2) {
      throw new BadRequestException(
        'A sibling discount starts at the second child — the eldest pays in full',
      );
    }
    const clash = await this.db.concessionRule.findFirst({
      where: { schoolId: auth.schoolId, name: dto.name },
    });
    if (clash) {
      throw new BadRequestException(
        `There is already a rule called "${dto.name}". Rules stack, so two with the same name would double the discount.`,
      );
    }
    const rule = await this.db.concessionRule.create({
      data: {
        schoolId: auth.schoolId,
        name: dto.name,
        kind: dto.kind,
        basis: dto.basis,
        value: new Prisma.Decimal(dto.value),
        fromSibling: dto.kind === 'SIBLING' ? (dto.fromSibling ?? 2) : null,
        levelId: dto.levelId ?? null,
        startsOn: dto.startsOn ? new Date(dto.startsOn) : null,
        endsOn: dto.endsOn ? new Date(dto.endsOn) : null,
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'fees.concession-rule',
      'ConcessionRule',
      rule.id,
      {
        name: dto.name,
        kind: dto.kind,
      },
    );
    return rule;
  }

  async setConcessionRuleActive(auth: AuthUser, id: string, active: boolean) {
    const rule = await this.db.concessionRule.findFirst({ where: { id, schoolId: auth.schoolId } });
    if (!rule) throw new NotFoundException('Rule not found');
    // Deactivated rather than deleted: invoices already discounted under it must stay
    // explicable, and the ledger entries reference it by name.
    await this.db.concessionRule.update({ where: { id }, data: { active } });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'fees.concession-rule-active',
      'ConcessionRule',
      id,
      {
        active,
      },
    );
    return { id, active };
  }

  /** Award a scholarship to a named child. Sibling rules are never awarded — they are computed. */
  async awardConcession(auth: AuthUser, dto: AwardDto) {
    const [rule, student] = await Promise.all([
      this.db.concessionRule.findFirst({ where: { id: dto.ruleId, schoolId: auth.schoolId } }),
      this.db.student.findFirst({ where: { id: dto.studentId, schoolId: auth.schoolId } }),
    ]);
    if (!rule) throw new NotFoundException('Rule not found');
    if (!student) throw new NotFoundException('Student not found');
    if (rule.kind !== 'SCHOLARSHIP') {
      throw new BadRequestException(
        'A sibling discount applies automatically to families — it cannot be awarded to a child',
      );
    }

    const award = await this.db.concessionAward.upsert({
      where: { ruleId_studentId: { ruleId: dto.ruleId, studentId: dto.studentId } },
      create: {
        schoolId: auth.schoolId,
        ruleId: dto.ruleId,
        studentId: dto.studentId,
        reason: dto.reason,
        awardedById: auth.sub,
      },
      update: { reason: dto.reason, awardedById: auth.sub },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'fees.concession-award',
      'Student',
      dto.studentId,
      {
        rule: rule.name,
        reason: dto.reason,
      },
    );
    return award;
  }

  /**
   * The scholarships actually on file for a child.
   *
   * Distinct from what a preview shows: a preview reports what *reaches* this child today, so an
   * award whose rule is inactive or out of its window is correctly absent there. A bursar
   * reviewing a record needs to see it is still recorded, and why.
   */
  async awardsFor(auth: AuthUser, studentId: string) {
    const rows = await this.db.concessionAward.findMany({
      where: { schoolId: auth.schoolId, studentId },
      include: {
        rule: { select: { name: true, kind: true, basis: true, value: true, active: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((a) => ({
      id: a.id,
      ruleId: a.ruleId,
      name: a.rule.name,
      basis: a.rule.basis,
      value: Number(a.rule.value),
      /// False when the rule has been switched off — the award stands, but nothing is applied.
      active: a.rule.active,
      reason: a.reason,
      awardedAt: a.createdAt,
    }));
  }

  async revokeAward(auth: AuthUser, id: string) {
    const award = await this.db.concessionAward.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!award) throw new NotFoundException('Award not found');
    await this.db.concessionAward.delete({ where: { id } });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'fees.concession-revoke',
      'Student',
      award.studentId,
    );
    // Past discounts stand: they were correct when the term was invoiced, and the ledger is
    // append-only. Revoking only stops future terms.
    return { revoked: true };
  }

  /**
   * What a named student would be let off on a bill of `amount`.
   *
   * A preview, so a bursar can see the effect of a rule before a whole term is invoiced under it.
   */
  async previewConcessions(auth: AuthUser, studentId: string, amount: number) {
    const student = await this.db.student.findFirst({
      where: { id: studentId, schoolId: auth.schoolId },
      select: { id: true, classId: true },
    });
    if (!student) throw new NotFoundException('Student not found');
    const { rules, contextFor } = await this.concessionContext(auth.schoolId);
    const ctx = contextFor(student.id, student.classId);
    const { applied, total } = concessionsFor(rules, ctx, amount);
    return {
      siblingRank: ctx.siblingRank,
      applied,
      total,
      payable: Math.round((amount - total) * 100) / 100,
    };
  }
}

@Controller('fees')
export class FeesController {
  constructor(private svc: FeesService) {}

  @Get('overview')
  @RequirePermission('fees.view')
  overview(@CurrentUser() user: AuthUser, @Query('termId') termId: string) {
    return this.svc.overview(user, termId);
  }

  @Get('items')
  @RequirePermission('fees.view')
  items(@CurrentUser() user: AuthUser, @Query('termId') termId: string) {
    return this.svc.items(user, termId);
  }

  @Get('defaulters')
  @RequirePermission('fees.view')
  defaulters(@CurrentUser() user: AuthUser, @Query() query: ListDefaultersDto) {
    return this.svc.listDefaulters(user, query);
  }

  @Get('clearances')
  @RequirePermission('fees.view')
  clearances(@CurrentUser() user: AuthUser, @Query('termId') termId: string) {
    return this.svc.listClearances(user, termId);
  }

  @Post('clearances')
  @RequirePermission('fees.clearance')
  grantClearance(@CurrentUser() user: AuthUser, @Body() dto: FeeClearanceDto) {
    return this.svc.grantClearance(user, dto);
  }

  @Delete('clearances/:studentId/:termId')
  @RequirePermission('fees.clearance')
  revokeClearance(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Param('termId') termId: string,
  ) {
    return this.svc.revokeClearance(user, studentId, termId);
  }

  @Get('students/:id/statement.pdf')
  @RequirePermission('fees.view')
  async statement(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { buffer, filename } = await this.svc.statementPdf(user, id);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get('journal/export')
  @RequirePermission('fees.view', 'fees.export')
  @RequireEntitlement('platform.export')
  async journalExport(
    @CurrentUser() user: AuthUser,
    @Query('format') format = 'xlsx',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { buffer, type, filename } = await this.svc.journalExport(user, format, from, to);
    return new StreamableFile(buffer, {
      type,
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get('ledger/export')
  @RequirePermission('fees.view', 'fees.export')
  @RequireEntitlement('platform.export')
  async ledgerExport(
    @CurrentUser() user: AuthUser,
    @Query('format') format = 'xlsx',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { buffer, type, filename } = await this.svc.ledgerExport(user, format, from, to);
    return new StreamableFile(buffer, {
      type,
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get('defaulters/export')
  @RequirePermission('fees.view', 'fees.export')
  @RequireEntitlement('platform.export')
  async defaultersExport(
    @CurrentUser() user: AuthUser,
    @Query('termId') termId: string,
    @Query('format') format = 'xlsx',
  ) {
    const { buffer, type, filename } = await this.svc.defaultersExport(user, termId, format);
    return new StreamableFile(buffer, {
      type,
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Post('items')
  @RequirePermission('fees.structure')
  createItem(@CurrentUser() user: AuthUser, @Body() dto: FeeItemDto) {
    return this.svc.createFeeItem(user, dto);
  }

  @Patch('items/:id')
  @RequirePermission('fees.structure')
  updateItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateFeeItemDto,
  ) {
    return this.svc.updateFeeItem(user, id, dto);
  }

  @Delete('items/:id')
  @RequirePermission('fees.structure')
  deleteItem(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteFeeItem(user, id);
  }

  @Get('students/:studentId/items')
  @RequirePermission('fees.view')
  studentItems(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Query('termId') termId: string,
  ) {
    return this.svc.studentFeeItems(user, studentId, termId);
  }

  @Post('students/:studentId/items')
  @RequirePermission('fees.structure')
  setStudentItem(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Body() dto: StudentFeeItemDto,
  ) {
    return this.svc.setStudentFeeItem(user, studentId, dto);
  }

  @Get('reminders/templates')
  @RequirePermission('comms.reminders')
  templates(@CurrentUser() user: AuthUser) {
    return this.svc.listTemplates(user);
  }

  @Post('reminders/templates')
  @RequirePermission('comms.reminders')
  saveTemplate(@CurrentUser() user: AuthUser, @Body() body: { kind: string; body: string }) {
    return this.svc.saveTemplate(user, body.kind, body.body);
  }

  @Get('reminders/schedule')
  @RequirePermission('comms.reminders')
  schedule(@CurrentUser() user: AuthUser) {
    return this.svc.reminderSchedule(user);
  }

  @Post('reminders/schedule')
  @RequirePermission('comms.reminders')
  setSchedule(@CurrentUser() user: AuthUser, @Body() dto: ReminderScheduleDto) {
    return this.svc.setReminderSchedule(user, dto);
  }

  @Post('reminders')
  @RequirePermission('comms.sms')
  reminders(
    @CurrentUser() user: AuthUser,
    @Query('termId') termId: string,
    @Query('dryRun') dryRun?: string,
  ) {
    return this.svc.sendReminders(user, termId, dryRun === 'true');
  }

  @Post('concessions')
  @RequirePermission('fees.concessions')
  concession(@CurrentUser() user: AuthUser, @Body() dto: ConcessionDto) {
    return this.svc.grantConcession(user, dto);
  }

  @Get('installments/:studentId')
  @RequirePermission('fees.view')
  @RequireEntitlement('fees.installments')
  installments(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string) {
    return this.svc.installments(user, studentId);
  }

  @Post('installments')
  @RequirePermission('fees.structure')
  @RequireEntitlement('fees.installments')
  setInstallments(@CurrentUser() user: AuthUser, @Body() dto: InstallmentPlanDto) {
    return this.svc.setInstallmentPlan(user, dto);
  }

  @Post('items/rollover')
  @RequirePermission('fees.structure')
  rollover(@CurrentUser() user: AuthUser, @Body() dto: RolloverDto) {
    return this.svc.rolloverFeeItems(user, dto);
  }

  @Post('sms/topup')
  @RequirePermission('comms.sms')
  topUp(@CurrentUser() user: AuthUser, @Body() dto: TopUpDto) {
    return this.svc.topUpSms(user, dto);
  }

  @Get('concessions/rules')
  @RequirePermission('fees.view')
  @RequireEntitlement('fees.discounts')
  concessionRules(@CurrentUser() user: AuthUser) {
    return this.svc.concessionRules(user);
  }

  @Post('concessions/rules')
  @RequirePermission('fees.concessions')
  @RequireEntitlement('fees.discounts')
  createConcessionRule(@CurrentUser() user: AuthUser, @Body() dto: ConcessionRuleDto) {
    return this.svc.createConcessionRule(user, dto);
  }

  @Patch('concessions/rules/:id')
  @RequirePermission('fees.concessions')
  @RequireEntitlement('fees.discounts')
  setRuleActive(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { active: boolean },
  ) {
    return this.svc.setConcessionRuleActive(user, id, !!body.active);
  }

  @Post('concessions/awards')
  @RequirePermission('fees.concessions')
  @RequireEntitlement('fees.discounts')
  award(@CurrentUser() user: AuthUser, @Body() dto: AwardDto) {
    return this.svc.awardConcession(user, dto);
  }

  @Get('concessions/awards')
  @RequirePermission('fees.view')
  @RequireEntitlement('fees.discounts')
  awardsFor(@CurrentUser() user: AuthUser, @Query('studentId') studentId: string) {
    return this.svc.awardsFor(user, studentId);
  }

  @Delete('concessions/awards/:id')
  @RequirePermission('fees.concessions')
  @RequireEntitlement('fees.discounts')
  revokeAward(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.revokeAward(user, id);
  }

  @Get('concessions/preview/:studentId')
  @RequirePermission('fees.view')
  @RequireEntitlement('fees.discounts')
  previewConcessions(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Query('amount') amount: string,
  ) {
    return this.svc.previewConcessions(user, studentId, Number(amount) || 0);
  }

  @Post('invoices/generate')
  @RequirePermission('fees.invoice')
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateInvoicesDto) {
    return this.svc.generateInvoices(user, dto);
  }

  @Post('payments')
  @RequirePermission('fees.record_payment')
  record(@CurrentUser() user: AuthUser, @Body() dto: RecordPaymentDto) {
    return this.svc.recordPayment(user, dto);
  }

  @Post('ledger/:id/reverse')
  @RequirePermission('fees.reverse')
  reverse(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReverseDto) {
    return this.svc.reverseEntry(user, id, dto);
  }

  @Post('deposits')
  @RequirePermission('fees.deposit_submit')
  @UseInterceptors(FileInterceptor('proof'))
  submitDeposit(
    @CurrentUser() user: AuthUser,
    @Body() dto: BankDepositDto,
    @UploadedFile() proof: UploadedFileLike,
  ) {
    return this.svc.submitDeposit(user, dto, proof);
  }

  @Get('deposits')
  @RequirePermission('fees.view')
  deposits(@CurrentUser() user: AuthUser, @Query() query: ListDepositsDto) {
    return this.svc.listDeposits(user, query);
  }

  @Get('deposits/:id/proof')
  @RequirePermission('fees.view')
  async depositProof(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const buf = await this.svc.readDepositProof(user, id);
    return new StreamableFile(buf);
  }

  /** Turning a claimed deposit into money is its own permission, not a rank. */
  @Post('deposits/:id/confirm')
  @RequirePermission('fees.deposits')
  confirmDeposit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.confirmDeposit(user, id);
  }

  @Post('deposits/:id/reject')
  @RequirePermission('fees.deposits')
  rejectDeposit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.svc.rejectDeposit(user, id, reason);
  }

  @Get('receipts/:reference/pdf')
  @RequirePermission('fees.view')
  async receipt(@CurrentUser() user: AuthUser, @Param('reference') reference: string) {
    const buf = await this.svc.receiptPdf(user.schoolId, reference);
    return new StreamableFile(buf, {
      type: 'application/pdf',
      disposition: `attachment; filename="receipt-${reference}.pdf"`,
    });
  }
}

const REMINDERS_QUEUE = 'fee-reminders';
/** Checked hourly; each school fires only in its own chosen hour, at most once a day. */
const TICK_MS = 60 * 60 * 1000;

/**
 * Runs each school's fee reminders on the day and hour it chose.
 *
 * Guarded by REDIS_URL like the payments sweep: without Redis the feature degrades to the
 * manual Send button rather than breaking, which matters for standalone installs that run
 * without a queue.
 */
@Injectable()
export class RemindersQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('RemindersQueue');
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private db: PrismaService,
    private svc: FeesService,
  ) {}

  async onModuleInit() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.warn('REDIS_URL not set — scheduled fee reminders disabled; send manually.');
      return;
    }
    try {
      this.connection = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
      await this.connection.connect();
      this.queue = new Queue(REMINDERS_QUEUE, { connection: this.connection });
      this.worker = new Worker(REMINDERS_QUEUE, () => this.tick(), {
        connection: this.connection,
      });
      this.worker.on('failed', (_job, err) => this.logger.error(`tick failed: ${err.message}`));
      await this.queue.upsertJobScheduler(
        'reminder-tick',
        { every: TICK_MS },
        { name: 'tick', opts: { attempts: 2 } },
      );
      this.logger.log('Scheduled fee reminders enabled.');
    } catch (err) {
      this.logger.warn(`Redis unavailable (${(err as Error).message}) — reminders stay manual.`);
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  /**
   * One pass: every school whose chosen slot is now and which has not already run today.
   *
   * The enumeration uses the system client, and everything per-school runs inside that school's
   * tenant. A worker has no request, so the tenant-aware client resolves `app_current_school()`
   * to NULL and every row-level policy matches nothing — this loop read an empty job list on
   * every tick and did nothing, silently, in any deployment with REDIS_URL set. Scheduled fee
   * reminders looked configured and enabled in the UI and had never sent a single message.
   */
  /** The tick itself, callable directly by the QStash callback route below — no BullMQ involved. */
  async runNow() {
    return this.tick();
  }

  private async tick() {
    const now = new Date();
    const jobs = await this.db.system.scheduledJob.findMany({
      where: { kind: 'FEE_REMINDERS', enabled: true },
    });
    for (const job of jobs) {
      if (job.hour !== now.getHours()) continue;
      if (job.dayOfWeek !== null && job.dayOfWeek !== now.getDay()) continue;
      // Weekday default: never nag families at the weekend.
      if (job.dayOfWeek === null && (now.getDay() === 0 || now.getDay() === 6)) continue;
      if (job.lastRunAt && job.lastRunAt.toDateString() === now.toDateString()) continue;

      await withTenant(job.schoolId, async () => {
        const term = await this.db.term.findFirst({
          where: { isCurrent: true, academicYear: { schoolId: job.schoolId, isCurrent: true } },
        });
        if (!term) return;

        // The job acts as the school itself; sendReminders only needs the tenant and an actor id.
        const actor = await this.db.user.findFirst({
          where: {
            schoolId: job.schoolId,
            role: { in: ['OWNER', 'HEAD', 'BURSAR'] },
            active: true,
          },
        });
        if (!actor) return;

        try {
          const res = await this.svc.sendReminders(
            {
              sub: actor.id,
              schoolId: job.schoolId,
              role: actor.role,
              tier: 'MEDIUM',
              name: actor.name,
            },
            term.id,
          );
          this.logger.log(`school ${job.schoolId}: sent ${res.sent} reminder(s)`);
        } catch (err) {
          this.logger.error(`school ${job.schoolId} reminders failed: ${(err as Error).message}`);
        }
        await this.db.scheduledJob.update({ where: { id: job.id }, data: { lastRunAt: now } });
      });
    }
  }
}

/**
 * QStash's serverless alternative to `RemindersQueue`'s BullMQ worker (docs/10 §5) — a scheduled
 * HTTP callback instead of a persistent listener, for deployments with no Redis. Active only when
 * `QSTASH_CURRENT_SIGNING_KEY` is set; a deployment using BullMQ instead never calls this route.
 */
@Controller('fees/internal')
export class FeesQstashController {
  constructor(private queue: RemindersQueue) {}

  @Post('qstash/reminders-tick')
  @Public()
  async qstashTick(@Req() req: RawRequest) {
    const raw = (req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}))).toString('utf8');
    const ok = await verifyQstashSignature(req.headers['upstash-signature'], raw);
    if (!ok) throw new UnauthorizedException('Invalid QStash signature');
    await this.queue.runNow();
    return { ok: true };
  }
}

@Module({
  imports: [IntegrationsModule, SmsModule],
  controllers: [FeesController, FeesQstashController],
  providers: [FeesService, RemindersQueue],
  exports: [FeesService],
})
export class FeesModule {}
