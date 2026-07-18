/**
 * How a term's marks become a report-card total.
 *
 * A school decides how many assessments it runs — three class tests and two exam papers is as
 * normal as one of each — so nothing here counts components or assumes a fixed set. Each side is
 * scored as a proportion of what was actually marked and then weighted, which is what makes the
 * arithmetic hold whether a subject has one test entered or ten.
 *
 * Weights come from the school (`sbaWeight`/`examWeight`, 30/70 under GES by default). Early-years
 * levels have no exam at all, so continuous observation carries the whole 100.
 */

export interface Marked {
  /** The mark the child got. */
  raw: number;
  /** What the assessment was out of. */
  max: number;
}

export interface Weighting {
  sbaWeight: number;
  examWeight: number;
  /** Pre-school and lower primary: observation only, no exam split. */
  earlyYears?: boolean;
}

export interface SubjectTotal {
  sba: number;
  exam: number;
  total: number;
}

/** Sum of `raw` over `max`, or null when nothing was marked — an empty denominator is not a zero. */
function proportion(marked: Marked[]): number | null {
  let raw = 0;
  let max = 0;
  for (const m of marked) {
    raw += m.raw;
    max += m.max;
  }
  if (max <= 0) return null;
  return raw / max;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Weight one subject for one child.
 *
 * Only assessments that carry a mark are passed in. An unmarked assessment must never reach here
 * as a zero: mid-term, most of the term's work does not exist yet, and treating it as zero would
 * tell a parent their child is failing when the child has simply not sat the paper.
 *
 * Returns null when the subject has no marks at all, which is the caller's signal to leave the
 * subject off the report rather than print a row of noughts.
 */
export function weighSubject(
  sbaMarked: Marked[],
  examMarked: Marked[],
  w: Weighting,
): SubjectTotal | null {
  const sbaP = proportion(sbaMarked);
  const examP = proportion(examMarked);
  if (sbaP === null && examP === null) return null;

  if (w.earlyYears) {
    // No exam is sat, so continuous observation is the whole mark. Any exam component that
    // somehow carries a mark is folded in rather than silently dropped.
    const p = proportion([...sbaMarked, ...examMarked]);
    const sba = round1((p ?? 0) * 100);
    return { sba, exam: 0, total: sba };
  }

  const sba = round1((sbaP ?? 0) * w.sbaWeight);
  const exam = round1((examP ?? 0) * w.examWeight);
  return { sba, exam, total: round1(sba + exam) };
}
