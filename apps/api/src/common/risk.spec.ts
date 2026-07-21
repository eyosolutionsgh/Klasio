import { describe, expect, it } from 'vitest';
import { childRisk, feeRisk } from './risk';

describe('feeRisk', () => {
  it('a settled account carries no risk at all', () => {
    expect(
      feeRisk({ balance: 0, billedThisTerm: 900, daysSinceLastPayment: 3, remindersThisTerm: 0 }),
    ).toEqual({
      score: 0,
      level: 'LOW',
      reasons: [],
    });
  });

  it('a full term owed, silent for two months, repeatedly reminded → HIGH with reasons', () => {
    const r = feeRisk({
      balance: 950,
      billedThisTerm: 900,
      daysSinceLastPayment: 70,
      remindersThisTerm: 3,
    });
    expect(r.level).toBe('HIGH');
    expect(r.reasons.join(' ')).toContain('full term');
    expect(r.reasons.join(' ')).toContain('no payment');
    expect(r.reasons.join(' ')).toContain('reminders');
  });

  it('a small fresh balance is LOW', () => {
    const r = feeRisk({
      balance: 100,
      billedThisTerm: 900,
      daysSinceLastPayment: 5,
      remindersThisTerm: 0,
    });
    expect(r.level).toBe('LOW');
  });
});

describe('childRisk', () => {
  it('flags poor attendance only once enough days are marked', () => {
    expect(childRisk({ attendanceRate: 60, markedDays: 5, lastTwoTotals: [] }).flagged).toBe(false);
    const r = childRisk({ attendanceRate: 60, markedDays: 20, lastTwoTotals: [] });
    expect(r.flagged).toBe(true);
    expect(r.reasons[0]).toContain('60%');
  });

  it('flags a falling overall total across the last two reports', () => {
    const r = childRisk({ attendanceRate: 95, markedDays: 30, lastTwoTotals: [72, 58] });
    expect(r.flagged).toBe(true);
    expect(r.reasons[0]).toContain('fell 14');
  });

  it('a steady child is not flagged', () => {
    expect(childRisk({ attendanceRate: 93, markedDays: 30, lastTwoTotals: [70, 71] }).flagged).toBe(
      false,
    );
  });
});
