import { describe, expect, it } from 'vitest';
import { dateWindow, orderBy, pageArgs, toPage, DEFAULT_PER_PAGE, MAX_ROWS } from './list-query';

describe('pageArgs', () => {
  it('defaults to the first page', () => {
    expect(pageArgs({})).toEqual({
      skip: 0,
      take: DEFAULT_PER_PAGE,
      page: 1,
      perPage: DEFAULT_PER_PAGE,
    });
  });

  it('skips whole pages', () => {
    expect(pageArgs({ page: 3, perPage: 25 })).toMatchObject({ skip: 50, take: 25 });
  });

  it('caps perPage so a query string cannot ask for the whole table', () => {
    expect(pageArgs({ perPage: 100_000 }).take).toBe(100);
  });

  it('floors nonsense rather than producing a negative skip', () => {
    // A negative page would make Prisma throw; a stale or hand-edited URL should show page 1.
    expect(pageArgs({ page: -4 }).skip).toBe(0);
    expect(pageArgs({ perPage: 0 }).take).toBe(DEFAULT_PER_PAGE);
  });

  it('honours perPage=all up to the hard ceiling', () => {
    expect(pageArgs({ perPage: 'all' })).toMatchObject({ skip: 0, take: MAX_ROWS });
  });
});

describe('orderBy', () => {
  const allowed = { name: ['lastName', 'firstName'], className: 'classRoom.name' };
  const fallback = [{ createdAt: 'desc' }];
  const TIE = { id: 'asc' };

  it('maps an allowed column, defaulting to ascending', () => {
    expect(orderBy({ sort: 'name' }, allowed, fallback)).toEqual([
      { lastName: 'asc' },
      { firstName: 'asc' },
      TIE,
    ]);
  });

  it('nests a dotted path into a relation', () => {
    expect(orderBy({ sort: 'className', order: 'desc' }, allowed, fallback)).toEqual([
      { classRoom: { name: 'desc' } },
      TIE,
    ]);
  });

  /**
   * The point of the allowlist. `sort` arrives from a query string, so an unchecked value would be
   * spread straight into Prisma's orderBy — letting a caller order by, and therefore probe, a
   * relation the endpoint never meant to expose.
   */
  it('ignores a column that is not on the allowlist', () => {
    expect(orderBy({ sort: 'portalPinHash' }, allowed, fallback)).toEqual([...fallback, TIE]);
    expect(orderBy({ sort: 'school.owner.email' }, allowed, fallback)).toEqual([...fallback, TIE]);
  });

  it('falls back rather than throwing, so a stale bookmark still renders', () => {
    expect(orderBy({ sort: '' }, allowed, fallback)).toEqual([...fallback, TIE]);
    expect(orderBy({}, allowed, fallback)).toEqual([...fallback, TIE]);
  });

  it('accepts a bare object fallback as well as an array', () => {
    expect(orderBy({}, allowed, { createdAt: 'desc' })).toEqual([{ createdAt: 'desc' }, TIE]);
  });

  /**
   * The tiebreaker is the whole reason paging is trustworthy.
   *
   * Sorting by a non-unique column leaves the order among equal rows undefined, so Postgres may
   * answer two different OFFSETs inconsistently — a row shows up on two pages while another is
   * skipped and reachable from no page at all. This was reproducible on the deposit queue, where
   * a batch of rows shared `createdAt` to the millisecond.
   */
  it('always ends on a unique column so paging cannot drop or repeat a row', () => {
    for (const q of [{}, { sort: 'name' }, { sort: 'className', order: 'desc' as const }]) {
      const result = orderBy(q, allowed, fallback) as Record<string, unknown>[];
      expect(result.at(-1)).toEqual(TIE);
    }
  });
});

describe('dateWindow', () => {
  it('is undefined when neither end is given, so no filter is applied', () => {
    expect(dateWindow({})).toBeUndefined();
  });

  it('is open-ended when only one end is given', () => {
    expect(dateWindow({ from: '2026-01-05' })).toEqual({ gte: new Date('2026-01-05') });
    expect(dateWindow({ to: '2026-01-05' })?.gte).toBeUndefined();
  });

  /**
   * "To 12 August" means including the 12th. A bare `lte: 2026-08-12T00:00:00` excludes almost the
   * whole day, which reads as missing records rather than as a filter working correctly.
   */
  it('widens the end to the close of that day', () => {
    const end = dateWindow({ to: '2026-08-12' })!.lte!;
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getDate()).toBe(12);
  });
});

describe('toPage', () => {
  it('reports the total, not the page length', () => {
    expect(toPage([1, 2], 97, { page: 1, perPage: 25 })).toMatchObject({
      total: 97,
      pageCount: 4,
    });
  });

  it('reports one page when there is nothing, so the pager never renders "page 1 of 0"', () => {
    expect(toPage([], 0, { page: 1, perPage: 25 }).pageCount).toBe(1);
  });
});
