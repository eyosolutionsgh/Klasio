/**
 * Matching a gateway's settlement file against what we think we were paid.
 *
 * A payment has two sides that rarely agree exactly. We record what a parent was charged
 * (gross); the gateway later remits that minus its own fee (net). Reconciliation is the act of
 * proving every remitted line corresponds to a payment we already know about, and flagging the
 * ones that do not — money arriving for a payment we never saw, or a payment we recorded that
 * never arrived.
 *
 * The rules live here, away from the database, because they are the part worth testing: a wrong
 * tolerance quietly writes off real shortfalls.
 */

export interface SettlementLine {
  reference: string;
  /** What the gateway says the parent was charged. */
  gross: number;
  /** What the gateway actually remitted for this line. */
  net: number;
}

export interface KnownIntent {
  reference: string;
  /** What we charged, from our own PaymentIntent. */
  amount: number;
  id: string;
}

export type MatchStatus = 'MATCHED' | 'UNMATCHED' | 'DISPUTED';

export interface MatchResult {
  status: MatchStatus;
  intentId?: string;
  /** gross − net: what the gateway kept. Only meaningful once matched. */
  charge?: number;
  /** A human sentence, never a code — a bursar reads this in an exception queue. */
  note?: string;
}

/**
 * Money compared in the smallest unit.
 *
 * Settlement files carry decimals and floating point does not add them reliably: 0.1 + 0.2 is
 * famously not 0.3, and a cedi-scale rounding error repeated across a term is a real
 * discrepancy. Comparing integer pesewas sidesteps it entirely.
 */
const pesewas = (n: number) => Math.round(n * 100);

/**
 * Default tolerance on the gross comparison, in the currency's minor unit.
 *
 * This is NOT a tolerance on missing money. It exists because gateways round their own fee
 * arithmetic differently from us, so a legitimately identical payment can differ by a pesewa or
 * two. Anything larger is a real disagreement and must reach a human.
 */
export const DEFAULT_TOLERANCE_MINOR = 2;

export function matchLine(
  line: SettlementLine,
  byReference: Map<string, KnownIntent>,
  toleranceMinor: number = DEFAULT_TOLERANCE_MINOR,
): MatchResult {
  const intent = byReference.get(line.reference.trim());
  if (!intent) {
    return {
      status: 'UNMATCHED',
      note: `No payment on file with reference ${line.reference}`,
    };
  }

  const diff = pesewas(line.gross) - pesewas(intent.amount);
  if (Math.abs(diff) > toleranceMinor) {
    return {
      status: 'DISPUTED',
      intentId: intent.id,
      charge: round2(line.gross - line.net),
      note:
        diff > 0
          ? `Gateway reports ${line.gross.toFixed(2)} but we charged ${intent.amount.toFixed(2)} — ${(diff / 100).toFixed(2)} more than expected`
          : `Gateway reports ${line.gross.toFixed(2)} but we charged ${intent.amount.toFixed(2)} — ${(-diff / 100).toFixed(2)} short`,
    };
  }

  // Net above gross means the file is malformed or the columns are swapped. Treat it as a
  // dispute rather than inventing a negative fee.
  if (pesewas(line.net) > pesewas(line.gross) + toleranceMinor) {
    return {
      status: 'DISPUTED',
      intentId: intent.id,
      charge: round2(line.gross - line.net),
      note: `Remitted ${line.net.toFixed(2)} is more than the ${line.gross.toFixed(2)} charged — check the file`,
    };
  }

  return {
    status: 'MATCHED',
    intentId: intent.id,
    charge: round2(line.gross - line.net),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ReconcileSummary {
  matched: number;
  unmatched: number;
  disputed: number;
  grossTotal: number;
  netTotal: number;
  /** Total the gateway kept across matched lines. */
  chargesTotal: number;
  /** Payments we hold that this file says nothing about — the other half of the picture. */
  missingReferences: string[];
}

/**
 * Reconcile a whole file.
 *
 * `expected` is every payment we believe settled in the period. Anything in it that the file
 * does not mention is reported too: a file that simply omits a payment looks identical to a
 * clean run if you only ever check the rows you were given.
 */
export function reconcile(
  lines: SettlementLine[],
  expected: KnownIntent[],
  toleranceMinor: number = DEFAULT_TOLERANCE_MINOR,
): { results: MatchResult[]; summary: ReconcileSummary } {
  const byReference = new Map(expected.map((i) => [i.reference, i]));
  const results = lines.map((l) => matchLine(l, byReference, toleranceMinor));

  const seen = new Set(
    results.map((r, i) => (r.status !== 'UNMATCHED' ? lines[i].reference.trim() : '')),
  );

  return {
    results,
    summary: {
      matched: results.filter((r) => r.status === 'MATCHED').length,
      unmatched: results.filter((r) => r.status === 'UNMATCHED').length,
      disputed: results.filter((r) => r.status === 'DISPUTED').length,
      grossTotal: round2(lines.reduce((a, l) => a + l.gross, 0)),
      netTotal: round2(lines.reduce((a, l) => a + l.net, 0)),
      chargesTotal: round2(
        results.reduce((a, r) => (r.status === 'MATCHED' ? a + (r.charge ?? 0) : a), 0),
      ),
      missingReferences: expected.filter((i) => !seen.has(i.reference)).map((i) => i.reference),
    },
  };
}

/**
 * Parse a settlement CSV.
 *
 * Every gateway ships a different shape, so columns are found by header name rather than
 * position — Hubtel and Paystack disagree on order, and a positional parser silently reads the
 * wrong column when they change it.
 */
export function parseSettlementCsv(text: string): SettlementLine[] {
  const rows = text
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean);
  if (rows.length < 2) return [];

  const header = splitCsvRow(rows[0]).map((h) => h.trim().toLowerCase());

  /**
   * Exact header matches win over partial ones, and a column already claimed is never reused.
   *
   * Both rules exist because of one real file: a Hubtel export whose first column is
   * "Settlement Amount" and whose last is "Amount". A plain substring search for "amount" finds
   * the settlement column and silently reads net as gross, so every line reconciles as short.
   */
  const find = (names: string[], taken: number[] = []) => {
    const free = (i: number) => i >= 0 && !taken.includes(i);
    const exact = header.findIndex((h, i) => free(i) && names.includes(h));
    if (exact >= 0) return exact;
    const partial = header.findIndex((h, i) => free(i) && names.some((n) => h.includes(n)));
    return partial;
  };

  const iRef = find(['reference', 'transaction reference', 'transaction id', 'trans id']);
  // Net is resolved first precisely because its header often contains the word "amount".
  const iNet = find(['settlement amount', 'settlement', 'net', 'net amount', 'payout'], [iRef]);
  const iGross = find(['amount', 'gross', 'gross amount'], [iRef, iNet]);

  if (iRef < 0 || iGross < 0) return [];

  return rows.slice(1).flatMap((row) => {
    const cells = splitCsvRow(row);
    const reference = (cells[iRef] ?? '').trim();
    if (!reference) return [];
    const gross = money(cells[iGross]);
    // A file without a net column means the gateway remits gross and bills separately.
    const net = iNet >= 0 ? money(cells[iNet]) : gross;
    return [{ reference, gross, net }];
  });
}

/** Strips currency symbols, thousands separators and stray spaces. */
function money(cell: string | undefined): number {
  const n = Number((cell ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Minimal CSV row splitter that respects double-quoted cells containing commas. */
function splitCsvRow(row: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === '"') {
      if (quoted && row[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}
