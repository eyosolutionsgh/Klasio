/**
 * Risk flags (FEATURES.md §21): which families are likely to fall behind on fees, and which
 * children the attendance-and-results pattern says to look at. Deterministic and explainable —
 * a school acts on "no payment in 9 weeks", not on an unexplained score. Every flag suggests;
 * a person decides.
 */

export interface FeeRiskInput {
  /** What the family owes now (major units). */
  balance: number;
  /** Everything billed this term, for proportion. */
  billedThisTerm: number;
  daysSinceLastPayment: number | null;
  remindersThisTerm: number;
}

export interface FeeRisk {
  score: number;
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  reasons: string[];
}

export function feeRisk(input: FeeRiskInput): FeeRisk {
  const reasons: string[] = [];
  let score = 0;

  if (input.balance <= 0) return { score: 0, level: 'LOW', reasons: [] };

  const ratio = input.billedThisTerm > 0 ? input.balance / input.billedThisTerm : 1;
  if (ratio >= 1) {
    score += 40;
    reasons.push('owes at least a full term');
  } else if (ratio >= 0.5) {
    score += 25;
    reasons.push('owes more than half a term');
  } else {
    score += 10;
  }

  if (input.daysSinceLastPayment === null) {
    score += 35;
    reasons.push('no payment on record at all');
  } else if (input.daysSinceLastPayment > 60) {
    score += 30;
    reasons.push(`no payment in ${Math.floor(input.daysSinceLastPayment / 7)} weeks`);
  } else if (input.daysSinceLastPayment > 30) {
    score += 15;
    reasons.push('no payment in over a month');
  }

  if (input.remindersThisTerm >= 3) {
    score += 20;
    reasons.push(`${input.remindersThisTerm} reminders sent without settlement`);
  } else if (input.remindersThisTerm >= 1) {
    score += 10;
  }

  score = Math.min(100, score);
  return { score, level: score >= 60 ? 'HIGH' : score >= 35 ? 'MEDIUM' : 'LOW', reasons };
}

export interface ChildRiskInput {
  /** Present+late over marked days this term, 0–100; null when nothing is marked. */
  attendanceRate: number | null;
  markedDays: number;
  /** Overall totals of the last two term reports, oldest first, where they exist. */
  lastTwoTotals: number[];
}

export interface ChildRisk {
  flagged: boolean;
  reasons: string[];
}

export function childRisk(input: ChildRiskInput): ChildRisk {
  const reasons: string[] = [];
  if (input.attendanceRate !== null && input.markedDays >= 10 && input.attendanceRate < 80) {
    reasons.push(`attendance at ${Math.round(input.attendanceRate)}% this term`);
  }
  if (input.lastTwoTotals.length === 2) {
    const [prev, latest] = input.lastTwoTotals;
    if (prev - latest >= 10) {
      reasons.push(`overall total fell ${Math.round(prev - latest)} points since last term`);
    }
  }
  return { flagged: reasons.length > 0, reasons };
}
