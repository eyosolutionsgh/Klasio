/**
 * How a school numbers its students.
 *
 * Every school already has a house style — `BA-0031`, `2026/PRI/014`, `SHS-26-0007` — and it is
 * printed on report cards, ID cards, receipts and the register. Forcing our format on them means
 * two numbers for every child, so the format is theirs to define.
 *
 * A template is literal text plus tokens:
 *
 *   {YYYY}  the enrolment year, four digits          2026
 *   {YY}    the enrolment year, two digits           26
 *   {####}  the sequence, padded to that many digits 0031
 *   {LEVEL} the level's short code, if it has one    PRI
 *
 * So `BA-{YYYY}-{####}` gives `BA-2026-0031`, and `{YY}/{LEVEL}/{###}` gives `26/PRI/031`.
 */

export interface AdmissionContext {
  /** The next number in the school's own run. */
  sequence: number;
  /** Enrolment year. Not "now": back-dating an enrolment must number it in its own year. */
  year: number;
  /** Short code for the level, where the school uses one. */
  levelCode?: string | null;
}

const SEQ = /\{(#+)\}/g;

export const DEFAULT_TEMPLATE = '{YYYY}-{####}';

export interface TemplateProblem {
  ok: false;
  message: string;
}
export type TemplateCheck = { ok: true } | TemplateProblem;

/**
 * Is this template usable?
 *
 * The one rule that really matters is that it must vary per student. A template with no sequence
 * token gives every child in a year the same number, which the unique index would then reject on
 * the second enrolment — a confusing failure a long way from its cause.
 */
export function checkTemplate(template: string): TemplateCheck {
  const t = (template ?? '').trim();
  if (!t) return { ok: false, message: 'Give a format, for example BA-{YYYY}-{####}' };
  if (t.length > 40) return { ok: false, message: 'That format is too long to fit on a card' };

  const seqs = [...t.matchAll(SEQ)];
  if (seqs.length === 0) {
    return {
      ok: false,
      message: 'The format needs a number part like {####}, or every student would get the same ID',
    };
  }
  if (seqs.length > 1) {
    return { ok: false, message: 'Use the number part {####} once only' };
  }
  if (seqs[0][1].length > 8) {
    return { ok: false, message: 'The number part can be at most 8 digits' };
  }

  // Anything in braces that we do not recognise is almost certainly a typo for one we do.
  const unknown = [...t.matchAll(/\{([^}]*)\}/g)]
    .map((m) => m[1])
    .filter((tok) => !/^#+$/.test(tok) && !['YYYY', 'YY', 'LEVEL'].includes(tok));
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `Not something the format understands: {${unknown[0]}}. Use {YYYY}, {YY}, {####} or {LEVEL}.`,
    };
  }
  return { ok: true };
}

/** Build one admission number. Assumes the template already passed `checkTemplate`. */
export function formatAdmissionNo(template: string, ctx: AdmissionContext): string {
  return (
    template
      .trim()
      .replace(/\{YYYY\}/g, String(ctx.year))
      .replace(/\{YY\}/g, String(ctx.year % 100).padStart(2, '0'))
      // An empty level code collapses cleanly rather than leaving a stray separator behind.
      .replace(/\{LEVEL\}/g, (ctx.levelCode ?? '').trim())
      .replace(SEQ, (_m, hashes: string) => String(ctx.sequence).padStart(hashes.length, '0'))
      .replace(/([-/_])\1+/g, '$1')
      .replace(/^[-/_]+|[-/_]+$/g, '')
  );
}

/** A worked example for the settings screen, so a school sees the shape before saving it. */
export function previewAdmissionNo(template: string, levelCode = 'PRI'): string | null {
  if (!checkTemplate(template).ok) return null;
  return formatAdmissionNo(template, {
    sequence: 31,
    year: new Date().getFullYear(),
    levelCode,
  });
}
