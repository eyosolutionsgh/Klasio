import { describe, expect, it } from 'vitest';
import {
  amountFor,
  concessionsFor,
  rankSiblings,
  ruleApplies,
  type FamilyMember,
  type Rule,
  type StudentContext,
} from './concessions';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-07-18T10:00:00Z');

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  name: 'Test rule',
  kind: 'SIBLING',
  basis: 'PERCENT',
  value: 10,
  active: true,
  ...over,
});

const ctx = (over: Partial<StudentContext> = {}): StudentContext => ({
  studentId: 's1',
  levelId: 'lvl-jhs',
  siblingRank: 1,
  awardedRuleIds: [],
  ...over,
});

describe('ruleApplies', () => {
  it('spares the eldest and applies from the second child', () => {
    const r = rule({ fromSibling: 2 });
    expect(ruleApplies(r, ctx({ siblingRank: 1 }), NOW)).toBe(false);
    expect(ruleApplies(r, ctx({ siblingRank: 2 }), NOW)).toBe(true);
    expect(ruleApplies(r, ctx({ siblingRank: 5 }), NOW)).toBe(true);
  });

  it('honours a school that starts its sibling discount at the third child', () => {
    const r = rule({ fromSibling: 3 });
    expect(ruleApplies(r, ctx({ siblingRank: 2 }), NOW)).toBe(false);
    expect(ruleApplies(r, ctx({ siblingRank: 3 }), NOW)).toBe(true);
  });

  it('defaults a sibling rule to the second child when unset', () => {
    expect(ruleApplies(rule({ fromSibling: null }), ctx({ siblingRank: 2 }), NOW)).toBe(true);
    expect(ruleApplies(rule({ fromSibling: null }), ctx({ siblingRank: 1 }), NOW)).toBe(false);
  });

  it('reaches a scholarship only where it was actually awarded', () => {
    const r = rule({ id: 'sch', kind: 'SCHOLARSHIP' });
    expect(ruleApplies(r, ctx(), NOW)).toBe(false);
    expect(ruleApplies(r, ctx({ awardedRuleIds: ['sch'] }), NOW)).toBe(true);
  });

  it('ignores sibling rank for a scholarship — an only child can hold one', () => {
    const r = rule({ id: 'sch', kind: 'SCHOLARSHIP' });
    expect(ruleApplies(r, ctx({ siblingRank: 1, awardedRuleIds: ['sch'] }), NOW)).toBe(true);
  });

  it('respects a level restriction', () => {
    const r = rule({ levelId: 'lvl-kg', fromSibling: 2 });
    expect(ruleApplies(r, ctx({ siblingRank: 2, levelId: 'lvl-jhs' }), NOW)).toBe(false);
    expect(ruleApplies(r, ctx({ siblingRank: 2, levelId: 'lvl-kg' }), NOW)).toBe(true);
  });

  it('ignores an inactive rule', () => {
    expect(ruleApplies(rule({ active: false, fromSibling: 2 }), ctx({ siblingRank: 2 }), NOW)).toBe(
      false,
    );
  });

  it('respects the award window at both ends, inclusive of the last day', () => {
    const r = rule({ fromSibling: 2, startsOn: at('2026-09-01'), endsOn: at('2026-12-20') });
    const c = ctx({ siblingRank: 2 });
    expect(ruleApplies(r, c, at('2026-08-31T12:00:00Z'))).toBe(false);
    expect(ruleApplies(r, c, at('2026-09-01T08:00:00Z'))).toBe(true);
    // A scholarship "until 20 December" must still cover the 20th.
    expect(ruleApplies(r, c, at('2026-12-20T18:00:00Z'))).toBe(true);
    expect(ruleApplies(r, c, at('2026-12-21T08:00:00Z'))).toBe(false);
  });
});

describe('amountFor', () => {
  it('takes a percentage of the bill', () => {
    expect(amountFor(rule({ basis: 'PERCENT', value: 25 }), 800)).toBe(200);
  });

  it('takes a flat amount', () => {
    expect(amountFor(rule({ basis: 'AMOUNT', value: 150 }), 800)).toBe(150);
  });

  it('never exceeds the bill', () => {
    expect(amountFor(rule({ basis: 'AMOUNT', value: 5000 }), 800)).toBe(800);
    expect(amountFor(rule({ basis: 'PERCENT', value: 500 }), 800)).toBe(800);
  });

  it('is nothing on a zero or negative bill', () => {
    expect(amountFor(rule({ basis: 'PERCENT', value: 50 }), 0)).toBe(0);
    expect(amountFor(rule({ basis: 'AMOUNT', value: 50 }), -100)).toBe(0);
  });

  it('treats a negative rule value as nothing rather than a charge', () => {
    expect(amountFor(rule({ basis: 'AMOUNT', value: -50 }), 800)).toBe(0);
  });

  it('rounds to the pesewa', () => {
    expect(amountFor(rule({ basis: 'PERCENT', value: 33.33 }), 1000)).toBe(333.3);
  });
});

describe('concessionsFor', () => {
  const scholarship = rule({ id: 'sch', name: 'Bursary', kind: 'SCHOLARSHIP', value: 50 });
  const sibling = rule({ id: 'sib', name: 'Sibling', fromSibling: 2, value: 10 });

  it('stacks a scholarship and a sibling discount off the original bill', () => {
    // "50% scholarship and 10% sibling" means 60% off, not 55% — the second is not applied to
    // what is left after the first.
    const { applied, total } = concessionsFor(
      [scholarship, sibling],
      ctx({ siblingRank: 2, awardedRuleIds: ['sch'] }),
      1000,
      NOW,
    );
    expect(applied.map((a) => a.amount)).toEqual([500, 100]);
    expect(total).toBe(600);
  });

  it('gives nothing to an eldest child with no award', () => {
    expect(concessionsFor([scholarship, sibling], ctx({ siblingRank: 1 }), 1000, NOW)).toEqual({
      applied: [],
      total: 0,
    });
  });

  it('never lets concessions exceed the bill', () => {
    // Otherwise the ledger would owe the family money, and it is not a way to pay anyone.
    const big = rule({ id: 'a', name: 'Full', basis: 'PERCENT', value: 100, kind: 'SCHOLARSHIP' });
    const { applied, total } = concessionsFor(
      [big, sibling],
      ctx({ siblingRank: 2, awardedRuleIds: ['a'] }),
      1000,
      NOW,
    );
    expect(total).toBe(1000);
    expect(applied).toHaveLength(1);
  });

  it('truncates the smallest when the cap bites', () => {
    const eighty = rule({ id: 'a', name: 'Eighty', value: 80, kind: 'SCHOLARSHIP' });
    const forty = rule({ id: 'b', name: 'Forty', value: 40, kind: 'SCHOLARSHIP' });
    const { applied } = concessionsFor(
      [forty, eighty],
      ctx({ awardedRuleIds: ['a', 'b'] }),
      1000,
      NOW,
    );
    expect(applied.map((a) => [a.name, a.amount])).toEqual([
      ['Eighty', 800],
      ['Forty', 200],
    ]);
  });

  it('is deterministic when two rules are worth the same', () => {
    const a = rule({ id: 'aaa', name: 'A', value: 10, kind: 'SCHOLARSHIP' });
    const b = rule({ id: 'bbb', name: 'B', value: 10, kind: 'SCHOLARSHIP' });
    const run = () =>
      concessionsFor([b, a], ctx({ awardedRuleIds: ['aaa', 'bbb'] }), 1000, NOW).applied.map(
        (x) => x.ruleId,
      );
    expect(run()).toEqual(['aaa', 'bbb']);
    expect(run()).toEqual(run());
  });

  it('gives nothing on a bill of zero', () => {
    expect(concessionsFor([scholarship], ctx({ awardedRuleIds: ['sch'] }), 0, NOW).total).toBe(0);
  });
});

describe('rankSiblings', () => {
  const kid = (id: string, enrolled: string, adm: string): FamilyMember => ({
    studentId: id,
    enrolledOn: at(enrolled),
    admissionNo: adm,
  });

  it('ranks by enrolment, earliest first', () => {
    const ranks = rankSiblings([
      kid('b', '2024-09-01', 'BA-0020'),
      kid('a', '2022-09-01', 'BA-0005'),
      kid('c', '2026-09-01', 'BA-0044'),
    ]);
    expect([ranks.get('a'), ranks.get('b'), ranks.get('c')]).toEqual([1, 2, 3]);
  });

  it('does not re-rank existing children when a younger sibling joins', () => {
    // Otherwise the discount would move from one child to another mid-year.
    const existing = [kid('a', '2022-09-01', 'BA-0005'), kid('b', '2024-09-01', 'BA-0020')];
    const before = rankSiblings(existing);
    const after = rankSiblings([...existing, kid('c', '2026-09-01', 'BA-0044')]);
    expect(after.get('a')).toBe(before.get('a'));
    expect(after.get('b')).toBe(before.get('b'));
    expect(after.get('c')).toBe(3);
  });

  it('breaks a same-day tie stably by admission number', () => {
    // Twins enrolled the same day must still rank consistently between runs.
    const twins = [kid('y', '2024-09-01', 'BA-0031'), kid('x', '2024-09-01', 'BA-0030')];
    expect(rankSiblings(twins).get('x')).toBe(1);
    expect(rankSiblings([...twins].reverse()).get('x')).toBe(1);
  });

  it('ranks an only child first', () => {
    expect(rankSiblings([kid('a', '2024-09-01', 'BA-0001')]).get('a')).toBe(1);
  });

  it('handles an empty family', () => {
    expect(rankSiblings([]).size).toBe(0);
  });
});
