import { describe, expect, it } from 'vitest';
import { validateBands, Band } from './grading';

const band = (min: number, max: number, grade: string): Band => ({
  min,
  max,
  grade,
  remark: grade,
});

describe('grading band validation', () => {
  it('accepts a contiguous 0–100 scheme', () => {
    const ok = validateBands([band(0, 39, 'F'), band(40, 69, 'C'), band(70, 100, 'A')]);
    expect(ok).toEqual({ ok: true });
  });

  it('accepts bands supplied out of order', () => {
    expect(validateBands([band(70, 100, 'A'), band(0, 39, 'F'), band(40, 69, 'C')]).ok).toBe(true);
  });

  it('rejects a gap that would leave a score ungraded', () => {
    const r = validateBands([band(0, 39, 'F'), band(45, 100, 'A')]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('no grade');
  });

  it('rejects overlapping bands', () => {
    const r = validateBands([band(0, 50, 'F'), band(40, 100, 'A')]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('overlap');
  });

  it('requires coverage from 0 to 100', () => {
    expect(validateBands([band(10, 100, 'A')]).ok).toBe(false);
    expect(validateBands([band(0, 90, 'A')]).ok).toBe(false);
  });

  it('rejects inverted, out-of-range and unlabelled bands', () => {
    expect(validateBands([band(60, 40, 'X')]).ok).toBe(false);
    expect(validateBands([band(0, 120, 'X')]).ok).toBe(false);
    expect(validateBands([band(0, 100, '')]).ok).toBe(false);
  });

  it('rejects an empty scheme', () => {
    expect(validateBands([]).ok).toBe(false);
  });
});
