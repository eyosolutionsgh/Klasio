import { CustomFieldKind } from '@prisma/client';

/**
 * What a school may record about a child beyond the fields we ship.
 *
 * Every value lands in one `StudentFieldValue.value` column as text, so the only thing standing
 * between "NHIS number" and a column full of junk is this file. The rules are pure functions
 * because the same check has to hold for the office typing one field, a bulk import, and any
 * future guardian-facing form — three call sites that must not disagree about what a DATE is.
 */

/** The parts of a field definition the checks actually depend on. */
export interface FieldDef {
  id: string;
  label: string;
  kind: CustomFieldKind;
  /** CHOICE options as stored (`Json?`), which is to say: anything. */
  options?: unknown;
  required?: boolean;
}

export type FieldCheck = { ok: true; value: string } | { ok: false; message: string };

/**
 * The stored options for a CHOICE field, defensively.
 *
 * `options` is a JSON column an older release or a hand-edited row could have left as null, an
 * object, or a list with blanks in it. Reading it must never throw — a malformed definition
 * should make the field unusable, not take the student page down.
 */
export function fieldOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options
    .filter((o): o is string | number => typeof o === 'string' || typeof o === 'number')
    .map((o) => String(o).trim())
    .filter((o) => o.length > 0);
}

/** A real calendar date, not merely something Date() was willing to parse. */
function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Round-trips only if the day exists: 2026-02-31 rolls to 3 March and fails here.
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const TRUE = ['true', 'yes', 'y', '1'];
const FALSE = ['false', 'no', 'n', '0'];

/**
 * Check one value against its field's kind and hand back the canonical form to store.
 *
 * Two jobs, deliberately together: a caller that validates without normalising ends up with
 * "12", "12.0" and " 12 " all in the same column, which then breaks every report that groups
 * on it. So the success case carries the text to persist rather than a bare `true`.
 *
 * An empty value is a clear, not a rejection — unless the field is required, where refusing is
 * the whole point of the flag.
 */
export function coerceFieldValue(def: FieldDef, raw: string | null | undefined): FieldCheck {
  const value = (raw ?? '').trim();
  if (!value) {
    if (def.required) return { ok: false, message: `${def.label} is required` };
    return { ok: true, value: '' };
  }

  switch (def.kind) {
    case 'NUMBER': {
      // Number('') and Number(' ') are 0, which is why the blank case is handled above.
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, message: `${def.label} must be a number` };
      return { ok: true, value: String(n) };
    }
    case 'DATE': {
      if (!isCalendarDate(value)) {
        return { ok: false, message: `${def.label} must be a date like 2026-03-14` };
      }
      return { ok: true, value };
    }
    case 'BOOLEAN': {
      const v = value.toLowerCase();
      if (TRUE.includes(v)) return { ok: true, value: 'true' };
      if (FALSE.includes(v)) return { ok: true, value: 'false' };
      return { ok: false, message: `${def.label} must be yes or no` };
    }
    case 'CHOICE': {
      const options = fieldOptions(def.options);
      if (options.length === 0) {
        return { ok: false, message: `${def.label} has no options set up yet` };
      }
      // Matched case-insensitively but stored as the option is written, so the report reads the
      // way the school typed it rather than the way the clerk typed it.
      const match = options.find((o) => o.toLowerCase() === value.toLowerCase());
      if (!match) {
        return { ok: false, message: `${def.label} must be one of: ${options.join(', ')}` };
      }
      return { ok: true, value: match };
    }
    case 'TEXT':
    default:
      return { ok: true, value };
  }
}

/**
 * Check a whole submission at once.
 *
 * All-or-nothing: one bad field fails the lot rather than saving the good half, because a
 * half-written record is harder for the office to reason about than a rejected form. Values for
 * fields that do not belong to this student's level are ignored rather than rejected — the page
 * may simply be stale after someone re-scoped a field.
 */
export function coerceFieldValues(
  defs: FieldDef[],
  entries: { fieldId: string; value: string | null }[],
): { ok: true; values: { fieldId: string; value: string }[] } | { ok: false; message: string } {
  const values: { fieldId: string; value: string }[] = [];
  for (const entry of entries) {
    const def = defs.find((d) => d.id === entry.fieldId);
    if (!def) continue;
    const check = coerceFieldValue(def, entry.value);
    if (!check.ok) return { ok: false, message: check.message };
    values.push({ fieldId: def.id, value: check.value });
  }
  return { ok: true, values };
}

/**
 * Which required documents this child still owes.
 *
 * Completion is worked out by kind, not by filename: the office names files whatever they like,
 * but they pick the kind from a fixed list when uploading, and that is the only thing worth
 * matching on. Optional requirements are reported too, but never counted as outstanding.
 */
export function checklistFor(
  requirements: { id: string; label: string; kind: string; required: boolean }[],
  documents: { kind: string }[],
): {
  items: { id: string; label: string; kind: string; required: boolean; onFile: boolean }[];
  missing: number;
  complete: boolean;
} {
  const held = new Set(documents.map((d) => d.kind));
  const items = requirements.map((r) => ({
    id: r.id,
    label: r.label,
    kind: r.kind,
    required: r.required,
    onFile: held.has(r.kind),
  }));
  const missing = items.filter((i) => i.required && !i.onFile).length;
  return { items, missing, complete: missing === 0 };
}
