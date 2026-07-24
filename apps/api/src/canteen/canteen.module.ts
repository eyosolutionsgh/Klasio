/**
 * Canteen wallet (canteen.wallet).
 *
 * A prepaid wallet per pupil. Parents top it up; the counter spends from it at lunch. The balance
 * is never stored — it is derived from an append-only ledger, exactly as the fee balance is, so a
 * mistake is corrected with a REVERSAL that points at the entry it cancels (reversedId), never an
 * edit. That is what keeps a till honest: the history always adds up to the balance, and nothing
 * changes underneath a parent who topped up last week.
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
  Post,
  Query,
} from '@nestjs/common';
import { IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthUser,
  CurrentUser,
  RequireAnyPermission,
  RequireEntitlement,
  RequirePermission,
} from '../common/auth';

class MoveDto {
  @IsOptional() @IsString() studentId?: string;
  @IsOptional() @IsString() admissionNo?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount: number;
  @IsOptional() @IsString() @MaxLength(120) note?: string;
}

interface Txn {
  id: string;
  type: 'TOPUP' | 'SPEND' | 'REVERSAL';
  amount: unknown;
  reversedId: string | null;
}

/** Balance in whole units, derived from the ledger. Reversed entries and reversals both drop out. */
function balanceOf(txns: Txn[]): number {
  const reversed = new Set(
    txns.filter((t) => t.type === 'REVERSAL' && t.reversedId).map((t) => t.reversedId as string),
  );
  let pesewas = 0;
  for (const t of txns) {
    if (t.type === 'REVERSAL' || reversed.has(t.id)) continue;
    const amt = Math.round(Number(t.amount) * 100);
    pesewas += t.type === 'TOPUP' ? amt : -amt;
  }
  return pesewas / 100;
}

@Injectable()
export class CanteenService {
  constructor(private db: PrismaService) {}

  private name(s: { firstName: string; lastName: string }) {
    return `${s.firstName} ${s.lastName}`;
  }

  private async findStudent(auth: AuthUser, studentId?: string, admissionNo?: string) {
    const student = studentId
      ? await this.db.student.findFirst({ where: { id: studentId, schoolId: auth.schoolId } })
      : admissionNo
        ? await this.db.student.findFirst({
            where: { admissionNo: admissionNo.trim(), schoolId: auth.schoolId },
          })
        : null;
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  /** The whole till on one screen: what is held, today's movement, and every funded wallet. */
  async overview(auth: AuthUser) {
    const txns = await this.db.canteenTxn.findMany({
      where: { schoolId: auth.schoolId },
      orderBy: { createdAt: 'desc' },
    });

    const byStudent = new Map<string, Txn[]>();
    for (const t of txns) {
      const list = byStudent.get(t.studentId) ?? [];
      list.push(t);
      byStudent.set(t.studentId, list);
    }

    const students = await this.db.student.findMany({
      where: { schoolId: auth.schoolId, id: { in: [...byStudent.keys()] } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNo: true,
        classRoom: { select: { name: true } },
      },
    });
    const studentById = new Map(students.map((s) => [s.id, s]));

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const reversedIds = new Set(
      txns.filter((t) => t.type === 'REVERSAL' && t.reversedId).map((t) => t.reversedId as string),
    );
    let held = 0;
    let topupsToday = 0;
    let spendToday = 0;
    for (const [, list] of byStudent) held += balanceOf(list);
    for (const t of txns) {
      if (t.createdAt < dayStart || t.type === 'REVERSAL' || reversedIds.has(t.id)) continue;
      const amt = Number(t.amount);
      if (t.type === 'TOPUP') topupsToday += amt;
      else spendToday += amt;
    }

    const accounts = [...byStudent.entries()]
      .map(([studentId, list]) => {
        const s = studentById.get(studentId);
        return {
          studentId,
          name: s ? this.name(s) : 'Unknown',
          admissionNo: s?.admissionNo ?? null,
          className: s?.classRoom?.name ?? null,
          balance: balanceOf(list),
        };
      })
      // Lowest balances first — the ones about to run out are what a bursar is looking for.
      .sort((a, b) => a.balance - b.balance || a.name.localeCompare(b.name));

    const recent = txns.slice(0, 20).map((t) => {
      const s = studentById.get(t.studentId);
      return {
        id: t.id,
        studentId: t.studentId,
        name: s ? this.name(s) : 'Unknown',
        type: t.type,
        amount: Number(t.amount),
        note: t.note,
        createdAt: t.createdAt,
        reversed: reversedIds.has(t.id),
      };
    });

    return {
      stats: {
        funded: accounts.filter((a) => a.balance > 0).length,
        held: Math.round(held * 100) / 100,
        topupsToday: Math.round(topupsToday * 100) / 100,
        spendToday: Math.round(spendToday * 100) / 100,
      },
      accounts,
      recent,
    };
  }

  /** One pupil's wallet: balance and full history. */
  async wallet(auth: AuthUser, studentId: string) {
    const student = await this.findStudent(auth, studentId);
    const txns = await this.db.canteenTxn.findMany({
      where: { schoolId: auth.schoolId, studentId: student.id },
      orderBy: { createdAt: 'desc' },
    });
    const reversedIds = new Set(
      txns.filter((t) => t.type === 'REVERSAL' && t.reversedId).map((t) => t.reversedId as string),
    );
    return {
      studentId: student.id,
      name: this.name(student),
      balance: balanceOf(txns),
      history: txns.map((t) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        note: t.note,
        createdAt: t.createdAt,
        reversed: reversedIds.has(t.id),
      })),
    };
  }

  /** Active pupils to top up, each with their current balance. */
  async candidates(auth: AuthUser, q?: string) {
    const term = (q ?? '').trim();
    const students = await this.db.student.findMany({
      where: {
        schoolId: auth.schoolId,
        status: 'ACTIVE',
        ...(term
          ? {
              OR: [
                { firstName: { contains: term, mode: 'insensitive' } },
                { lastName: { contains: term, mode: 'insensitive' } },
                { admissionNo: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNo: true,
        classRoom: { select: { name: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 20,
    });
    const txns = await this.db.canteenTxn.findMany({
      where: { schoolId: auth.schoolId, studentId: { in: students.map((s) => s.id) } },
    });
    const byStudent = new Map<string, Txn[]>();
    for (const t of txns) {
      const list = byStudent.get(t.studentId) ?? [];
      list.push(t);
      byStudent.set(t.studentId, list);
    }
    return students.map((s) => ({
      studentId: s.id,
      name: this.name(s),
      admissionNo: s.admissionNo,
      className: s.classRoom?.name ?? null,
      balance: balanceOf(byStudent.get(s.id) ?? []),
    }));
  }

  private async currentBalance(auth: AuthUser, studentId: string) {
    const txns = await this.db.canteenTxn.findMany({
      where: { schoolId: auth.schoolId, studentId },
    });
    return balanceOf(txns);
  }

  async topup(auth: AuthUser, dto: MoveDto) {
    const student = await this.findStudent(auth, dto.studentId, dto.admissionNo);
    const txn = await this.db.canteenTxn.create({
      data: {
        schoolId: auth.schoolId,
        studentId: student.id,
        type: 'TOPUP',
        amount: dto.amount,
        note: dto.note?.trim() || null,
        createdById: auth.sub,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'canteen.topup', 'Student', student.id, {
      amount: dto.amount,
    });
    return { ok: true, balance: await this.currentBalance(auth, student.id), id: txn.id };
  }

  async spend(auth: AuthUser, dto: MoveDto) {
    const student = await this.findStudent(auth, dto.studentId, dto.admissionNo);
    const balance = await this.currentBalance(auth, student.id);
    if (dto.amount > balance) {
      throw new BadRequestException(
        `That is more than the wallet holds (balance ${balance.toFixed(2)}). Top up first.`,
      );
    }
    const txn = await this.db.canteenTxn.create({
      data: {
        schoolId: auth.schoolId,
        studentId: student.id,
        type: 'SPEND',
        amount: dto.amount,
        note: dto.note?.trim() || null,
        createdById: auth.sub,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'canteen.spend', 'Student', student.id, {
      amount: dto.amount,
    });
    return { ok: true, balance: await this.currentBalance(auth, student.id), id: txn.id };
  }

  /** Correct a mistake the append-only way: a REVERSAL that points at what it cancels. */
  async reverse(auth: AuthUser, id: string) {
    const original = await this.db.canteenTxn.findFirst({
      where: { id, schoolId: auth.schoolId },
    });
    if (!original) throw new NotFoundException('Entry not found');
    if (original.type === 'REVERSAL') {
      throw new BadRequestException('A reversal cannot itself be reversed');
    }
    const already = await this.db.canteenTxn.findFirst({
      where: { schoolId: auth.schoolId, type: 'REVERSAL', reversedId: id },
    });
    if (already) throw new BadRequestException('That entry has already been reversed');

    await this.db.canteenTxn.create({
      data: {
        schoolId: auth.schoolId,
        studentId: original.studentId,
        type: 'REVERSAL',
        amount: original.amount,
        reversedId: original.id,
        note: `Reversal of ${original.type.toLowerCase()}`,
        createdById: auth.sub,
      },
    });
    await this.db.audit(auth.schoolId, auth.sub, 'canteen.reverse', 'Student', original.studentId, {
      reversedId: id,
    });
    return { ok: true, balance: await this.currentBalance(auth, original.studentId) };
  }
}

@Controller('canteen')
@RequireEntitlement('canteen.wallet')
export class CanteenController {
  constructor(private svc: CanteenService) {}

  @Get()
  @RequireAnyPermission('canteen.view', 'canteen.manage')
  overview(@CurrentUser() user: AuthUser) {
    return this.svc.overview(user);
  }

  @Get('students')
  @RequirePermission('canteen.manage')
  candidates(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    return this.svc.candidates(user, q);
  }

  @Get(':studentId')
  @RequireAnyPermission('canteen.view', 'canteen.manage')
  wallet(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string) {
    return this.svc.wallet(user, studentId);
  }

  @Post('topup')
  @RequirePermission('canteen.manage')
  topup(@CurrentUser() user: AuthUser, @Body() dto: MoveDto) {
    return this.svc.topup(user, dto);
  }

  @Post('spend')
  @RequirePermission('canteen.manage')
  spend(@CurrentUser() user: AuthUser, @Body() dto: MoveDto) {
    return this.svc.spend(user, dto);
  }

  @Post('txns/:id/reverse')
  @RequirePermission('canteen.manage')
  reverse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.reverse(user, id);
  }
}

@Module({
  controllers: [CanteenController],
  providers: [CanteenService],
})
export class CanteenModule {}
