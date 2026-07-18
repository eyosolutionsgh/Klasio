import { describe, it, expect } from 'vitest';
import {
  checklistFor,
  coerceFieldValue,
  coerceFieldValues,
  fieldOptions,
  type FieldDef,
} from './customfields';

const def = (over: Partial<FieldDef> = {}): FieldDef => ({
  id: 'f1',
  label: 'NHIS number',
  kind: 'TEXT',
  ...over,
});

describe('coerceFieldValue — blanks', () => {
  it('treats a blank on an optional field as a clear', () => {
    for (const raw of [undefined, null, '', '   ']) {
      expect(coerceFieldValue(def(), raw)).toEqual({ ok: true, value: '' });
    }
  });

  it('refuses a blank on a required field', () => {
    const r = coerceFieldValue(def({ required: true }), '  ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('NHIS number');
  });

  it('does not read a blank NUMBER as zero', () => {
    // Number('') is 0 — recording a fee waiver of 0 nobody typed would be worse than nothing.
    expect(coerceFieldValue(def({ kind: 'NUMBER' }), '')).toEqual({ ok: true, value: '' });
  });
});

describe('coerceFieldValue — NUMBER', () => {
  it('rejects text', () => {
    for (const raw of ['abc', '12abc', 'one', '1,200', '--3']) {
      expect(coerceFieldValue(def({ kind: 'NUMBER' }), raw).ok).toBe(false);
    }
  });

  it('rejects infinities and NaN spellings', () => {
    for (const raw of ['Infinity', '-Infinity', 'NaN']) {
      expect(coerceFieldValue(def({ kind: 'NUMBER' }), raw).ok).toBe(false);
    }
  });

  it('accepts and canonicalises real numbers', () => {
    expect(coerceFieldValue(def({ kind: 'NUMBER' }), ' 012.50 ')).toEqual({
      ok: true,
      value: '12.5',
    });
    expect(coerceFieldValue(def({ kind: 'NUMBER' }), '-4')).toEqual({ ok: true, value: '-4' });
  });
});

describe('coerceFieldValue — DATE', () => {
  it('rejects nonsense and loose formats', () => {
    for (const raw of ['abc', '14/03/2026', '2026-3-4', 'today', '20260314']) {
      expect(coerceFieldValue(def({ kind: 'DATE' }), raw).ok).toBe(false);
    }
  });

  it('rejects a day that does not exist', () => {
    // new Date('2026-02-31') happily rolls forward; the field must not.
    for (const raw of ['2026-02-31', '2026-13-01', '2025-02-29']) {
      expect(coerceFieldValue(def({ kind: 'DATE' }), raw).ok).toBe(false);
    }
  });

  it('accepts a real date, leap day included', () => {
    expect(coerceFieldValue(def({ kind: 'DATE' }), '2024-02-29')).toEqual({
      ok: true,
      value: '2024-02-29',
    });
  });
});

describe('coerceFieldValue — BOOLEAN', () => {
  it('accepts the spellings people actually type', () => {
    for (const raw of ['true', 'Yes', 'Y', '1']) {
      expect(coerceFieldValue(def({ kind: 'BOOLEAN' }), raw)).toEqual({ ok: true, value: 'true' });
    }
    for (const raw of ['false', 'No', 'n', '0']) {
      expect(coerceFieldValue(def({ kind: 'BOOLEAN' }), raw)).toEqual({ ok: true, value: 'false' });
    }
  });

  it('rejects anything else rather than guessing', () => {
    expect(coerceFieldValue(def({ kind: 'BOOLEAN' }), 'maybe').ok).toBe(false);
  });
});

describe('coerceFieldValue — CHOICE', () => {
  const choice = def({ kind: 'CHOICE', label: 'House', options: ['Blue', 'Gold', 'Green'] });

  it('rejects a value that is not on the list', () => {
    const r = coerceFieldValue(choice, 'Purple');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('Blue');
  });

  it('matches case-insensitively but stores the school’s spelling', () => {
    expect(coerceFieldValue(choice, ' gold ')).toEqual({ ok: true, value: 'Gold' });
  });

  it('refuses a CHOICE field with no options rather than accepting anything', () => {
    expect(coerceFieldValue(def({ kind: 'CHOICE', options: null }), 'x').ok).toBe(false);
  });
});

describe('fieldOptions', () => {
  it('survives whatever the JSON column holds', () => {
    expect(fieldOptions(null)).toEqual([]);
    expect(fieldOptions({ a: 1 })).toEqual([]);
    expect(fieldOptions(['A', '', '  ', 2, null, 'B '])).toEqual(['A', '2', 'B']);
  });
});

describe('coerceFieldValues', () => {
  const defs = [
    def({ id: 'a', kind: 'NUMBER', label: 'Bus stop no.' }),
    def({ id: 'b', kind: 'TEXT', label: 'Church' }),
  ];

  it('saves nothing when one field is bad', () => {
    const r = coerceFieldValues(defs, [
      { fieldId: 'b', value: 'St Peter’s' },
      { fieldId: 'a', value: 'abc' },
    ]);
    expect(r.ok).toBe(false);
  });

  it('ignores values for fields that no longer apply', () => {
    const r = coerceFieldValues(defs, [
      { fieldId: 'gone', value: 'whatever' },
      { fieldId: 'b', value: ' St Peter’s ' },
    ]);
    expect(r).toEqual({ ok: true, values: [{ fieldId: 'b', value: 'St Peter’s' }] });
  });
});

describe('checklistFor', () => {
  const reqs = [
    { id: 'r1', label: 'Birth certificate', kind: 'BIRTH_CERTIFICATE', required: true },
    { id: 'r2', label: 'Immunisation card', kind: 'IMMUNISATION', required: true },
    { id: 'r3', label: 'Last report', kind: 'PREVIOUS_REPORT', required: false },
  ];

  it('matches on kind, not on filename', () => {
    const c = checklistFor(reqs, [{ kind: 'BIRTH_CERTIFICATE' }]);
    expect(c.items.find((i) => i.id === 'r1')?.onFile).toBe(true);
    expect(c.missing).toBe(1);
    expect(c.complete).toBe(false);
  });

  it('never counts an optional document as outstanding', () => {
    const c = checklistFor(reqs, [{ kind: 'BIRTH_CERTIFICATE' }, { kind: 'IMMUNISATION' }]);
    expect(c.missing).toBe(0);
    expect(c.complete).toBe(true);
    expect(c.items.find((i) => i.id === 'r3')?.onFile).toBe(false);
  });

  it('is complete when the school asks for nothing', () => {
    expect(checklistFor([], [])).toEqual({ items: [], missing: 0, complete: true });
  });

  it('ignores documents of a kind nobody asked for', () => {
    const c = checklistFor(reqs, [{ kind: 'OTHER' }]);
    expect(c.missing).toBe(2);
  });
});
