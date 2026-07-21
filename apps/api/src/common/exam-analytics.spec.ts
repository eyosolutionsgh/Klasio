import { describe, expect, it } from 'vitest';
import { beceGrade, beceProjection, wassceGrade, wassceReadiness } from './exam-analytics';

const mark = (subject: string, total: number, isCore = false) => ({ subject, isCore, total });

describe('beceGrade', () => {
  it('maps the band edges', () => {
    expect(beceGrade(95)).toBe(1);
    expect(beceGrade(90)).toBe(1);
    expect(beceGrade(89)).toBe(2);
    expect(beceGrade(50)).toBe(6);
    expect(beceGrade(49)).toBe(7);
    expect(beceGrade(34)).toBe(9);
    expect(beceGrade(0)).toBe(9);
  });
});

describe('beceProjection', () => {
  const cores = [
    mark('English Language', 85, true), // 2
    mark('Mathematics', 72, true), // 3
    mark('Integrated Science', 65, true), // 4
    mark('Social Studies', 91, true), // 1
  ];

  it('sums four cores and the best two electives', () => {
    const p = beceProjection([
      ...cores,
      mark('RME', 58), // 5
      mark('Ghanaian Language', 76), // 3  ← best elective
      mark('ICT', 52), // 6
    ]);
    // 2+3+4+1 core + 3+5 best electives = 18
    expect(p.aggregate).toBe(18);
    expect(p.gap).toBeNull();
  });

  it('says which cores are missing instead of inventing an aggregate', () => {
    const p = beceProjection([
      mark('English Language', 85, true),
      mark('RME', 58),
      mark('ICT', 60),
    ]);
    expect(p.aggregate).toBeNull();
    expect(p.gap).toContain('core');
  });

  it('needs two electives and says so', () => {
    const p = beceProjection([...cores, mark('RME', 58)]);
    expect(p.aggregate).toBeNull();
    expect(p.gap).toContain('elective');
  });
});

describe('wassceGrade', () => {
  it('maps the WAEC bands', () => {
    expect(wassceGrade(80)).toEqual({ grade: 'A1', points: 1 });
    expect(wassceGrade(50)).toEqual({ grade: 'C6', points: 6 });
    expect(wassceGrade(49)).toEqual({ grade: 'D7', points: 7 });
    expect(wassceGrade(10)).toEqual({ grade: 'F9', points: 9 });
  });
});

describe('wassceReadiness', () => {
  it('ready means credits in six subjects including English and Maths', () => {
    const r = wassceReadiness([
      mark('English Language', 62, true),
      mark('Core Mathematics', 55, true),
      mark('Integrated Science', 51, true),
      mark('Social Studies', 70, true),
      mark('Economics', 66),
      mark('Geography', 58),
    ]);
    expect(r.ready).toBe(true);
    expect(r.credits).toBe(6);
    // C4(62)=4 + C5(55)=5 + best four of the rest: B2(70)=2, B3(66)=3, C5(58)=5, C6(51)=6 → 25
    expect(r.aggregate).toBe(4 + 5 + 2 + 3 + 5 + 6);
  });

  it('a failed Maths blocks readiness however strong the rest', () => {
    const r = wassceReadiness([
      mark('English Language', 80, true),
      mark('Core Mathematics', 38, true), // E8 — no credit
      mark('Integrated Science', 75, true),
      mark('Social Studies', 75, true),
      mark('Economics', 75),
      mark('Geography', 75),
      mark('Government', 75),
    ]);
    expect(r.mathsCredit).toBe(false);
    expect(r.ready).toBe(false);
  });
});
