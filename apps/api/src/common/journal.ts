/**
 * The double-entry projection of the fee ledger (FEATURES.md §7).
 *
 * LedgerEntry stays the single source of truth — append-only, single-column. What an accountant
 * wants is the same facts as journal lines: every entry becomes one balanced debit/credit pair
 * over a tiny chart of accounts. A projection, not a second ledger: nothing here is stored, so
 * nothing here can drift.
 */

export interface JournalSource {
  id: string;
  type: string;
  amount: unknown;
  method?: string | null;
  reference: string;
  reversedId?: string | null;
  createdAt: Date;
  studentName: string;
}

export interface JournalLine {
  date: Date;
  reference: string;
  description: string;
  account: string;
  debit: number | null;
  credit: number | null;
}

const RECEIVABLE = 'Fees Receivable';
const INCOME = 'Fees Income';
const DISCOUNTS = 'Discounts & Waivers Granted';

function cashAccount(method?: string | null): string {
  switch (method) {
    case 'MOMO':
      return 'Mobile Money';
    case 'BANK':
      return 'Bank';
    case 'CARD':
      return 'Bank';
    default:
      return 'Cash';
  }
}

/** The balanced pair for one entry: [debit account, credit account]. */
function pairFor(entry: JournalSource, byId: Map<string, JournalSource>): [string, string] | null {
  switch (entry.type) {
    case 'INVOICE':
      return [RECEIVABLE, INCOME];
    case 'PAYMENT':
      return [cashAccount(entry.method), RECEIVABLE];
    case 'DISCOUNT':
    case 'WAIVER':
      return [DISCOUNTS, RECEIVABLE];
    case 'REVERSAL': {
      // A reversal is the mirror image of what it cancels.
      const target = entry.reversedId ? byId.get(entry.reversedId) : undefined;
      if (!target) return null;
      const pair = pairFor(target, byId);
      return pair ? [pair[1], pair[0]] : null;
    }
    default:
      return null;
  }
}

export function journalLines(entries: readonly JournalSource[]): JournalLine[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const lines: JournalLine[] = [];
  for (const e of entries) {
    const amount = Number(e.amount);
    if (!Number.isFinite(amount)) continue;
    const pair = pairFor(e, byId);
    if (!pair) continue;
    const [debitAccount, creditAccount] = pair;
    const description = `${e.type} — ${e.studentName}`;
    lines.push({
      date: e.createdAt,
      reference: e.reference,
      description,
      account: debitAccount,
      debit: amount,
      credit: null,
    });
    lines.push({
      date: e.createdAt,
      reference: e.reference,
      description,
      account: creditAccount,
      debit: null,
      credit: amount,
    });
  }
  return lines;
}

/** Debits must equal credits, always — the invariant the export is checked against. */
export function journalTotals(lines: readonly JournalLine[]): { debits: number; credits: number } {
  return {
    debits: Math.round(lines.reduce((s, l) => s + (l.debit ?? 0), 0) * 100) / 100,
    credits: Math.round(lines.reduce((s, l) => s + (l.credit ?? 0), 0) * 100) / 100,
  };
}
