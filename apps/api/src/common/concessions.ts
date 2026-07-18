/**
 * Working out what a family is let off.
 *
 * A concession rule is a policy. This module turns policy plus circumstance into an amount; the
 * caller appends that as a DISCOUNT ledger entry. Nothing here reads or writes money, and no
 * balance is ever derived from a rule — the ledger stays the only source of what is owed.
 *
 * Two kinds behave quite differently. A **scholarship** is awarded to a named child and applies
 * wherever that child is invoiced. A **sibling discount** belongs to a *family*, not a child: it
 * cannot be awarded in advance because it depends on who else is on the roll this term, so it is
 * recomputed every time invoices are raised.
 */

export type ConcessionKind = 'SCHOLARSHIP' | 'SIBLING';
export type ConcessionBasis = 'PERCENT' | 'AMOUNT';

export interface Rule {
  id: string;
  name: string;
  kind: ConcessionKind;
  basis: ConcessionBasis;
  value: number;
  /** SIBLING only: the child this starts from, eldest first. 2 = second child onward. */
  fromSibling?: number | null;
  levelId?: string | null;
  active: boolean;
  startsOn?: Date | null;
  endsOn?: Date | null;
}

export interface StudentContext {
  studentId: string;
  levelId: string | null;
  /** 1 = eldest on the roll in this family, 2 = next, and so on. */
  siblingRank: number;
  /** Rule ids this child has been personally awarded. */
  awardedRuleIds: string[];
}

export interface AppliedConcession {
  ruleId: string;
  name: string;
  amount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function withinWindow(rule: Rule, on: Date): boolean {
  if (rule.startsOn && on.getTime() < rule.startsOn.getTime()) return false;
  // Inclusive of the end date: a scholarship "until 31 December" covers that day.
  if (rule.endsOn && on.getTime() > endOfDay(rule.endsOn).getTime()) return false;
  return true;
}

function endOfDay(d: Date): Date {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
}

/** Does this rule reach this child at all? Says nothing about how much. */
export function ruleApplies(rule: Rule, ctx: StudentContext, on: Date): boolean {
  if (!rule.active) return false;
  if (!withinWindow(rule, on)) return false;
  if (rule.levelId && rule.levelId !== ctx.levelId) return false;

  if (rule.kind === 'SCHOLARSHIP') return ctx.awardedRuleIds.includes(rule.id);

  // Sibling: the eldest pays in full and the rule starts at the child the school nominated.
  const from = rule.fromSibling ?? 2;
  return ctx.siblingRank >= from;
}

/**
 * How much a single rule is worth against a bill.
 *
 * A percentage is of the *original* invoice, not of what is left after other concessions — a
 * school that grants "50% scholarship and 10% sibling" means 60% off, not 55%.
 */
export function amountFor(rule: Rule, invoiceTotal: number): number {
  if (invoiceTotal <= 0) return 0;
  const raw =
    rule.basis === 'PERCENT'
      ? (invoiceTotal * Math.max(0, Math.min(100, rule.value))) / 100
      : Math.max(0, rule.value);
  return round2(Math.min(raw, invoiceTotal));
}

/**
 * Every concession due on one bill.
 *
 * Rules stack, because a scholarship child with siblings genuinely qualifies for both — but the
 * total is capped at the invoice. A concession must never exceed the bill it discounts: that
 * would make the ledger owe the family money, and the fee ledger is not a way to pay anyone.
 *
 * Larger concessions are applied first so that when the cap bites it truncates the smallest,
 * which is the outcome a school would defend to a parent.
 */
export function concessionsFor(
  rules: Rule[],
  ctx: StudentContext,
  invoiceTotal: number,
  on: Date = new Date(),
): { applied: AppliedConcession[]; total: number } {
  const candidates = rules
    .filter((r) => ruleApplies(r, ctx, on))
    .map((r) => ({ ruleId: r.id, name: r.name, amount: amountFor(r, invoiceTotal) }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.ruleId.localeCompare(b.ruleId));

  const applied: AppliedConcession[] = [];
  let remaining = invoiceTotal;
  for (const c of candidates) {
    if (remaining <= 0) break;
    const amount = round2(Math.min(c.amount, remaining));
    if (amount <= 0) continue;
    applied.push({ ...c, amount });
    remaining = round2(remaining - amount);
  }

  return { applied, total: round2(applied.reduce((a, c) => a + c.amount, 0)) };
}

export interface FamilyMember {
  studentId: string;
  /** Earliest first. Ties broken by admission number so the order is stable across runs. */
  enrolledOn: Date;
  admissionNo: string;
}

/**
 * Rank the children of one family, eldest enrolment first.
 *
 * Ordering by enrolment date rather than age: it is stable, it is what the school actually
 * recorded, and it means adding a new younger sibling never re-ranks the children already being
 * billed — which would otherwise move the discount from one child to another mid-year.
 */
export function rankSiblings(family: FamilyMember[]): Map<string, number> {
  const ordered = [...family].sort(
    (a, b) =>
      a.enrolledOn.getTime() - b.enrolledOn.getTime() || a.admissionNo.localeCompare(b.admissionNo),
  );
  return new Map(ordered.map((m, i) => [m.studentId, i + 1]));
}
