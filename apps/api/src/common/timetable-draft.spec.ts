import { describe, expect, it } from 'vitest';
import { draftTimetable, type BusyCell, type DraftPeriod } from './timetable-draft';

const periods: DraftPeriod[] = [
  { id: 'p1', order: 1, isBreak: false },
  { id: 'p2', order: 2, isBreak: false },
  { id: 'brk', order: 3, isBreak: true },
  { id: 'p3', order: 4, isBreak: false },
];

describe('draftTimetable', () => {
  it('places every lesson clash-free and never in a break', () => {
    const { placed, unplaced } = draftTimetable(
      'classA',
      [
        { subjectId: 'maths', teacherId: 't1', perWeek: 5 },
        { subjectId: 'english', teacherId: 't2', perWeek: 5 },
        { subjectId: 'science', teacherId: 't1', perWeek: 4 },
      ],
      periods,
      [],
    );
    expect(unplaced).toEqual([]);
    expect(placed).toHaveLength(14);
    expect(placed.every((p) => p.periodId !== 'brk')).toBe(true);
    // No two lessons in the same cell for the class…
    const cells = placed.map((p) => `${p.weekday}:${p.periodId}`);
    expect(new Set(cells).size).toBe(cells.length);
    // …and t1 (teaching two subjects) is never in two places at once.
    const t1 = placed.filter((p) => p.teacherId === 't1').map((p) => `${p.weekday}:${p.periodId}`);
    expect(new Set(t1).size).toBe(t1.length);
  });

  it('spreads a subject across days before doubling any day', () => {
    const { placed } = draftTimetable(
      'classA',
      [{ subjectId: 'maths', teacherId: 't1', perWeek: 5 }],
      periods,
      [],
    );
    const byDay = new Map<number, number>();
    for (const p of placed) byDay.set(p.weekday, (byDay.get(p.weekday) ?? 0) + 1);
    expect([...byDay.values()].every((n) => n === 1)).toBe(true);
    expect(byDay.size).toBe(5);
  });

  it('works around where a teacher already is in other classes', () => {
    // t1 is busy in class B for period p1 every day.
    const busy: BusyCell[] = [1, 2, 3, 4, 5].map((weekday) => ({
      weekday,
      periodId: 'p1',
      teacherId: 't1',
      classId: 'classB',
    }));
    const { placed, unplaced } = draftTimetable(
      'classA',
      [{ subjectId: 'maths', teacherId: 't1', perWeek: 5 }],
      periods,
      busy,
    );
    expect(unplaced).toEqual([]);
    expect(placed.every((p) => p.periodId !== 'p1')).toBe(true);
  });

  it('says plainly what would not fit instead of overbooking', () => {
    // Only 15 teaching cells exist; ask for 16 from one teacher.
    const { placed, unplaced } = draftTimetable(
      'classA',
      [{ subjectId: 'maths', teacherId: 't1', perWeek: 16 }],
      periods,
      [],
    );
    expect(placed).toHaveLength(15);
    expect(unplaced).toEqual([{ subjectId: 'maths', teacherId: 't1', missing: 1 }]);
  });

  it('is deterministic — the same inputs draft the same week', () => {
    const demands = [
      { subjectId: 'maths', teacherId: 't1', perWeek: 4 },
      { subjectId: 'english', teacherId: 't2', perWeek: 4 },
    ];
    const a = draftTimetable('classA', demands, periods, []);
    const b = draftTimetable('classA', demands, periods, []);
    expect(a).toEqual(b);
  });
});
