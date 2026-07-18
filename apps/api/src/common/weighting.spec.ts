import { describe, expect, it } from 'vitest';
import { weighSubject, type Marked } from './weighting';

const GES = { sbaWeight: 30, examWeight: 70 };
const m = (raw: number, max: number): Marked => ({ raw, max });

describe('weighSubject', () => {
  it('gives full marks the full 30/70', () => {
    expect(weighSubject([m(10, 10), m(20, 20)], [m(100, 100)], GES)).toEqual({
      sba: 30,
      exam: 70,
      total: 100,
    });
  });

  it('halves proportionally', () => {
    expect(weighSubject([m(5, 10), m(10, 20)], [m(50, 100)], GES)).toEqual({
      sba: 15,
      exam: 35,
      total: 50,
    });
  });

  it('honours a school that weights 40/60 instead', () => {
    expect(weighSubject([m(10, 10)], [m(100, 100)], { sbaWeight: 40, examWeight: 60 })).toEqual({
      sba: 40,
      exam: 60,
      total: 100,
    });
  });

  it('takes any number of assessments on either side', () => {
    // Three tests and two exam papers — the whole point of dropping the fixed set.
    const sba = [m(8, 10), m(9, 10), m(13, 20)]; // 30/40
    const exam = [m(30, 50), m(45, 50)]; // 75/100
    expect(weighSubject(sba, exam, GES)).toEqual({ sba: 22.5, exam: 52.5, total: 75 });
  });

  it('scores only what was marked, so a part-marked term is not a failing term', () => {
    // One test in, out of 10, full marks. The other assessments do not exist yet and must not
    // be read as zeros — this child is at 100%, not 12%.
    expect(weighSubject([m(10, 10)], [], GES)).toEqual({ sba: 30, exam: 0, total: 30 });
  });

  it('does not invent an exam mark from an unsat exam', () => {
    const r = weighSubject([m(5, 10)], [], GES);
    expect(r?.exam).toBe(0);
    expect(r?.sba).toBe(15);
  });

  it('weights the exam alone when no continuous work is marked yet', () => {
    expect(weighSubject([], [m(80, 100)], GES)).toEqual({ sba: 0, exam: 56, total: 56 });
  });

  it('returns null when the subject has no marks at all', () => {
    expect(weighSubject([], [], GES)).toBeNull();
  });

  it('treats a zero mark as a mark, not as absent', () => {
    // Sitting the paper and scoring nothing is different from not sitting it. Both give 0 here,
    // but only the first counts toward the denominator — assert it is not null.
    expect(weighSubject([m(0, 10)], [], GES)).toEqual({ sba: 0, exam: 0, total: 0 });
  });

  it('gives early years the whole 100 from observation, with no exam split', () => {
    expect(weighSubject([m(8, 10)], [], { ...GES, earlyYears: true })).toEqual({
      sba: 80,
      exam: 0,
      total: 80,
    });
  });

  it('folds a stray early-years exam mark into the observation total', () => {
    const r = weighSubject([m(8, 10)], [m(6, 10)], { ...GES, earlyYears: true });
    expect(r).toEqual({ sba: 70, exam: 0, total: 70 });
  });

  it('ignores an assessment marked out of nothing rather than dividing by zero', () => {
    expect(weighSubject([m(0, 0)], [m(50, 100)], GES)).toEqual({ sba: 0, exam: 35, total: 35 });
  });
});
