import { describe, it, expect } from 'vitest';
import { normalizeMsisdn, maskMsisdn } from './phone';

describe('normalizeMsisdn', () => {
  // The whole point: a guardian stored one way must sign in typing it any other way.
  it('collapses every way a Ghanaian number gets typed onto one value', () => {
    const forms = [
      '0242366410',
      '024 236 6410',
      '024-236-6410',
      '+233242366410',
      '+233 24 236 6410',
      '233242366410',
      '242366410',
    ];
    const normalized = forms.map(normalizeMsisdn);
    expect(new Set(normalized)).toEqual(new Set(['233242366410']));
  });

  it('returns null for input with no digits', () => {
    expect(normalizeMsisdn('')).toBeNull();
    expect(normalizeMsisdn('   ')).toBeNull();
    expect(normalizeMsisdn('not a phone')).toBeNull();
  });

  it('leaves an unrecognised international number as its digits', () => {
    expect(normalizeMsisdn('+44 20 7946 0958')).toBe('442079460958');
  });
});

describe('maskMsisdn', () => {
  it('shows only the prefix and last four digits', () => {
    expect(maskMsisdn('233242366410')).toBe('23324 *** 6410');
  });

  it('never leaks a short value', () => {
    expect(maskMsisdn('12345')).toBe('***');
  });
});
