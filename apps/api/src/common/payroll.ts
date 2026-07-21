/**
 * Ghana payroll arithmetic (FEATURES.md §17): SSNIT tiers and GRA PAYE.
 *
 * Rates as at the 2026 tax year — employee SSNIT 5.5% of basic, employer 13%, and the graduated
 * monthly PAYE bands below (the annual bands ÷ 12). SSNIT comes off before PAYE: the employee
 * contribution is tax-deductible, which is why `taxable` is gross minus SSNIT. When Parliament
 * moves the bands, THIS FILE is the one place they change.
 */

export const SSNIT_EMPLOYEE_RATE = 0.055;
export const SSNIT_EMPLOYER_RATE = 0.13;

/** Monthly graduated bands: [width of band in GHS, rate]. The last band is open-ended. */
export const MONTHLY_PAYE_BANDS: ReadonlyArray<readonly [number, number]> = [
  [490, 0],
  [110, 0.05],
  [130, 0.1],
  [3166.67, 0.175],
  [16000, 0.25],
  [30520, 0.3],
  [Infinity, 0.35],
];

const round2 = (n: number) => Math.round(n * 100) / 100;

export function ssnitEmployee(basic: number): number {
  return round2(basic * SSNIT_EMPLOYEE_RATE);
}

export function ssnitEmployer(basic: number): number {
  return round2(basic * SSNIT_EMPLOYER_RATE);
}

/** PAYE on one month's taxable income, through the graduated bands. */
export function monthlyPaye(taxable: number): number {
  let remaining = Math.max(0, taxable);
  let tax = 0;
  for (const [width, rate] of MONTHLY_PAYE_BANDS) {
    const slice = Math.min(remaining, width);
    tax += slice * rate;
    remaining -= slice;
    if (remaining <= 0) break;
  }
  return round2(tax);
}

export interface PayInput {
  basic: number;
  /** Cash allowances (transport, rent, responsibility …), summed. */
  allowances: number;
  /** Loan repayments, welfare dues — anything the school withholds beyond statute. */
  otherDeductions?: number;
}

export interface PayLine {
  basic: number;
  allowances: number;
  gross: number;
  ssnitEmployee: number;
  taxable: number;
  paye: number;
  otherDeductions: number;
  net: number;
  /** The school's own cost on top of gross — never deducted from the employee. */
  ssnitEmployer: number;
}

export function computePay(input: PayInput): PayLine {
  const basic = round2(input.basic);
  const allowances = round2(input.allowances);
  const other = round2(input.otherDeductions ?? 0);
  const gross = round2(basic + allowances);
  const ssnit = ssnitEmployee(basic);
  const taxable = round2(gross - ssnit);
  const paye = monthlyPaye(taxable);
  return {
    basic,
    allowances,
    gross,
    ssnitEmployee: ssnit,
    taxable,
    paye,
    otherDeductions: other,
    net: round2(gross - ssnit - paye - other),
    ssnitEmployer: ssnitEmployer(basic),
  };
}
