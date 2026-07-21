import { describe, expect, it } from 'vitest';
import { closedTermMessage, termAcceptsWrites } from './term-lifecycle';

describe('term lifecycle', () => {
  it('accepts writes while the term is open', () => {
    expect(termAcceptsWrites({ closedAt: null })).toBe(true);
  });

  it('refuses writes once the term is closed', () => {
    expect(termAcceptsWrites({ closedAt: new Date('2026-07-23') })).toBe(false);
  });

  it('treats a missing term as not writable', () => {
    // A write aimed at a term that does not exist must not fall through as "open".
    expect(termAcceptsWrites(null)).toBe(false);
    expect(termAcceptsWrites(undefined)).toBe(false);
  });

  it('names the term and the date, and says how to proceed', () => {
    const msg = closedTermMessage({ name: 'Term 2', closedAt: new Date('2026-04-01T00:00:00Z') });
    expect(msg).toContain('Term 2');
    expect(msg).toMatch(/April/);
    // A refusal a teacher cannot act on is a support call, so it has to name the way out.
    expect(msg).toMatch(/reopen the term/i);
  });

  it('still reads correctly when the close date is somehow absent', () => {
    const msg = closedTermMessage({ name: 'Term 1', closedAt: null });
    expect(msg).toContain('Term 1');
    expect(msg).not.toContain('undefined');
  });
});
