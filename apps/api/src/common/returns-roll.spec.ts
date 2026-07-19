import { describe, expect, it } from 'vitest';
import { classDuringTerm, enrolmentByLevel, onRollDuring, type RollStudent } from './returns-roll';

const term = { startDate: new Date('2026-01-10'), endDate: new Date('2026-04-05') };

const pupil = (over: Partial<RollStudent> = {}): RollStudent => ({
  id: 'p1',
  gender: 'FEMALE',
  classId: 'jhs3',
  enrolledAt: new Date('2024-09-01'),
  exitDate: null,
  ...over,
});

describe('onRollDuring', () => {
  it('counts a pupil who was there all term', () => {
    expect(onRollDuring(pupil(), term)).toBe(true);
  });

  it('counts the graduating cohort in the term they actually sat', () => {
    // The defect this exists for: filing Term 3's return in October, after JHS 3 has graduated.
    // Reading `status: ACTIVE` erased the entire year group from the term they were present for.
    expect(onRollDuring(pupil({ exitDate: new Date('2026-04-05') }), term)).toBe(true);
  });

  it('counts a pupil who withdrew mid-term', () => {
    // They were on roll for nine weeks, and their registers are in the attendance block. Dropping
    // them from enrolment made two blocks of one form describe different populations.
    expect(onRollDuring(pupil({ exitDate: new Date('2026-03-01') }), term)).toBe(true);
  });

  it('excludes a pupil who had already left before the term began', () => {
    expect(onRollDuring(pupil({ exitDate: new Date('2025-12-20') }), term)).toBe(false);
  });

  it('excludes a pupil who had not yet enrolled', () => {
    expect(onRollDuring(pupil({ enrolledAt: new Date('2026-09-01') }), term)).toBe(false);
  });

  it('counts a pupil who enrolled on the last day', () => {
    expect(onRollDuring(pupil({ enrolledAt: term.endDate }), term)).toBe(true);
  });

  it('counts a pupil who left on the first day', () => {
    expect(onRollDuring(pupil({ exitDate: term.startDate }), term)).toBe(true);
  });
});

describe('classDuringTerm', () => {
  it('uses the class recorded against that term, not the pupil’s class today', () => {
    // After `promote` rewrites classId in bulk, the current value describes a term that had not
    // started when the return's term ended.
    const history = new Map([['p1', 'jhs2']]);
    expect(classDuringTerm(pupil({ classId: 'jhs3' }), history)).toBe('jhs2');
  });

  it('falls back to the current class when the term left no trace', () => {
    expect(classDuringTerm(pupil({ classId: 'jhs3' }), new Map())).toBe('jhs3');
  });

  it('tolerates a pupil who has no class at all', () => {
    expect(classDuringTerm(pupil({ classId: null }), new Map())).toBeNull();
  });
});

describe('enrolmentByLevel', () => {
  const levels = [
    { id: 'lower', name: 'Basic 1-3', category: 'PRIMARY' },
    { id: 'upper', name: 'JHS', category: 'JHS' },
  ];
  const classToLevel = new Map([
    ['b2', 'lower'],
    ['jhs2', 'upper'],
    ['jhs3', 'upper'],
  ]);

  it('places pupils by where they sat that term', () => {
    const students = [
      pupil({ id: 'a', classId: 'jhs3', gender: 'MALE' }),
      pupil({ id: 'b', classId: 'jhs3', gender: 'FEMALE' }),
    ];
    // Both have since been promoted into jhs3; that term they were in jhs2 and b2.
    const history = new Map([
      ['a', 'jhs2'],
      ['b', 'b2'],
    ]);
    const rows = enrolmentByLevel(students, term, history, classToLevel, levels);
    expect(rows.find((r) => r.level === 'JHS')!.total).toBe(1);
    expect(rows.find((r) => r.level === 'Basic 1-3')!.total).toBe(1);
  });

  it('counts a record with no sex recorded in the total', () => {
    // total is not male + female: the return must agree with the school's own register.
    const rows = enrolmentByLevel(
      [pupil({ id: 'x', gender: null, classId: 'jhs2' })],
      term,
      new Map(),
      classToLevel,
      levels,
    );
    const jhs = rows.find((r) => r.level === 'JHS')!;
    expect([jhs.male, jhs.female, jhs.total]).toEqual([0, 0, 1]);
  });

  it('leaves out a pupil who was not on roll that term', () => {
    const rows = enrolmentByLevel(
      [pupil({ id: 'gone', classId: 'jhs2', exitDate: new Date('2025-11-01') })],
      term,
      new Map(),
      classToLevel,
      levels,
    );
    expect(rows.every((r) => r.total === 0)).toBe(true);
  });

  it('does not place a pupil whose class belongs to no level', () => {
    const rows = enrolmentByLevel(
      [pupil({ id: 'orphan', classId: 'unknown-class' })],
      term,
      new Map(),
      classToLevel,
      levels,
    );
    expect(rows.every((r) => r.total === 0)).toBe(true);
  });

  it('re-running the same term later gives the same answer', () => {
    // The property that matters: a return describes its term, so it cannot drift as the school
    // moves on. Same inputs for that term ⇒ same document.
    const students = [pupil({ id: 'a', classId: 'jhs2' })];
    const history = new Map([['a', 'jhs2']]);
    const before = enrolmentByLevel(students, term, history, classToLevel, levels);
    const promoted = [pupil({ id: 'a', classId: 'jhs3', exitDate: new Date('2026-08-01') })];
    const after = enrolmentByLevel(promoted, term, history, classToLevel, levels);
    expect(after).toEqual(before);
  });
});
