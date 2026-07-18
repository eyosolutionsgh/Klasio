/**
 * Timetable placement rules.
 *
 * A timetable is only worth keeping if it is impossible — not merely discouraged — to put one
 * teacher in two rooms at once. The database can enforce the easy half (a class cannot have two
 * lessons in the same slot, via a unique index), but the teacher half spans classes and cannot be
 * expressed as an index, so it has to be decided in code before the write.
 *
 * That decision lives here as pure functions: the service does the reading and writing, and this
 * file decides, so the rule can be tested exhaustively and cannot quietly diverge between the
 * create path, the edit path and any future bulk importer.
 */

/** 1 = Monday … 5 = Friday. Ghanaian schools rarely timetable weekends. */
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;

export function weekdayName(weekday: number): string {
  return WEEKDAYS[weekday - 1] ?? `Day ${weekday}`;
}

/**
 * One placement on the grid, carrying the names as well as the ids.
 *
 * The names are here so a clash can be reported the way a person would say it — "Mr Mensah
 * already teaches Basic 4 in Period 2 on Tuesday" — rather than as a pair of cuids. A message the
 * timetabler can act on without opening another screen is the whole point.
 */
export interface Assignment {
  /** Set on rows already stored; omitted on the one being proposed. */
  id?: string;
  classId: string;
  className: string;
  periodId: string;
  periodName: string;
  /** Break periods are on the grid but cannot hold a lesson. */
  periodIsBreak?: boolean;
  weekday: number;
  /** A free period, or one the school has not staffed yet. Never clashes. */
  teacherId?: string | null;
  teacherName?: string | null;
}

export type ClashKind = 'CLASS' | 'TEACHER' | 'BREAK';

export interface Clash {
  kind: ClashKind;
  /** Wording for the timetabler. Names the other lesson concretely. */
  message: string;
  /** The stored row that stands in the way, when there is one. */
  conflictingId?: string;
}

/** Two placements are in the same box on the grid. */
function sameSlot(a: Assignment, b: Assignment): boolean {
  return a.periodId === b.periodId && a.weekday === b.weekday;
}

/**
 * Decide whether `proposed` can be written, given everything already on the timetable.
 *
 * `existing` is every slot in the school for that weekday — not just the class's own — because a
 * teacher clash is by definition somewhere else on the grid. A row with the same `id` as the
 * proposal is the row being edited and is skipped, so re-saving a slot never collides with itself.
 *
 * Order matters: a break is reported before a clash because "you cannot teach then" is more
 * useful than "something else is already there", and the class clash is reported before the
 * teacher clash because it is the more local, more obvious problem to fix.
 */
export function findClash(proposed: Assignment, existing: Assignment[]): Clash | null {
  if (proposed.periodIsBreak) {
    return {
      kind: 'BREAK',
      message: `${proposed.periodName} is a break — lessons cannot be timetabled in it.`,
    };
  }

  const others = existing.filter((e) => !e.id || e.id !== proposed.id);

  const classClash = others.find((e) => sameSlot(e, proposed) && e.classId === proposed.classId);
  if (classClash) {
    return {
      kind: 'CLASS',
      conflictingId: classClash.id,
      message:
        `${proposed.className} already has a lesson in ${proposed.periodName} on ` +
        `${weekdayName(proposed.weekday)}. Clear it before timetabling another.`,
    };
  }

  // A slot with nobody assigned is a legitimate thing to timetable — a private study period, or a
  // subject the school has not staffed yet — and two of them are not a clash with each other.
  if (!proposed.teacherId) return null;

  const teacherClash = others.find(
    (e) => sameSlot(e, proposed) && !!e.teacherId && e.teacherId === proposed.teacherId,
  );
  if (teacherClash) {
    const who = proposed.teacherName ?? teacherClash.teacherName ?? 'That teacher';
    return {
      kind: 'TEACHER',
      conflictingId: teacherClash.id,
      message:
        `${who} already teaches ${teacherClash.className} in ${proposed.periodName} on ` +
        `${weekdayName(proposed.weekday)}.`,
    };
  }

  return null;
}

/** The shape of one slice of the school day. Minutes from midnight keeps the maths plain. */
export interface PeriodShape {
  id?: string;
  name: string;
  startsMin: number;
  endsMin: number;
  isBreak?: boolean;
}

/**
 * Two spans overlap when each starts before the other ends. Touching ends — 09:00–09:40 followed
 * by 09:40–10:20 — is the normal way a school day is written and must not count.
 */
export function periodsOverlap(a: PeriodShape, b: PeriodShape): boolean {
  return a.startsMin < b.endsMin && b.startsMin < a.endsMin;
}

/**
 * The first teaching period `candidate` would collide with, if any.
 *
 * Only non-break periods are considered. Schools describe break time loosely — a 30-minute break
 * that officially starts while the previous lesson is still winding down — and rejecting that
 * would make the setup screen unusable for the sake of a purity nobody asked for. Two lessons
 * overlapping, on the other hand, is always a mistake.
 */
export function findPeriodOverlap(
  candidate: PeriodShape,
  existing: PeriodShape[],
): PeriodShape | null {
  return (
    existing.find(
      (p) => (!candidate.id || p.id !== candidate.id) && !p.isBreak && periodsOverlap(candidate, p),
    ) ?? null
  );
}

/** Minutes from midnight as a school would write it. */
export function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
