import { PrismaService } from '../prisma/prisma.service';

/**
 * The next number in a school's own run of receipts, payments or invoices.
 *
 * Every one of these used to be `count(rows) + 1`. That reads like a counter and behaves like one
 * right up to the moment two people take money at once — then both reads return 50, both write
 * `RCP-2026-00051`, and the unique index rejects the second. Because a tenant request runs inside
 * a single Postgres transaction, that rejection discards the losing bursar's **ledger entry** too,
 * and the payment simply is not recorded.
 *
 * A real counter, incremented atomically, cannot hand the same number out twice. Numbers are
 * consumed rather than reserved: an abandoned request leaves a gap in the run, which is the right
 * trade — a gap is auditable, a duplicate receipt number is not.
 */
export type SequenceName = 'RECEIPT' | 'PAYMENT' | 'INVOICE';

/** How many documents of this kind a school already has, for schools that predate the counter. */
async function existingRun(db: PrismaService, schoolId: string, name: SequenceName) {
  if (name === 'RECEIPT') return db.receipt.count({ where: { schoolId } });
  if (name === 'INVOICE') return db.invoice.count({ where: { schoolId } });
  return db.ledgerEntry.count({ where: { schoolId, type: 'PAYMENT' } });
}

export async function nextInSequence(
  db: PrismaService,
  schoolId: string,
  name: SequenceName,
  count = 1,
): Promise<number> {
  // upsert + increment is one statement, so concurrent callers serialise on the row rather than
  // racing. The create half can still lose to a simultaneous first-ever call; that is what the
  // retry is for.
  for (let attempt = 0; ; attempt++) {
    try {
      // Schools created before this counter existed already have a run of numbers. Starting at 1
      // would reissue receipt numbers that are sitting in parents' hands, so the first call for a
      // school picks up where its existing documents left off.
      const start = 1 + (await existingRun(db, schoolId, name));
      const row = await db.numberSequence.upsert({
        where: { schoolId_name: { schoolId, name } },
        update: { next: { increment: count } },
        create: { schoolId, name, next: start + count },
        select: { next: true },
      });
      // `next` comes back already incremented, so the first number claimed is that many below.
      return row.next - count;
    } catch (e) {
      if (attempt >= 3) throw e;
    }
  }
}

/** Format a document reference: `RCP-2026-00051`. */
export function refNumber(prefix: string, seq: number, year = new Date().getFullYear()): string {
  return `${prefix}-${year}-${String(seq).padStart(5, '0')}`;
}
