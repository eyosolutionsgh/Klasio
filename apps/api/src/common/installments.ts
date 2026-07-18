/**
 * Marking a payment plan against what has actually been paid.
 *
 * The subtle part, and the one that was wrong first time: a plan is measured against the
 * **outstanding balance**, not against every payment the family has ever made. A child who has
 * already paid GHS 900 of a GHS 1,390 bill and then agrees a plan for the remaining GHS 490 has
 * paid *nothing* toward that plan. Counting the earlier 900 marked every instalment settled the
 * instant it was agreed.
 *
 * So: progress against a plan is `planTotal − outstanding`. Nothing here reads or writes money —
 * the ledger remains the only source of the balance (see fees.module.ts).
 */

export interface SchedulePart {
  id: string;
  sequence: number;
  amount: number;
  dueDate: Date;
  note?: string | null;
}

export type PartStatus = 'PAID' | 'DUE' | 'OVERDUE';

export interface MarkedPart extends SchedulePart {
  paid: number;
  outstanding: number;
  status: PartStatus;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * @param parts     the agreed schedule, earliest first
 * @param owed      what the student still owes overall, from the ledger
 * @param today     start of the current day, for the overdue comparison
 */
export function markSchedule(parts: SchedulePart[], owed: number, today: Date): MarkedPart[] {
  const planTotal = parts.reduce((a, p) => a + p.amount, 0);

  // Clamped both ways: a family can pay ahead (progress beyond the plan is still just "paid"),
  // and a bill can grow after the plan was agreed, which must not read as negative progress.
  let credit = Math.max(0, Math.min(planTotal, round2(planTotal - owed)));

  return parts.map((p) => {
    const covered = Math.min(credit, p.amount);
    credit = round2(credit - covered);
    const outstanding = round2(p.amount - covered);
    const settled = Math.round(outstanding * 100) <= 0;
    return {
      ...p,
      paid: round2(covered),
      outstanding,
      status: settled ? 'PAID' : p.dueDate < today ? 'OVERDUE' : 'DUE',
    };
  });
}

export function scheduleTotals(marked: MarkedPart[]) {
  return {
    scheduledTotal: round2(marked.reduce((a, p) => a + p.amount, 0)),
    paidTotal: round2(marked.reduce((a, p) => a + p.paid, 0)),
    overdue: marked.filter((p) => p.status === 'OVERDUE').length,
  };
}
