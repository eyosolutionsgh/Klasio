/**
 * Timetable drafting (FEATURES.md §6/§21: "a timetable drafted for you").
 *
 * A deterministic constraint solver, not an oracle: given what a class must be taught (subject,
 * teacher, lessons per week) and where every teacher already is, it proposes a clash-free week
 * and says plainly what it could not place. A person reviews and applies — the draft never
 * writes anything itself.
 *
 * Placement order is largest-demand-first (the hardest subjects to fit go while the grid is
 * open), and within a subject lessons spread across days before any day takes a second one —
 * double Maths on Monday and none on Thursday is how hand-made timetables go wrong.
 */

export interface DraftPeriod {
  id: string;
  order: number;
  isBreak: boolean;
}

export interface DraftDemand {
  subjectId: string;
  teacherId: string | null;
  perWeek: number;
}

/** Cells already taken, from the whole school's existing slots. */
export interface BusyCell {
  weekday: number;
  periodId: string;
  teacherId: string | null;
  classId: string;
}

export interface DraftPlacement {
  weekday: number;
  periodId: string;
  subjectId: string;
  teacherId: string | null;
}

export interface DraftResult {
  placed: DraftPlacement[];
  /** Demands (or parts of them) that would not fit, with the count still owed. */
  unplaced: { subjectId: string; teacherId: string | null; missing: number }[];
}

const WEEKDAYS = [1, 2, 3, 4, 5];

export function draftTimetable(
  classId: string,
  demands: DraftDemand[],
  periods: DraftPeriod[],
  busy: BusyCell[],
): DraftResult {
  const teaching = [...periods].filter((p) => !p.isBreak).sort((a, b) => a.order - b.order);

  // Occupancy maps for O(1) checks, updated as the draft grows.
  const classBusy = new Set(
    busy.filter((b) => b.classId === classId).map((b) => `${b.weekday}:${b.periodId}`),
  );
  const teacherBusy = new Set(
    busy.filter((b) => b.teacherId).map((b) => `${b.weekday}:${b.periodId}:${b.teacherId}`),
  );

  const placed: DraftPlacement[] = [];
  const unplaced: DraftResult['unplaced'] = [];

  const free = (weekday: number, periodId: string, teacherId: string | null) =>
    !classBusy.has(`${weekday}:${periodId}`) &&
    (!teacherId || !teacherBusy.has(`${weekday}:${periodId}:${teacherId}`));

  const take = (weekday: number, periodId: string, d: DraftDemand) => {
    classBusy.add(`${weekday}:${periodId}`);
    if (d.teacherId) teacherBusy.add(`${weekday}:${periodId}:${d.teacherId}`);
    placed.push({ weekday, periodId, subjectId: d.subjectId, teacherId: d.teacherId });
  };

  // Hardest first: the subject needing the most lessons has the fewest ways to fit.
  const ordered = [...demands].filter((d) => d.perWeek > 0).sort((a, b) => b.perWeek - a.perWeek);

  for (const demand of ordered) {
    let remaining = demand.perWeek;
    const perDay = new Map<number, number>();

    // Pass 1: at most one lesson per day, rotating the starting period per day so subjects do
    // not all pile into first period.
    for (let cap = 1; cap <= teaching.length && remaining > 0; cap++) {
      for (const weekday of WEEKDAYS) {
        if (remaining === 0) break;
        if ((perDay.get(weekday) ?? 0) >= cap) continue;
        // Stagger where each day starts looking, so drafts interleave subjects.
        const offset = (weekday + demand.perWeek) % teaching.length;
        const rotated = [...teaching.slice(offset), ...teaching.slice(0, offset)];
        for (const period of rotated) {
          if (free(weekday, period.id, demand.teacherId)) {
            take(weekday, period.id, demand);
            perDay.set(weekday, (perDay.get(weekday) ?? 0) + 1);
            remaining--;
            break;
          }
        }
      }
    }

    if (remaining > 0) {
      unplaced.push({
        subjectId: demand.subjectId,
        teacherId: demand.teacherId,
        missing: remaining,
      });
    }
  }

  placed.sort((a, b) => a.weekday - b.weekday || a.periodId.localeCompare(b.periodId));
  return { placed, unplaced };
}
