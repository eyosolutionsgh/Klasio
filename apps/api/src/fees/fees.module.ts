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
} from '@nestjs/common';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
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

class UpdateFeeItemDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsString() levelId?: string | null;
  @IsOptional() @IsBoolean() optional?: boolean;
}

@Injectable()
export class FeesService {
  constructor(private db: PrismaService) {}

  async overview(auth: AuthUser, termId: string) {
    const [invoiced, collected, byMethod, recent, defaulterCount] = await Promise.all([
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
      this.defaulters(auth, termId).then((d) => d.length),
    ]);
    const money = (n: number) => Math.round(n * 100) / 100;
    return {
      invoiced: money(Number(invoiced._sum.amount ?? 0)),
      collected: money(Number(collected._sum.amount ?? 0)),
      outstanding: money(Number(invoiced._sum.amount ?? 0) - Number(collected._sum.amount ?? 0)),
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
    const items = await this.db.feeItem.findMany({
      where: { schoolId: auth.schoolId, termId: dto.termId, optional: false },
    });
    if (items.length === 0) throw new BadRequestException('No fee items configured for this term');
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
    const lines = items.map((i) => ({ name: i.name, amount: Number(i.amount) }));
    const total = lines.reduce((a, l) => a + l.amount, 0);
    const count = await this.db.invoice.count({ where: { schoolId: auth.schoolId } });

    let created = 0;
    for (const st of students) {
      if (invoiced.has(st.id)) continue;
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
    return { created, skipped: students.length - created, total };
  }

  async defaulters(auth: AuthUser, termId: string) {
    const entries = await this.db.ledgerEntry.findMany({
      where: { schoolId: auth.schoolId, termId },
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
    const term = await this.db.term.findFirst({
      where: { isCurrent: true, academicYear: { schoolId: auth.schoolId, isCurrent: true } },
    });
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

  /** Branded PDF receipt for a recorded payment, with the running balance as of that payment. */
  async receiptPdf(auth: AuthUser, reference: string) {
    const entry = await this.db.ledgerEntry.findFirst({
      where: { schoolId: auth.schoolId, reference, type: 'PAYMENT' },
      include: {
        receipt: true,
        student: { include: { classRoom: { select: { name: true } } } },
      },
    });
    if (!entry || !entry.receipt) throw new NotFoundException('Receipt not found');
    const school = await this.db.school.findUniqueOrThrow({ where: { id: auth.schoolId } });

    // Running balance up to and including this payment.
    const priorEntries = await this.db.ledgerEntry.findMany({
      where: {
        schoolId: auth.schoolId,
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

    return receiptPdf({
      school: {
        name: school.name,
        motto: school.motto,
        address: school.address,
        phone: school.phone,
      },
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

  @Get('receipts/:reference/pdf')
  async receipt(@CurrentUser() user: AuthUser, @Param('reference') reference: string) {
    const buf = await this.svc.receiptPdf(user, reference);
    return new StreamableFile(buf, {
      type: 'application/pdf',
      disposition: `attachment; filename="receipt-${reference}.pdf"`,
    });
  }
}

@Module({ controllers: [FeesController], providers: [FeesService] })
export class FeesModule {}
