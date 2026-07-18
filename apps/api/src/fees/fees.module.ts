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
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FileInterceptor } from '@nestjs/platform-express';
import { DOCUMENT_TYPES, MAX_UPLOAD_BYTES, objectKey, storage } from '../common/storage';

/** Minimal shape of a Multer upload — avoids depending on @types/multer. */
interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}
import { PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequireEntitlement, Roles } from '../common/auth';
import { receiptPdf } from '../common/pdf';
import { toCsv, toXlsx, Cell } from '../common/export';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

class RecordPaymentDto {
  @IsString() studentId: string;
  @IsNumber() @IsPositive() amount: number;
  @IsEnum(PaymentMethod) method: PaymentMethod;
  @IsOptional() @IsString() note?: string;
  /** Term the money settles. Defaults to the current term; set it to clear an older arrear. */
  @IsOptional() @IsString() termId?: string;
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

@Injectable()
export class FeesService {
  constructor(private db: PrismaService) {}

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
    const count = await this.db.invoice.count({ where: { schoolId: auth.schoolId } });

    let created = 0;
    for (const st of students) {
      if (invoiced.has(st.id)) continue;
      const lines = [...baseLines, ...(extrasFor.get(st.id) ?? [])];
      const total = lines.reduce((a, l) => a + l.amount, 0);
      const number = `INV-2026-${String(count + created + 1).padStart(4, '0')}`;
      await this.db.$transaction([
        this.db.invoice.create({
          data: {
            schoolId: auth.schoolId,
            studentId: st.id,
            termId: dto.termId,
            number,
            lines: lines as unknown as Prisma.InputJsonValue,
            total,
          },
        }),
        this.db.ledgerEntry.create({
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
        }),
      ]);
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

  /** Who owes money as of this term, counting arrears carried in from earlier terms. */
  async defaulters(auth: AuthUser, termId: string) {
    const entries = await this.db.ledgerEntry.findMany({
      where: await this.asOfTerm(auth, termId),
      include: {
        student: {
          select: {
            firstName: true,
            lastName: true,
            admissionNo: true,
            classRoom: { select: { name: true } },
            guardians: {
              where: { isPrimary: true },
              include: { guardian: { select: { phone: true } } },
            },
          },
        },
      },
    });
    const byStudent = new Map<
      string,
      {
        name: string;
        admissionNo: string;
        className: string;
        phone: string | null;
        balance: number;
      }
    >();
    for (const e of entries) {
      const cur = byStudent.get(e.studentId) ?? {
        name: `${e.student.firstName} ${e.student.lastName}`,
        admissionNo: e.student.admissionNo,
        className: e.student.classRoom?.name ?? '—',
        phone: e.student.guardians[0]?.guardian.phone ?? null,
        balance: 0,
      };
      const amt = Number(e.amount);
      cur.balance += e.type === 'INVOICE' ? amt : e.type === 'REVERSAL' ? 0 : -amt;
      byStudent.set(e.studentId, cur);
    }
    return [...byStudent.entries()]
      .filter(([, v]) => v.balance > 0.005)
      .map(([studentId, v]) => ({ studentId, ...v, balance: Math.round(v.balance * 100) / 100 }))
      .sort((a, b) => b.balance - a.balance);
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
    return {
      buffer: await toXlsx('Defaulters', headers, rows),
      type: XLSX_MIME,
      filename: 'defaulters.xlsx',
    };
  }

  /** Record a manual payment (cash/bank/momo recorded at office). Append-only + receipt. */
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
    const paySeq =
      (await this.db.ledgerEntry.count({ where: { schoolId: auth.schoolId, type: 'PAYMENT' } })) +
      1;
    const rcpSeq = (await this.db.receipt.count({ where: { schoolId: auth.schoolId } })) + 1;
    const entry = await this.db.ledgerEntry.create({
      data: {
        schoolId: auth.schoolId,
        studentId: dto.studentId,
        termId: term?.id,
        type: 'PAYMENT',
        amount: dto.amount,
        method: dto.method,
        reference: `PAY-2026-${String(paySeq).padStart(5, '0')}`,
        note: dto.note,
        createdById: auth.sub,
      },
    });
    const receipt = await this.db.receipt.create({
      data: {
        schoolId: auth.schoolId,
        ledgerEntryId: entry.id,
        number: `RCP-2026-${String(rcpSeq).padStart(5, '0')}`,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'payment.record', 'Student', dto.studentId, {
      amount: dto.amount,
      method: dto.method,
      reference: entry.reference,
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
    const seq = (await this.db.bankDeposit.count({ where: { schoolId: auth.schoolId } })) + 1;
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
        reference: `DEP-2026-${String(seq).padStart(5, '0')}`,
        submittedById: auth.sub,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'deposit.submit', 'BankDeposit', deposit.id, {
      amount: dto.amount,
      reference: deposit.reference,
    });
    return { id: deposit.id, reference: deposit.reference, status: deposit.status };
  }

  async listDeposits(auth: AuthUser, status?: string) {
    const deposits = await this.db.bankDeposit.findMany({
      where: { schoolId: auth.schoolId, ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        student: { select: { firstName: true, lastName: true, admissionNo: true } },
      },
    });
    return deposits.map((d) => ({
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
  }

  async readDepositProof(auth: AuthUser, id: string) {
    const deposit = await this.db.bankDeposit.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!deposit?.proofKey) throw new NotFoundException('No proof on file');
    return storage().get(deposit.proofKey);
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
    if (deposit.status === 'REJECTED') {
      throw new BadRequestException('This deposit was rejected');
    }

    const existing = await this.db.ledgerEntry.findUnique({
      where: { reference: deposit.reference },
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

    const rcpSeq = (await this.db.receipt.count({ where: { schoolId: auth.schoolId } })) + 1;
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
          number: `RCP-2026-${String(rcpSeq).padStart(5, '0')}`,
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
    const balanceAfter = priorEntries.reduce((acc, e) => {
      const amt = Number(e.amount);
      if (e.type === 'INVOICE') return acc + amt;
      if (e.type === 'REVERSAL') return acc;
      return acc - amt;
    }, 0);

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
}

@Controller('fees')
export class FeesController {
  constructor(private svc: FeesService) {}

  @Get('overview')
  overview(@CurrentUser() user: AuthUser, @Query('termId') termId: string) {
    return this.svc.overview(user, termId);
  }

  @Get('items')
  items(@CurrentUser() user: AuthUser, @Query('termId') termId: string) {
    return this.svc.items(user, termId);
  }

  @Get('defaulters')
  defaulters(@CurrentUser() user: AuthUser, @Query('termId') termId: string) {
    return this.svc.defaulters(user, termId);
  }

  @Get('defaulters/export')
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
  @Roles('OWNER', 'HEAD', 'BURSAR')
  createItem(@CurrentUser() user: AuthUser, @Body() dto: FeeItemDto) {
    return this.svc.createFeeItem(user, dto);
  }

  @Patch('items/:id')
  @Roles('OWNER', 'HEAD', 'BURSAR')
  updateItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateFeeItemDto,
  ) {
    return this.svc.updateFeeItem(user, id, dto);
  }

  @Delete('items/:id')
  @Roles('OWNER', 'HEAD', 'BURSAR')
  deleteItem(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteFeeItem(user, id);
  }

  @Get('students/:studentId/items')
  studentItems(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Query('termId') termId: string,
  ) {
    return this.svc.studentFeeItems(user, studentId, termId);
  }

  @Post('students/:studentId/items')
  @Roles('OWNER', 'HEAD', 'BURSAR')
  setStudentItem(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Body() dto: StudentFeeItemDto,
  ) {
    return this.svc.setStudentFeeItem(user, studentId, dto);
  }

  @Post('invoices/generate')
  @Roles('OWNER', 'HEAD', 'BURSAR')
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateInvoicesDto) {
    return this.svc.generateInvoices(user, dto);
  }

  @Post('payments')
  @Roles('OWNER', 'HEAD', 'BURSAR', 'FRONT_DESK')
  record(@CurrentUser() user: AuthUser, @Body() dto: RecordPaymentDto) {
    return this.svc.recordPayment(user, dto);
  }

  @Post('deposits')
  @Roles('OWNER', 'HEAD', 'BURSAR', 'FRONT_DESK')
  @UseInterceptors(FileInterceptor('proof'))
  submitDeposit(
    @CurrentUser() user: AuthUser,
    @Body() dto: BankDepositDto,
    @UploadedFile() proof: UploadedFileLike,
  ) {
    return this.svc.submitDeposit(user, dto, proof);
  }

  @Get('deposits')
  @Roles('OWNER', 'HEAD', 'BURSAR', 'FRONT_DESK')
  deposits(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.svc.listDeposits(user, status);
  }

  @Get('deposits/:id/proof')
  @Roles('OWNER', 'HEAD', 'BURSAR', 'FRONT_DESK')
  async depositProof(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const buf = await this.svc.readDepositProof(user, id);
    return new StreamableFile(buf);
  }

  /** Only a bursar/head may turn a claimed deposit into money. */
  @Post('deposits/:id/confirm')
  @Roles('OWNER', 'HEAD', 'BURSAR')
  confirmDeposit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.confirmDeposit(user, id);
  }

  @Post('deposits/:id/reject')
  @Roles('OWNER', 'HEAD', 'BURSAR')
  rejectDeposit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.svc.rejectDeposit(user, id, reason);
  }

  @Get('receipts/:reference/pdf')
  async receipt(@CurrentUser() user: AuthUser, @Param('reference') reference: string) {
    const buf = await this.svc.receiptPdf(user.schoolId, reference);
    return new StreamableFile(buf, {
      type: 'application/pdf',
      disposition: `attachment; filename="receipt-${reference}.pdf"`,
    });
  }
}

@Module({ controllers: [FeesController], providers: [FeesService], exports: [FeesService] })
export class FeesModule {}
