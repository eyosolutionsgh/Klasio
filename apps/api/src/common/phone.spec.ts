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
  // Shown to a parent deciding which phone to pick up, so it has to read the way they write it.
  it('renders a Ghanaian number in the local form its owner would recognise', () => {
    expect(maskMsisdn('233242366410')).toBe('024 *** 6410');
    expect(maskMsisdn('233554654834')).toBe('055 *** 4834');
  });

  it('leaves a number outside Ghana alone rather than guessing its national form', () => {
    expect(maskMsisdn('447700900123')).toBe('447 *** 0123');
  });

  it('never leaks a short value', () => {
    expect(maskMsisdn('12345')).toBe('***');
    // Long enough to pass the first guard, too short to keep prefix and tail apart once
    // the country code is traded for a leading zero.
    expect(maskMsisdn('233123')).toBe('***');
  });
});
