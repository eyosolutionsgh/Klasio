/**
 * What a family owes, derived from the ledger.
 *
 * The ledger is append-only, so a mistake is corrected by appending a REVERSAL that points at the
 * entry it cancels (`reversedId`). That makes the balance a two-step calculation, and it was the
 * second step that was missing everywhere:
 *
 *   1. a REVERSAL contributes nothing itself, and
 *   2. **the entry it points at stops contributing too.**
 *
 * Six readers each carried their own copy of step 1 and none of them had step 2, so a reversal was
 * a no-op: the double-charged invoice it was appended to cancel stayed in the balance, the family
 * stayed on the defaulters list, and the reminder SMS kept going out. One of those copies even
 * carried a comment asserting that "paired entries net out via referenced amounts" — netting no
 * code performed. It lives here now, once, with tests.
 *
 * Amounts are stored positive; `type` carries the direction. INVOICE increases what is owed,
 * PAYMENT/DISCOUNT/WAIVER decrease it.
 */

export interface BalanceEntry {
  id: string;
  type: string;
  amount: unknown;
  reversedId?: string | null;
}

/** Ids that have been reversed, and so no longer count. */
export function reversedIds(entries: readonly BalanceEntry[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    if (e.type === 'REVERSAL' && e.reversedId) out.add(e.reversedId);
  }
  return out;
}

/**
 * Sum entries into a balance owed.
 *
 * Rounded to the pesewa at the end rather than per entry, so a long ledger cannot drift.
 */
export function balanceOf(entries: readonly BalanceEntry[]): number {
  const reversed = reversedIds(entries);
  let bal = 0;
  for (const e of entries) {
    // A reversal cancels rather than contributes, and what it cancelled is spent.
    if (e.type === 'REVERSAL' || reversed.has(e.id)) continue;
    const amt = Number(e.amount);
    if (!Number.isFinite(amt)) continue;
    bal += e.type === 'INVOICE' ? amt : -amt;
  }
  return Math.round(bal * 100) / 100;
}

/** Does this entry still count toward the balance? Used where rows are listed, not just summed. */
export function isLive(entry: BalanceEntry, reversed: Set<string>): boolean {
  return entry.type !== 'REVERSAL' && !reversed.has(entry.id);
}
