import { describe, expect, it } from 'vitest';
import { checkTemplate, formatAdmissionNo, previewAdmissionNo } from './admission-no';

const ctx = { sequence: 31, year: 2026, levelCode: 'PRI' };

describe('formatAdmissionNo', () => {
  it('builds the shape a school already uses', () => {
    expect(formatAdmissionNo('BA-{YYYY}-{####}', ctx)).toBe('BA-2026-0031');
    expect(formatAdmissionNo('{YY}/{LEVEL}/{###}', ctx)).toBe('26/PRI/031');
    expect(formatAdmissionNo('SHS-{YY}-{####}', ctx)).toBe('SHS-26-0031');
  });

  it('pads the sequence to the width asked for', () => {
    expect(formatAdmissionNo('{#}', { ...ctx, sequence: 7 })).toBe('7');
    expect(formatAdmissionNo('{#####}', { ...ctx, sequence: 7 })).toBe('00007');
  });

  it('does not truncate a sequence that outgrows its padding', () => {
    // A school that picked {###} and reached 1,000 students must still get a usable number
    // rather than a silently wrong one.
    expect(formatAdmissionNo('{###}', { ...ctx, sequence: 1234 })).toBe('1234');
  });

  it('numbers by enrolment year, not today', () => {
    // Back-dating an enrolment must number it in its own year.
    expect(formatAdmissionNo('{YYYY}-{####}', { ...ctx, year: 2019 })).toBe('2019-0031');
  });

  it('collapses the separator when a level has no code', () => {
    // Otherwise a school without level codes gets "26//031".
    expect(formatAdmissionNo('{YY}/{LEVEL}/{###}', { ...ctx, levelCode: null })).toBe('26/031');
    expect(formatAdmissionNo('{YY}/{LEVEL}/{###}', { ...ctx, levelCode: '  ' })).toBe('26/031');
  });

  it('does not leave a dangling separator at either end', () => {
    expect(formatAdmissionNo('{LEVEL}-{####}', { ...ctx, levelCode: null })).toBe('0031');
  });

  it('keeps literal text exactly as typed', () => {
    expect(formatAdmissionNo('BRIGHTON {####}', ctx)).toBe('BRIGHTON 0031');
  });
});

describe('checkTemplate', () => {
  it('accepts the shapes schools actually use', () => {
    for (const t of ['BA-{YYYY}-{####}', '{YY}/{LEVEL}/{###}', '{#####}', 'SCH{##}']) {
      expect(checkTemplate(t).ok, t).toBe(true);
    }
  });

  it('refuses a template with no number part', () => {
    // Every child would get the same ID and the second enrolment would fail on the unique
    // index — a confusing error a long way from its cause.
    const r = checkTemplate('BA-{YYYY}');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toMatch(/number part/);
  });

  it('refuses two number parts', () => {
    expect(checkTemplate('{##}-{##}').ok).toBe(false);
  });

  it('refuses an empty template', () => {
    expect(checkTemplate('').ok).toBe(false);
    expect(checkTemplate('   ').ok).toBe(false);
  });

  it('names an unrecognised token rather than ignoring it', () => {
    // {YEAR} is a plausible typo for {YYYY}; silently printing it literally would ship a school
    // a term of IDs reading "BA-{YEAR}-0031".
    const r = checkTemplate('BA-{YEAR}-{####}');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain('{YEAR}');
  });

  it('refuses an absurdly long number part or template', () => {
    expect(checkTemplate('{#########}').ok).toBe(false);
    expect(checkTemplate('X'.repeat(45) + '{##}').ok).toBe(false);
  });
});

describe('previewAdmissionNo', () => {
  it('shows a worked example', () => {
    expect(previewAdmissionNo('BA-{YYYY}-{####}')).toBe(`BA-${new Date().getFullYear()}-0031`);
  });

  it('returns nothing for a template that would not work', () => {
    expect(previewAdmissionNo('BA-{YYYY}')).toBeNull();
  });
});
