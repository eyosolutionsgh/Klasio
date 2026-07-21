import { describe, expect, it } from 'vitest';
import { computePay, monthlyPaye, ssnitEmployee, ssnitEmployer } from './payroll';

describe('SSNIT', () => {
  it('splits 5.5% employee / 13% employer on basic salary', () => {
    expect(ssnitEmployee(2000)).toBe(110);
    expect(ssnitEmployer(2000)).toBe(260);
  });
});

describe('monthlyPaye', () => {
  it('is zero inside the tax-free band', () => {
    expect(monthlyPaye(490)).toBe(0);
    expect(monthlyPaye(0)).toBe(0);
  });

  it('walks the graduated bands', () => {
    // 490 free + 110 @5% = 5.50
    expect(monthlyPaye(600)).toBe(5.5);
    // + 130 @10% = 13.00 → 18.50 at 730
    expect(monthlyPaye(730)).toBe(18.5);
    // 1,000: 18.50 + 270 @17.5% = 65.75
    expect(monthlyPaye(1000)).toBe(65.75);
  });

  it('reaches the 35% band for the highest earners', () => {
    // Sum of the closed bands: 490+110+130+3166.67+16000+30520 = 50,416.67
    const topOfClosed = 50416.67;
    const taxAtTop = monthlyPaye(topOfClosed);
    expect(monthlyPaye(topOfClosed + 100)).toBeCloseTo(taxAtTop + 35, 2);
  });
});

describe('computePay', () => {
  it('deducts SSNIT before PAYE — the contribution is tax-deductible', () => {
    const line = computePay({ basic: 2000, allowances: 500 });
    expect(line.gross).toBe(2500);
    expect(line.ssnitEmployee).toBe(110);
    expect(line.taxable).toBe(2390);
    expect(line.paye).toBe(monthlyPaye(2390));
    expect(line.net).toBe(2500 - 110 - line.paye);
    expect(line.ssnitEmployer).toBe(260);
  });

  it('other deductions reduce net but never taxable', () => {
    const withLoan = computePay({ basic: 2000, allowances: 0, otherDeductions: 300 });
    const without = computePay({ basic: 2000, allowances: 0 });
    expect(withLoan.paye).toBe(without.paye);
    expect(withLoan.net).toBe(without.net - 300);
  });
});
