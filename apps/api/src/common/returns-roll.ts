/**
 * Who was on roll during a term, and in which level.
 *
 * A termly return is filed weeks or months after the term it describes, and the school has moved
 * on in between. Reading today's roll to answer a question about last term produces a document
 * that is confidently wrong in two directions at once:
 *
 *   - `status: 'ACTIVE'` drops everyone who has since left, so an entire graduating JHS 3 cohort
 *     simply is not in the return for the term they actually sat.
 *   - `Student.classId` is the class a pupil is in *now*. After `promote` has run, every pupil
 *     reads one level higher than they were, so enrolment-by-level — the figure a regulator
 *     scrutinises most — is a description of a term that had not started yet.
 *
 * So the roll is reconstructed rather than read. Enrolment dates decide who counts; the class
 * recorded against that term's own reports and registers decides where they counted.
 *
 * Kept pure and separate from the module because it is a statutory figure: it needs to be
 * testable without a database, and legible to someone checking why a number came out as it did.
 */

export interface RollStudent {
  id: string;
  gender: string | null;
  /** The class the pupil is in *today* — only correct for the current term. */
  classId: string | null;
  enrolledAt: Date;
  /** Set when a pupil transferred, withdrew or graduated. */
  exitDate: Date | null;
}

export interface TermWindow {
  startDate: Date;
  endDate: Date;
}

/**
 * Was this pupil on roll at any point during the term?
 *
 * Inclusive at both ends: a child who enrolled in the last week, and one who left in the first,
 * were both on roll during it. That also makes this population the same one the attendance and
 * results blocks describe — they are filtered by the term's own records, which exist for anyone
 * who was present for any of it. Previously enrolment counted one population and attendance
 * another, so three blocks of one form described three different schools.
 */
export function onRollDuring(student: RollStudent, term: TermWindow): boolean {
  if (student.enrolledAt > term.endDate) return false;
  if (student.exitDate && student.exitDate < term.startDate) return false;
  return true;
}

/**
 * Where a pupil sat during the term.
 *
 * `history` is the class recorded against that term's own records — a TermReport first, since it
 * is generated for a named class and term, then an attendance register. Only when the term left
 * no trace of a pupil at all does this fall back to their current class, which is right for the
 * term in progress and the best available guess for an unmarked, unreported past one.
 */
export function classDuringTerm(
  student: RollStudent,
  history: ReadonlyMap<string, string>,
): string | null {
  return history.get(student.id) ?? student.classId;
}

export interface LevelRow {
  level: string;
  category: string;
  male: number;
  female: number;
  total: number;
}

/**
 * Build the enrolment-by-level block.
 *
 * `total` is deliberately not `male + female`: a record with no sex recorded still belongs on the
 * roll, and dropping it would make the return disagree with the school's own register.
 */
export function enrolmentByLevel(
  students: readonly RollStudent[],
  term: TermWindow,
  history: ReadonlyMap<string, string>,
  classToLevel: ReadonlyMap<string, string>,
  levels: readonly { id: string; name: string; category: string }[],
): LevelRow[] {
  const onRoll = students.filter((s) => onRollDuring(s, term));
  return levels.map((l) => {
    const inLevel = onRoll.filter((s) => {
      const classId = classDuringTerm(s, history);
      return !!classId && classToLevel.get(classId) === l.id;
    });
    return {
      level: l.name,
      category: l.category,
      male: inLevel.filter((s) => s.gender === 'MALE').length,
      female: inLevel.filter((s) => s.gender === 'FEMALE').length,
      total: inLevel.length,
    };
  });
}
