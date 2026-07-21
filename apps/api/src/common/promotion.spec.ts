import { describe, expect, it } from 'vitest';
import { ClassLike, isFinalClass, suggestNextClass } from './promotion';

const cls = (id: string, name: string, levelOrder: number): ClassLike => ({
  id,
  name,
  levelId: `level-${levelOrder}`,
  levelOrder,
});

describe('promotion suggestions', () => {
  const b5 = cls('b5', 'Basic 5', 5);
  const b6 = cls('b6', 'Basic 6', 6);
  const jhs1 = cls('j1', 'JHS 1', 7);

  it('suggests the only class in the next level up', () => {
    expect(suggestNextClass(b5, [b5, b6, jhs1])?.id).toBe('b6');
  });

  it('skips a gap in level order rather than giving up', () => {
    // A school with no Basic 6 still promotes Basic 5 somewhere: the next level that exists.
    expect(suggestNextClass(b5, [b5, jhs1])?.id).toBe('j1');
  });

  it('keeps a child in their stream when the next level has several classes', () => {
    const gold5 = cls('g5', 'Basic 5 Gold', 5);
    const gold6 = cls('g6', 'Basic 6 Gold', 6);
    const blue6 = cls('bl6', 'Basic 6 Blue', 6);
    expect(suggestNextClass(gold5, [gold5, blue6, gold6])?.id).toBe('g6');
  });

  it('falls back to a stable choice when no stream matches', () => {
    const b5plain = cls('b5', 'Basic 5', 5);
    const blue6 = cls('bl6', 'Basic 6 Blue', 6);
    const gold6 = cls('g6', 'Basic 6 Gold', 6);
    // Alphabetical, so the same roll suggests the same class on a second run.
    expect(suggestNextClass(b5plain, [b5plain, gold6, blue6])?.id).toBe('bl6');
    expect(suggestNextClass(b5plain, [b5plain, blue6, gold6])?.id).toBe('bl6');
  });

  it('suggests nothing above the final class', () => {
    expect(suggestNextClass(jhs1, [b5, b6, jhs1])).toBeNull();
    expect(isFinalClass(jhs1, [b5, b6, jhs1])).toBe(true);
    expect(isFinalClass(b5, [b5, b6, jhs1])).toBe(false);
  });

  it('does not treat a numbered class name as a stream', () => {
    // "Basic 6" must not be read as being in stream "6" and matched against "JHS 6".
    const a = cls('a', 'Basic 6', 6);
    const x = cls('x', 'JHS 1', 7);
    const y = cls('y', 'JHS 1 Alpha', 7);
    expect(suggestNextClass(a, [a, x, y])?.id).toBe('x');
  });
});
