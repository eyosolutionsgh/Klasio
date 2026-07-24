import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser } from '../common/auth';
import { balanceOf } from '../common/ledger';

@Injectable()
export class DashboardService {
  constructor(private db: PrismaService) {}

  async stats(auth: AuthUser) {
    const term = await this.db.term.findFirst({
      where: { isCurrent: true, academicYear: { schoolId: auth.schoolId, isCurrent: true } },
      include: { academicYear: { select: { name: true } } },
    });
    const [studentCount, staffCount, classCount, invoiced, collected, announcements] =
      await Promise.all([
        this.db.student.count({ where: { schoolId: auth.schoolId, status: 'ACTIVE' } }),
        this.db.user.count({
          where: { schoolId: auth.schoolId, active: true, role: { not: 'GUARDIAN' } },
        }),
        this.db.classRoom.count({ where: { schoolId: auth.schoolId } }),
        term
          ? this.db.ledgerEntry.aggregate({
              where: { schoolId: auth.schoolId, termId: term.id, type: 'INVOICE' },
              _sum: { amount: true },
            })
          : null,
        term
          ? this.db.ledgerEntry.aggregate({
              where: {
                schoolId: auth.schoolId,
                termId: term.id,
                type: { in: ['PAYMENT', 'DISCOUNT', 'WAIVER'] },
              },
              _sum: { amount: true },
            })
          : null,
        this.db.announcement.findMany({
          where: { schoolId: auth.schoolId },
          orderBy: { publishedAt: 'desc' },
          take: 3,
        }),
      ]);

    /**
     * Cumulative arrears: this term and every earlier one, plus the term-less opening balances
     * carried in at onboarding. Summed per student and then totalled over only the families
     * actually in debt — a family in credit must not quietly cancel out another's arrears and
     * make the school's exposure look smaller than it is.
     */
    let outstanding = 0;
    if (term && auth.permissions?.includes('fees.view')) {
      const earlier = await this.db.term.findMany({
        where: { academicYear: { schoolId: auth.schoolId }, startDate: { lte: term.startDate } },
        select: { id: true },
      });
      const entries = await this.db.ledgerEntry.findMany({
        where: {
          schoolId: auth.schoolId,
          OR: [{ termId: { in: earlier.map((t) => t.id) } }, { termId: null }],
        },
        select: { id: true, studentId: true, type: true, amount: true, reversedId: true },
      });
      const byStudent = new Map<string, typeof entries>();
      for (const e of entries) {
        byStudent.set(e.studentId, [...(byStudent.get(e.studentId) ?? []), e]);
      }
      for (const rows of byStudent.values()) {
        const bal = balanceOf(rows);
        if (bal > 0.005) outstanding += bal;
      }
      outstanding = Math.round(outstanding * 100) / 100;
    }

    // attendance for the most recent marked day
    const lastMarked = await this.db.attendanceRecord.findFirst({
      where: { schoolId: auth.schoolId },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    let attendance: { date: Date; present: number; total: number } | null = null;
    if (lastMarked) {
      const grouped = await this.db.attendanceRecord.groupBy({
        by: ['status'],
        where: { schoolId: auth.schoolId, date: lastMarked.date },
        _count: true,
      });
      const total = grouped.reduce((a, g) => a + g._count, 0);
      const present = grouped
        .filter((g) => g.status === 'PRESENT' || g.status === 'LATE')
        .reduce((a, g) => a + g._count, 0);
      attendance = { date: lastMarked.date, present, total };
    }

    const money = (n: number) => Math.round(n * 100) / 100;
    const inv = money(Number(invoiced?._sum.amount ?? 0));
    const col = money(Number(collected?._sum.amount ?? 0));
    return {
      term: term
        ? {
            id: term.id,
            name: term.name,
            year: term.academicYear.name,
            endDate: term.endDate,
          }
        : null,
      studentCount,
      staffCount,
      classCount,
      /**
       * Gate the figures, not the page.
       *
       * The dashboard is where every role lands, so it cannot require a money permission — but
       * the term's revenue and outstanding balance on it plainly can. It had no gate at all,
       * which showed the school's finances to every teacher, the librarian, the nurse, and the
       * IT administrator who holds no money permission precisely by design.
       */
      fees: auth.permissions?.includes('fees.view')
        ? {
            // Invoiced and collected are genuinely this term's activity, so they stay scoped.
            invoiced: inv,
            collected: col,
            /**
             * Outstanding is not.
             *
             * It was `invoiced(term) − collected(term)`, which reports a school with a perfect
             * term as owing nothing while forty families carry last term's arrears — and the
             * fees page, which does this correctly, showed a different number for the same
             * moment. Two screens, one word, two answers, and the wrong one was on the landing
             * page. What a family owes is cumulative; see FeesService.asOfTerm.
             */
            outstanding,
            /**
             * The rate compares like with like, so it uses the term figures rather than the
             * cumulative arrears — and it is capped, because collected folds in discounts and
             * waivers and could otherwise read as 118% collection.
             */
            rate: inv > 0 ? Math.min(1, col / inv) : 0,
          }
        : undefined,
      attendance,
      announcements,
    };
  }
}

@Controller('dashboard')
export class DashboardController {
  constructor(private svc: DashboardService) {}

  @Get()
  stats(@CurrentUser() user: AuthUser) {
    return this.svc.stats(user);
  }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
