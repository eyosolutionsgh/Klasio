/**
 * The statement of account: every ledger entry in order with a running balance.
 *
 * Nothing is hidden — a reversed charge and its reversal BOTH appear, because the statement's
 * job is to let a parent see exactly what happened. The running balance therefore applies a
 * reversal's effect at the reversal's own date (the negation of what it cancelled), so the final
 * figure always equals `balanceOf` over the same entries.
 */
import { balanceOf } from './ledger';

export interface StatementEntry {
  id: string;
  type: string;
  amount: unknown;
  reversedId?: string | null;
  method?: string | null;
  reference: string;
  receiptNumber?: string | null;
  createdAt: Date;
}

export interface StatementLine {
  date: Date;
  label: string;
  reference: string;
  debit: number | null;
  credit: number | null;
  balance: number;
}

const METHOD_LABEL: Record<string, string> = {
  MOMO: 'mobile money',
  CASH: 'cash',
  BANK: 'bank',
  CARD: 'card',
};

function labelOf(e: StatementEntry): string {
  if (e.type === 'INVOICE') return 'School bill';
  if (e.type === 'PAYMENT') {
    const m = e.method ? (METHOD_LABEL[e.method] ?? e.method.toLowerCase()) : null;
    return `Payment${m ? ` (${m})` : ''}${e.receiptNumber ? ` · ${e.receiptNumber}` : ''}`;
  }
  if (e.type === 'DISCOUNT') return 'Discount';
  if (e.type === 'WAIVER') return 'Waiver';
  if (e.type === 'REVERSAL') return 'Correction — earlier entry cancelled';
  return e.type;
}

/** Signed contribution of a non-reversal entry: positive increases what is owed. */
function signedAmount(e: StatementEntry): number {
  const amt = Number(e.amount);
  if (!Number.isFinite(amt)) return 0;
  return e.type === 'INVOICE' ? amt : -amt;
}

export function statementLines(entries: readonly StatementEntry[]): {
  lines: StatementLine[];
  totals: { billed: number; credited: number; balance: number };
} {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const ordered = [...entries].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );

  let running = 0;
  let billed = 0;
  let credited = 0;
  const lines: StatementLine[] = [];

  for (const e of ordered) {
    let delta: number;
    if (e.type === 'REVERSAL') {
      const target = e.reversedId ? byId.get(e.reversedId) : undefined;
      delta = target ? -signedAmount(target) : 0;
    } else {
      delta = signedAmount(e);
    }
    running = Math.round((running + delta) * 100) / 100;
    if (delta > 0) billed += delta;
    else credited += -delta;
    lines.push({
      date: e.createdAt,
      label: labelOf(e),
      reference: e.reference,
      debit: delta > 0 ? delta : null,
      credit: delta < 0 ? -delta : delta === 0 ? 0 : null,
      balance: running,
    });
  }

  return {
    lines,
    totals: {
      billed: Math.round(billed * 100) / 100,
      credited: Math.round(credited * 100) / 100,
      // Derived the canonical way, and asserted equal to the running figure in tests.
      balance: balanceOf(entries),
    },
  };
}
