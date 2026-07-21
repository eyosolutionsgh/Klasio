/**
 * BECE aggregate projection and WASSCE readiness (FEATURES.md §4).
 *
 * Projections, not prophecy: term marks are mapped onto the examinations' own grade bands and
 * combined the way the examiners combine them, so a head can see who is on track while there is
 * still a term to do something about it. The bands are the widely used interpretations — BECE
 * stanines are norm-referenced in reality, so this is a planning tool, and the UI says so.
 */

/** BECE-style stanine from a 0–100 subject total. Lower is better; 1 is the top grade. */
export function beceGrade(total: number): number {
  if (total >= 90) return 1;
  if (total >= 80) return 2;
  if (total >= 70) return 3;
  if (total >= 60) return 4;
  if (total >= 55) return 5;
  if (total >= 50) return 6;
  if (total >= 40) return 7;
  if (total >= 35) return 8;
  return 9;
}

/** WASSCE grade from a 0–100 subject total, with its point value (A1=1 … F9=9). */
export function wassceGrade(total: number): { grade: string; points: number } {
  if (total >= 75) return { grade: 'A1', points: 1 };
  if (total >= 70) return { grade: 'B2', points: 2 };
  if (total >= 65) return { grade: 'B3', points: 3 };
  if (total >= 60) return { grade: 'C4', points: 4 };
  if (total >= 55) return { grade: 'C5', points: 5 };
  if (total >= 50) return { grade: 'C6', points: 6 };
  if (total >= 45) return { grade: 'D7', points: 7 };
  if (total >= 40) return { grade: 'E8', points: 8 };
  return { grade: 'F9', points: 9 };
}

export interface SubjectMark {
  subject: string;
  isCore: boolean;
  total: number;
}

export interface BeceProjection {
  /** Sum of the 4 core grades and the best 2 elective grades — 6 (perfect) to 54. */
  aggregate: number | null;
  /** Why an aggregate could not be formed, in words a head acts on. */
  gap: string | null;
  subjects: { subject: string; isCore: boolean; total: number; grade: number }[];
}

/**
 * The BECE combination: all four cores plus the best two electives. With fewer than four core
 * marks or fewer than two electives there is no aggregate — that absence is itself the finding.
 */
export function beceProjection(marks: SubjectMark[]): BeceProjection {
  const graded = marks.map((m) => ({ ...m, grade: beceGrade(m.total) }));
  const cores = graded.filter((m) => m.isCore);
  const electives = graded.filter((m) => !m.isCore).sort((a, b) => a.grade - b.grade);

  let aggregate: number | null = null;
  let gap: string | null = null;
  if (cores.length < 4) {
    gap = `Only ${cores.length} of 4 core subjects have marks`;
  } else if (electives.length < 2) {
    gap = `Only ${electives.length} elective${electives.length === 1 ? '' : 's'} marked — 2 are needed`;
  } else {
    const coreBest = [...cores].sort((a, b) => a.grade - b.grade).slice(0, 4);
    aggregate =
      coreBest.reduce((s, m) => s + m.grade, 0) +
      electives.slice(0, 2).reduce((s, m) => s + m.grade, 0);
  }
  return { aggregate, gap, subjects: graded };
}

export interface WassceReadiness {
  /** Best-six points where possible (English and Maths always counted), else null. */
  aggregate: number | null;
  credits: number;
  englishCredit: boolean;
  mathsCredit: boolean;
  /** Credits (C6+) in six subjects including English and Maths — the tertiary threshold. */
  ready: boolean;
  subjects: { subject: string; isCore: boolean; total: number; grade: string; points: number }[];
}

const looksLike = (name: string, needle: string) => name.toLowerCase().includes(needle);

export function wassceReadiness(marks: SubjectMark[]): WassceReadiness {
  const graded = marks.map((m) => ({ ...m, ...wassceGrade(m.total) }));
  const credits = graded.filter((m) => m.points <= 6);
  const english = graded.find((m) => looksLike(m.subject, 'english'));
  const maths = graded.find((m) => looksLike(m.subject, 'math'));
  const englishCredit = !!english && english.points <= 6;
  const mathsCredit = !!maths && maths.points <= 6;

  let aggregate: number | null = null;
  if (graded.length >= 6 && english && maths) {
    const rest = graded
      .filter((m) => m !== english && m !== maths)
      .sort((a, b) => a.points - b.points)
      .slice(0, 4);
    aggregate = english.points + maths.points + rest.reduce((s, m) => s + m.points, 0);
  }

  return {
    aggregate,
    credits: credits.length,
    englishCredit,
    mathsCredit,
    ready: englishCredit && mathsCredit && credits.length >= 6,
    subjects: graded,
  };
}
