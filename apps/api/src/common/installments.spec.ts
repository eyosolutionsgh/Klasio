import { describe, expect, it } from 'vitest';
import { markSchedule, scheduleTotals, type SchedulePart } from './installments';

const TODAY = new Date('2026-07-18T00:00:00Z');
const d = (iso: string) => new Date(iso);
const part = (sequence: number, amount: number, dueDate: string): SchedulePart => ({
  id: `p${sequence}`,
  sequence,
  amount,
  dueDate: d(dueDate),
});

const plan = [part(1, 200, '2026-08-01'), part(2, 276.05, '2026-09-01')];

describe('markSchedule', () => {
  it('shows nothing paid on a plan just agreed for the outstanding balance', () => {
    // The regression this module exists for. The family had already paid 913.95 of a 1390 bill;
    // counting that against a plan for the remaining 476.05 marked both parts settled at once.
    const marked = markSchedule(plan, 476.05, TODAY);
    expect(marked.map((p) => p.status)).toEqual(['DUE', 'DUE']);
    expect(scheduleTotals(marked).paidTotal).toBe(0);
  });

  it('settles the earliest part once that much has been paid', () => {
    const marked = markSchedule(plan, 276.05, TODAY);
    expect(marked[0].status).toBe('PAID');
    expect(marked[0].paid).toBe(200);
    expect(marked[1].status).toBe('DUE');
    expect(marked[1].outstanding).toBe(276.05);
  });

  it('splits a payment that lands mid-instalment', () => {
    const marked = markSchedule(plan, 176.05, TODAY);
    expect(marked[0].status).toBe('PAID');
    expect(marked[1].paid).toBe(100);
    expect(marked[1].outstanding).toBe(176.05);
  });

  it('settles everything when the balance is clear', () => {
    const marked = markSchedule(plan, 0, TODAY);
    expect(marked.every((p) => p.status === 'PAID')).toBe(true);
    expect(scheduleTotals(marked).paidTotal).toBe(476.05);
  });

  it('treats a part-paid instalment past its due date as overdue', () => {
    const overduePlan = [part(1, 200, '2026-07-01'), part(2, 276.05, '2026-09-01')];
    const marked = markSchedule(overduePlan, 476.05, TODAY);
    expect(marked[0].status).toBe('OVERDUE');
    expect(scheduleTotals(marked).overdue).toBe(1);
  });

  it('does not call a settled instalment overdue merely because its date has passed', () => {
    const overduePlan = [part(1, 200, '2026-07-01'), part(2, 276.05, '2026-09-01')];
    expect(markSchedule(overduePlan, 276.05, TODAY)[0].status).toBe('PAID');
  });

  it('caps progress when a family pays beyond the plan', () => {
    // Paying ahead is still just "paid" — it must not spill into negative outstanding.
    const marked = markSchedule(plan, -500, TODAY);
    expect(marked.every((p) => p.status === 'PAID')).toBe(true);
    expect(marked.every((p) => p.outstanding === 0)).toBe(true);
  });

  it('does not read a bill that grew after the plan as negative progress', () => {
    // A new invoice raised mid-term makes owed exceed the plan total.
    const marked = markSchedule(plan, 2000, TODAY);
    expect(marked.every((p) => p.paid === 0)).toBe(true);
    expect(scheduleTotals(marked).paidTotal).toBe(0);
  });

  it('handles an empty schedule', () => {
    expect(markSchedule([], 500, TODAY)).toEqual([]);
    expect(scheduleTotals([])).toEqual({ scheduledTotal: 0, paidTotal: 0, overdue: 0 });
  });

  it('keeps the running credit free of floating-point drift', () => {
    const thirds = [
      part(1, 33.33, '2026-08-01'),
      part(2, 33.33, '2026-09-01'),
      part(3, 33.34, '2026-10-01'),
    ];
    const marked = markSchedule(thirds, 0, TODAY);
    expect(scheduleTotals(marked).paidTotal).toBe(100);
  });
});
