import { describe, it, expect } from 'vitest';
import {
  findClash,
  findPeriodOverlap,
  formatMinutes,
  periodsOverlap,
  weekdayName,
  type Assignment,
  type PeriodShape,
} from './timetable';

const slot = (over: Partial<Assignment> = {}): Assignment => ({
  classId: 'basic4',
  className: 'Basic 4',
  periodId: 'p2',
  periodName: 'Period 2',
  weekday: 2, // Tuesday
  teacherId: 'mensah',
  teacherName: 'Mr Mensah',
  ...over,
});

describe('findClash', () => {
  it('allows a placement on an empty timetable', () => {
    expect(findClash(slot(), [])).toBeNull();
  });

  it('allows the same teacher in the same period on a different weekday', () => {
    const existing = [slot({ id: 'a', classId: 'basic5', className: 'Basic 5', weekday: 3 })];
    expect(findClash(slot(), existing)).toBeNull();
  });

  it('allows the same teacher in a different period on the same weekday', () => {
    const existing = [
      slot({
        id: 'a',
        classId: 'basic5',
        className: 'Basic 5',
        periodId: 'p3',
        periodName: 'Period 3',
      }),
    ];
    expect(findClash(slot(), existing)).toBeNull();
  });

  it('refuses a second lesson for the same class in one slot', () => {
    const existing = [slot({ id: 'a', teacherId: 'adjei', teacherName: 'Ms Adjei' })];
    const clash = findClash(slot(), existing);
    expect(clash?.kind).toBe('CLASS');
    expect(clash?.conflictingId).toBe('a');
    expect(clash?.message).toContain('Basic 4');
  });

  it('refuses a teacher already teaching another class in that slot, and names it', () => {
    const existing = [slot({ id: 'a', classId: 'basic5', className: 'Basic 5' })];
    const clash = findClash(slot(), existing);
    expect(clash?.kind).toBe('TEACHER');
    expect(clash?.conflictingId).toBe('a');
    // The message has to be actionable on its own — who, where, when.
    expect(clash?.message).toBe('Mr Mensah already teaches Basic 5 in Period 2 on Tuesday.');
  });

  it('reports the class clash first when both apply', () => {
    // Same class *and* same teacher: the local problem is the one to show.
    const existing = [slot({ id: 'a' })];
    expect(findClash(slot(), existing)?.kind).toBe('CLASS');
  });

  it('lets a slot be re-saved over itself without clashing', () => {
    const stored = slot({ id: 'a' });
    expect(findClash(stored, [stored])).toBeNull();
  });

  it('never clashes a free period against another free period', () => {
    const free = slot({ teacherId: null, teacherName: null });
    const existing = [
      slot({
        id: 'a',
        classId: 'basic5',
        className: 'Basic 5',
        teacherId: null,
        teacherName: null,
      }),
    ];
    expect(findClash(free, existing)).toBeNull();
  });

  it('never clashes a free period against a staffed lesson elsewhere', () => {
    const free = slot({ teacherId: null, teacherName: null });
    const existing = [slot({ id: 'a', classId: 'basic5', className: 'Basic 5' })];
    expect(findClash(free, existing)).toBeNull();
  });

  it('ignores unstaffed rows when looking for a teacher clash', () => {
    const existing = [
      slot({
        id: 'a',
        classId: 'basic5',
        className: 'Basic 5',
        teacherId: null,
        teacherName: null,
      }),
    ];
    expect(findClash(slot(), existing)).toBeNull();
  });

  it('refuses any lesson in a break period, even on an empty grid', () => {
    const clash = findClash(slot({ periodName: 'Break', periodIsBreak: true }), []);
    expect(clash?.kind).toBe('BREAK');
    expect(clash?.message).toContain('Break');
  });

  it('refuses a break placement before checking anything else', () => {
    // A break with a clash on top of it should still read as "that is a break".
    const existing = [slot({ id: 'a', periodIsBreak: true })];
    expect(findClash(slot({ periodIsBreak: true }), existing)?.kind).toBe('BREAK');
  });

  it('does not treat a break period as blocking the slots around it', () => {
    const existing = [slot({ id: 'a', periodId: 'brk', periodName: 'Break', periodIsBreak: true })];
    expect(findClash(slot(), existing)).toBeNull();
  });
});

describe('periodsOverlap', () => {
  const p = (startsMin: number, endsMin: number): PeriodShape => ({
    name: 'x',
    startsMin,
    endsMin,
  });

  it('treats back-to-back periods as fine', () => {
    expect(periodsOverlap(p(540, 580), p(580, 620))).toBe(false);
  });

  it('catches a partial overlap from either side', () => {
    expect(periodsOverlap(p(540, 590), p(580, 620))).toBe(true);
    expect(periodsOverlap(p(580, 620), p(540, 590))).toBe(true);
  });

  it('catches one period swallowing another', () => {
    expect(periodsOverlap(p(540, 660), p(580, 600))).toBe(true);
  });
});

describe('findPeriodOverlap', () => {
  const day: PeriodShape[] = [
    { id: 'p1', name: 'Period 1', startsMin: 480, endsMin: 520 },
    { id: 'brk', name: 'Break', startsMin: 520, endsMin: 560, isBreak: true },
    { id: 'p2', name: 'Period 2', startsMin: 560, endsMin: 600 },
  ];

  it('lets a new period slot into a gap', () => {
    expect(findPeriodOverlap({ name: 'Period 3', startsMin: 600, endsMin: 640 }, day)).toBeNull();
  });

  it('names the teaching period a new one would collide with', () => {
    const hit = findPeriodOverlap({ name: 'Assembly', startsMin: 500, endsMin: 540 }, day);
    expect(hit?.name).toBe('Period 1');
  });

  it('lets a break overlap another break', () => {
    const hit = findPeriodOverlap(
      { name: 'Snack', startsMin: 530, endsMin: 550, isBreak: true },
      day,
    );
    expect(hit).toBeNull();
  });

  it('still refuses a break that eats into a lesson', () => {
    const hit = findPeriodOverlap(
      { name: 'Long break', startsMin: 500, endsMin: 560, isBreak: true },
      day,
    );
    expect(hit?.name).toBe('Period 1');
  });

  it('lets a period be edited in place without colliding with itself', () => {
    const hit = findPeriodOverlap(
      { id: 'p1', name: 'Period 1', startsMin: 480, endsMin: 515 },
      day,
    );
    expect(hit).toBeNull();
  });
});

describe('weekdayName', () => {
  it('names the teaching week', () => {
    expect([1, 2, 3, 4, 5].map(weekdayName)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
    ]);
  });

  it('does not throw on a value outside the teaching week', () => {
    expect(weekdayName(6)).toBe('Day 6');
  });
});

describe('formatMinutes', () => {
  it('writes minutes from midnight the way a school day is written', () => {
    expect(formatMinutes(480)).toBe('08:00');
    expect(formatMinutes(605)).toBe('10:05');
  });
});
