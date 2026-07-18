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
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { GatewayProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, RequireEntitlement, Roles } from '../common/auth';
import { parseSettlementCsv, reconcile } from '../common/reconcile';

/** Minimal shape of a Multer upload — avoids depending on @types/multer, as elsewhere. */
interface UploadedCsv {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
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

  async batches(auth: AuthUser) {
    const rows = await this.db.settlementBatch.findMany({
      where: { schoolId: auth.schoolId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((b) => ({
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
  }

  /**
   * The exception queue: everything a human still has to look at.
   *
   * Defaults to the open items rather than the whole file, because the matched rows are the
   * ones nobody needs to read.
   */
  async exceptions(auth: AuthUser, batchId?: string, status?: string) {
    const rows = await this.db.settlementRow.findMany({
      where: {
        schoolId: auth.schoolId,
        ...(batchId ? { batchId } : {}),
        status: status
          ? (status as 'UNMATCHED' | 'MATCHED' | 'DISPUTED' | 'IGNORED')
          : { in: ['UNMATCHED', 'DISPUTED'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

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

    return rows.map((r) => {
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
@Roles('OWNER', 'HEAD', 'BURSAR')
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
  batches(@CurrentUser() user: AuthUser) {
    return this.svc.batches(user);
  }

  @Get('exceptions')
  exceptions(
    @CurrentUser() user: AuthUser,
    @Query('batchId') batchId?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.exceptions(user, batchId, status);
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
