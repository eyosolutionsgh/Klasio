import { describe, expect, it } from 'vitest';
import { clearanceVerdict } from './fee-clearance';

describe('fee clearance', () => {
  it('lets everyone through when the school has not switched the policy on', () => {
    // The default, and the important one: a school that never opted in must never withhold.
    expect(clearanceVerdict({ policyOn: false, balance: 5000, cleared: false }).allowed).toBe(true);
  });

  it('holds a report when the family owes money', () => {
    const v = clearanceVerdict({ policyOn: true, balance: 250, cleared: false });
    expect(v.allowed).toBe(false);
    // The message has to tell a parent what to do, not merely that they may not look.
    expect(v.reason).toMatch(/contact the school office/i);
  });

  it('lets a cleared child through despite the balance', () => {
    expect(clearanceVerdict({ policyOn: true, balance: 250, cleared: true }).allowed).toBe(true);
  });

  it('treats a settled or credited account as clear', () => {
    expect(clearanceVerdict({ policyOn: true, balance: 0, cleared: false }).allowed).toBe(true);
    expect(clearanceVerdict({ policyOn: true, balance: -40, cleared: false }).allowed).toBe(true);
  });

  it('does not withhold a report over a floating-point remainder', () => {
    // Summing a ledger in floating point leaves crumbs; a tenth of a pesewa is not a debt, and
    // a parent told "settle your balance" over 0.000001 has no way to comply.
    expect(clearanceVerdict({ policyOn: true, balance: 0.000001, cleared: false }).allowed).toBe(
      true,
    );
    // A real pesewa still counts — the rounding must not swallow an actual debt.
    expect(clearanceVerdict({ policyOn: true, balance: 0.01, cleared: false }).allowed).toBe(false);
  });
});
