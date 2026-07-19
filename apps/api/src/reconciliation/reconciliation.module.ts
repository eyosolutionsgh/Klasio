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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsEnum, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { GatewayProvider, Prisma, SettlementStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequireEntitlement, RequirePermission } from '../common/auth';
import { parseSettlementCsv, reconcile } from '../common/reconcile';
import { PageQuery, dateWindow, orderBy, pageArgs, toPage } from '../common/list-query';

/** Minimal shape of a Multer upload — avoids depending on @types/multer, as elsewhere. */
interface UploadedCsv {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

/**
 * Sortable columns on the exception queue.
 *
 * `student` and `weCharged` are absent on purpose: both come off the PaymentIntent, which is
 * fetched separately after the rows are chosen precisely because an unmatched row has no intent
 * at all. Ordering by them would mean ordering by a value half the queue does not have.
 */
const SETTLEMENT_ROW_SORTS: Record<string, string | string[]> = {
  reference: 'reference',
  gross: 'gross',
  net: 'net',
  status: 'status',
  createdAt: 'createdAt',
};

/** Sortable columns on the list of imported files. */
const BATCH_SORTS: Record<string, string | string[]> = {
  filename: 'filename',
  provider: 'provider',
  grossTotal: 'grossTotal',
  netTotal: 'netTotal',
  rowCount: 'rowCount',
  matchedCount: 'matchedCount',
  createdAt: 'createdAt',
};

/** Filters for the exception queue. `from`/`to` window the import date — see `exceptions`. */
class ListExceptionsDto extends PageQuery {
  @IsOptional() @IsString() batchId?: string;
  @IsOptional() @IsEnum(SettlementStatus) status?: SettlementStatus;
}

/** Filters for the imported-file list. `from`/`to` window when the file was imported. */
class ListBatchesDto extends PageQuery {
  @IsOptional() @IsEnum(GatewayProvider) provider?: GatewayProvider;
}

class ResolveRowDto {
  @IsIn(['MATCHED', 'DISPUTED', 'IGNORED']) status: 'MATCHED' | 'DISPUTED' | 'IGNORED';
  /** Why — a bursar closing an exception must say what they concluded. */
  @IsString() @MinLength(4) note: string;
  @IsOptional() @IsString() intentId?: string;
}

@Injectable()
export class ReconciliationService {
  constructor(private db: PrismaService) {}

  /**
   * Import a settlement file and match it against payments we already hold.
   *
   * Importing changes no money. Reconciliation is an assertion about payments that have already
   * settled through the webhook path — it must never become a second way for cash to enter the
   * ledger, or a doctored CSV would be a way to forge receipts.
   */
  async importFile(auth: AuthUser, provider: GatewayProvider, file: UploadedCsv) {
    if (!file) throw new BadRequestException('Attach a settlement file');
    const lines = parseSettlementCsv(file.buffer.toString('utf8'));
    if (lines.length === 0) {
      throw new BadRequestException(
        'No rows found. The file needs a reference column and an amount column.',
      );
    }

    // Only successful intents are candidates: a pending or failed one has no money behind it.
    const intents = await this.db.paymentIntent.findMany({
      where: { schoolId: auth.schoolId, status: 'SUCCESS' },
      select: { id: true, reference: true, amount: true },
    });

    const { results, summary } = reconcile(
      lines,
      intents.map((i) => ({ id: i.id, reference: i.reference, amount: Number(i.amount) })),
    );

    const batch = await this.db.settlementBatch.create({
      data: {
        schoolId: auth.schoolId,
        provider,
        filename: file.originalname ?? 'settlement.csv',
        grossTotal: new Prisma.Decimal(summary.grossTotal),
        netTotal: new Prisma.Decimal(summary.netTotal),
        rowCount: lines.length,
        matchedCount: summary.matched,
        uploadedById: auth.sub,
        rows: {
          create: lines.map((l, i) => ({
            schoolId: auth.schoolId,
            reference: l.reference.trim(),
            gross: new Prisma.Decimal(l.gross),
            net: new Prisma.Decimal(l.net),
            status: results[i].status,
            intentId: results[i].intentId ?? null,
            note: results[i].note ?? null,
            resolvedAt: results[i].status === 'MATCHED' ? new Date() : null,
          })),
        },
      },
    });

    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'fees.settlement-import',
      'SettlementBatch',
      batch.id,
      {
        rows: lines.length,
        matched: summary.matched,
        unmatched: summary.unmatched,
        disputed: summary.disputed,
      },
    );

    return { batchId: batch.id, ...summary };
  }

  /**
   * Everything imported, paged.
   *
   * The gateway-charges figure on the screen is deliberately *not* derived from these rows — see
   * `summary()`. Summing the page would have quietly reported the charges from the fifty most
   * recent files as the charges from all of them.
   */
  async batches(auth: AuthUser, q: ListBatchesDto) {
    const { skip, take, page, perPage } = pageArgs(q);
    const imported = dateWindow(q);
    const where = {
      schoolId: auth.schoolId,
      ...(q.provider ? { provider: q.provider } : {}),
      // The window filters when the file was imported, which is the only date a batch carries.
      ...(imported ? { createdAt: imported } : {}),
    };

    const [total, batches] = await Promise.all([
      this.db.settlementBatch.count({ where }),
      this.db.settlementBatch.findMany({
        where,
        orderBy: orderBy<Prisma.SettlementBatchOrderByWithRelationInput>(q, BATCH_SORTS, {
          createdAt: 'desc',
        }),
        skip,
        take,
      }),
    ]);

    const rows = batches.map((b) => ({
      id: b.id,
      provider: b.provider,
      filename: b.filename,
      grossTotal: Number(b.grossTotal),
      netTotal: Number(b.netTotal),
      /** What the gateway kept across the whole file — the number a school rarely sees. */
      charges: Number(b.grossTotal) - Number(b.netTotal),
      rowCount: b.rowCount,
      matchedCount: b.matchedCount,
      createdAt: b.createdAt,
    }));
    return toPage(rows, total, { page, perPage });
  }

  /**
   * The four figures that head the reconciliation screen.
   *
   * Its own endpoint because none of them may be derived from a page. The queue counts and the
   * gateway's total take are statements about everything on file, and the page they happen to be
   * rendered beside is not allowed to change them — a bursar reading "2 not recognised" off a
   * paged table would close the screen believing the exceptions were dealt with.
   */
  async summary(auth: AuthUser) {
    const [byStatus, totals] = await Promise.all([
      this.db.settlementRow.groupBy({
        by: ['status'],
        where: { schoolId: auth.schoolId },
        _count: true,
      }),
      this.db.settlementBatch.aggregate({
        where: { schoolId: auth.schoolId },
        _sum: { grossTotal: true, netTotal: true },
        _count: true,
      }),
    ]);
    const countOf = (s: SettlementStatus) => byStatus.find((r) => r.status === s)?._count ?? 0;
    const gross = Number(totals._sum.grossTotal ?? 0);
    const net = Number(totals._sum.netTotal ?? 0);
    return {
      unmatched: countOf('UNMATCHED'),
      disputed: countOf('DISPUTED'),
      /** What the gateway kept across every file ever imported. */
      charges: Math.round((gross - net) * 100) / 100,
      batchCount: totals._count,
    };
  }

  /**
   * The exception queue: everything a human still has to look at.
   *
   * Defaults to the open items rather than the whole file, because the matched rows are the
   * ones nobody needs to read.
   */
  async exceptions(auth: AuthUser, q: ListExceptionsDto) {
    const { skip, take, page, perPage } = pageArgs(q);
    // The window filters when the row was imported. A settlement row's own `paidAt` is optional —
    // plenty of provider files omit it — so filtering on it would hide rows for lacking a column
    // the school never supplied.
    const imported = dateWindow(q);
    const where = {
      schoolId: auth.schoolId,
      ...(q.batchId ? { batchId: q.batchId } : {}),
      ...(imported ? { createdAt: imported } : {}),
      status: q.status ? q.status : { in: ['UNMATCHED', 'DISPUTED'] as SettlementStatus[] },
    };

    const [total, rows] = await Promise.all([
      this.db.settlementRow.count({ where }),
      this.db.settlementRow.findMany({
        where,
        orderBy: orderBy<Prisma.SettlementRowOrderByWithRelationInput>(q, SETTLEMENT_ROW_SORTS, {
          createdAt: 'desc',
        }),
        skip,
        take,
      }),
    ]);

    const intentIds = rows.map((r) => r.intentId).filter((x): x is string => !!x);
    const intents = intentIds.length
      ? await this.db.paymentIntent.findMany({
          where: { id: { in: intentIds }, schoolId: auth.schoolId },
          select: {
            id: true,
            amount: true,
            student: { select: { firstName: true, lastName: true, admissionNo: true } },
          },
        })
      : [];
    const byId = new Map(intents.map((i) => [i.id, i]));

    const mapped = rows.map((r) => {
      const intent = r.intentId ? byId.get(r.intentId) : undefined;
      return {
        id: r.id,
        reference: r.reference,
        gross: Number(r.gross),
        net: Number(r.net),
        status: r.status,
        note: r.note,
        student: intent?.student
          ? `${intent.student.firstName} ${intent.student.lastName} (${intent.student.admissionNo})`
          : null,
        weCharged: intent ? Number(intent.amount) : null,
        createdAt: r.createdAt,
      };
    });
    return toPage(mapped, total, { page, perPage });
  }

  /** Close an exception. The note is mandatory — "resolved" with no reason helps nobody later. */
  async resolve(auth: AuthUser, rowId: string, dto: ResolveRowDto) {
    const row = await this.db.settlementRow.findFirst({
      where: { id: rowId, schoolId: auth.schoolId },
    });
    if (!row) throw new NotFoundException('That settlement row is not on file');

    const updated = await this.db.settlementRow.update({
      where: { id: rowId },
      data: {
        status: dto.status,
        note: dto.note,
        intentId: dto.intentId ?? row.intentId,
        resolvedAt: new Date(),
      },
    });
    await this.db.audit(
      auth.schoolId,
      auth.sub,
      'fees.settlement-resolve',
      'SettlementRow',
      rowId,
      {
        from: row.status,
        to: dto.status,
        note: dto.note,
      },
    );
    return { id: updated.id, status: updated.status };
  }
}

@Controller('reconciliation')
@RequirePermission('fees.reconcile')
@RequireEntitlement('fees.reconciliation')
export class ReconciliationController {
  constructor(private svc: ReconciliationService) {}

  @Post('import/:provider')
  @UseInterceptors(FileInterceptor('file'))
  importFile(
    @CurrentUser() user: AuthUser,
    @Param('provider') provider: GatewayProvider,
    @UploadedFile() file: UploadedCsv,
  ) {
    return this.svc.importFile(user, provider, file);
  }

  @Get('batches')
  batches(@CurrentUser() user: AuthUser, @Query() query: ListBatchesDto) {
    return this.svc.batches(user, query);
  }

  /** The four headline figures, over everything on file rather than over a page. */
  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.svc.summary(user);
  }

  @Get('exceptions')
  exceptions(@CurrentUser() user: AuthUser, @Query() query: ListExceptionsDto) {
    return this.svc.exceptions(user, query);
  }

  @Patch('rows/:id')
  resolve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ResolveRowDto) {
    return this.svc.resolve(user, id, dto);
  }
}

@Module({
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
})
export class ReconciliationModule {}
