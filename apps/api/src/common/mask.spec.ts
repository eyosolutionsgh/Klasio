import { describe, expect, it } from 'vitest';
import { maskEmail } from './mask';

describe('maskEmail', () => {
  it('keeps the first and last character of the local part', () => {
    expect(maskEmail('ama.mensah@example.com')).toBe('a***h@example.com');
  });

  it('keeps the domain whole, so a parent can recognise their own provider', () => {
    expect(maskEmail('kwame@gmail.com')).toBe('k***e@gmail.com');
  });

  it('never echoes a two-character local part in full', () => {
    expect(maskEmail('ab@example.com')).toBe('a***@example.com');
  });

  it('hides a single-character local part entirely', () => {
    expect(maskEmail('a@example.com')).toBe('***@example.com');
  });

  it('masks the whole string when there is no domain to split on', () => {
    expect(maskEmail('not-an-address')).toBe('***');
    expect(maskEmail('')).toBe('***');
    expect(maskEmail('@example.com')).toBe('***');
    expect(maskEmail('someone@')).toBe('***');
  });

  it('splits on the last @, so an address containing one is not leaked', () => {
    expect(maskEmail('od"@"dity@example.com')).toBe('o***y@example.com');
  });

  it('tolerates surrounding whitespace', () => {
    expect(maskEmail('  ama@example.com  ')).toBe('a***a@example.com');
  });
});
