import { describe, expect, it } from 'vitest';
import type { ClientHealth } from './health';
import { countByHealth, hasRange, paginate, withParams, withinRange } from './list';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

describe('paging the client list', () => {
  it('returns the first page and reports the range', () => {
    const p = paginate(rows(60), 1, 25);
    expect(p.rows).toHaveLength(25);
    expect(p.total).toBe(60);
    expect(p.pageCount).toBe(3);
    expect([p.from, p.to]).toEqual([1, 25]);
  });

  it('returns a short last page', () => {
    const p = paginate(rows(60), 3, 25);
    expect(p.rows).toHaveLength(10);
    expect([p.from, p.to]).toEqual([51, 60]);
  });

  /**
   * The case URL state makes ordinary: you are on page 4, you narrow the filter, and page 4 no
   * longer exists. An empty table would read as "nothing matched" when the truth is "look at
   * page 1".
   */
  it('clamps a page past the end rather than showing nothing', () => {
    const p = paginate(rows(10), 99, 25);
    expect(p.page).toBe(1);
    expect(p.rows).toHaveLength(10);
  });

  /**
   * Clamped to the *last* page, not back to the first — it keeps you nearest where you were
   * looking. Worth pinning separately: the single-page case above passes either way, so it was
   * asserting a coincidence, and the E2E spec was written against the wrong guess because of it.
   */
  it('clamps to the last page that exists, not to the first', () => {
    const p = paginate(rows(60), 99, 25);
    expect(p.page).toBe(3);
    expect([p.from, p.to]).toEqual([51, 60]);
  });

  it('clamps a page below the start', () => {
    expect(paginate(rows(10), 0, 25).page).toBe(1);
    expect(paginate(rows(10), -3, 25).page).toBe(1);
  });

  it('survives a page that is not a number', () => {
    expect(paginate(rows(10), Number('abc'), 25).page).toBe(1);
  });

  it('reads sensibly when nothing matched', () => {
    const p = paginate(rows(0), 1, 25);
    expect([p.total, p.pageCount, p.from, p.to]).toEqual([0, 1, 0, 0]);
  });
});

describe('counting statuses', () => {
  /**
   * Counts describe the whole set, never the page. A chip reading "3" beside a table showing 3 of
   * 40 would be two different numbers wearing one label.
   */
  it('tallies every status across everything, including the empty ones', () => {
    const all = (['ATTENTION', 'OK', 'OK', 'SILENT'] as ClientHealth[]).map((health) => ({
      health,
    }));
    const counts = countByHealth(all);
    expect(counts.OK).toBe(2);
    expect(counts.ATTENTION).toBe(1);
    expect(counts.SILENT).toBe(1);
    expect(counts.EXPIRED).toBe(0);
  });
});

describe('building filter links', () => {
  it('keeps the filters already in play', () => {
    expect(withParams({ q: 'ridge' }, { status: 'EXPIRED' })).toBe('/?q=ridge&status=EXPIRED');
  });

  it('drops a filter that has been cleared, leaving a clean URL', () => {
    expect(withParams({ q: 'ridge', status: 'OK' }, { status: undefined })).toBe('/?q=ridge');
    expect(withParams({ q: 'ridge' }, { q: '' })).toBe('/');
  });

  /** Page one is the default, so writing it into the URL only makes links look busier. */
  it('leaves page 1 out of the URL', () => {
    expect(withParams({}, { page: 1 })).toBe('/');
    expect(withParams({}, { page: 3 })).toBe('/?page=3');
  });
});

describe('filtering by date', () => {
  const on = (iso: string) => new Date(iso);

  it('counts both named days in full', () => {
    const range = { from: '2026-07-01', to: '2026-07-31' };
    // The first instant of the opening day and the last of the closing one both belong.
    expect(withinRange(on('2026-07-01T00:00:00'), range)).toBe(true);
    expect(withinRange(on('2026-07-31T23:59:59'), range)).toBe(true);
    expect(withinRange(on('2026-06-30T23:59:59'), range)).toBe(false);
    expect(withinRange(on('2026-08-01T00:00:00'), range)).toBe(false);
  });

  /**
   * The trap this exists for: `new Date('2026-07-20')` is UTC midnight, so west of Greenwich it is
   * the 19th locally, and a licence expiring on the 20th drops out of a range naming the 20th.
   */
  it('reads a bound as the calendar day the vendor typed, not as UTC', () => {
    const oneDay = { from: '2026-07-20', to: '2026-07-20' };
    expect(withinRange(on('2026-07-20T00:00:00'), oneDay)).toBe(true);
    expect(withinRange(on('2026-07-20T12:00:00'), oneDay)).toBe(true);
    expect(withinRange(on('2026-07-20T23:59:00'), oneDay)).toBe(true);
    expect(withinRange(on('2026-07-19T23:59:00'), oneDay)).toBe(false);
  });

  it('treats a single bound as open at the other end', () => {
    expect(withinRange(on('2030-01-01T00:00:00'), { from: '2026-07-01' })).toBe(true);
    expect(withinRange(on('2020-01-01T00:00:00'), { from: '2026-07-01' })).toBe(false);
    expect(withinRange(on('2020-01-01T00:00:00'), { to: '2026-07-01' })).toBe(true);
    expect(withinRange(on('2030-01-01T00:00:00'), { to: '2026-07-01' })).toBe(false);
  });

  it('filters nothing when no bound was given', () => {
    expect(hasRange({})).toBe(false);
    expect(withinRange(on('2026-07-20T00:00:00'), {})).toBe(true);
    expect(withinRange(null, {})).toBe(true);
  });

  /** Asking what expires in October is asking about things that expire. */
  it('excludes a row with no date once a bound is set', () => {
    expect(withinRange(null, { from: '2026-07-01' })).toBe(false);
    expect(withinRange(undefined, { to: '2026-07-01' })).toBe(false);
  });

  /** A half-typed date must not quietly become a filter nobody asked for. */
  it('ignores a bound that is not a real day', () => {
    expect(hasRange({ from: '2026-07' })).toBe(false);
    expect(hasRange({ from: 'tomorrow' })).toBe(false);
    // The 31st of a 30-day month rolls into August by default; that would widen the range.
    expect(hasRange({ from: '2026-06-31' })).toBe(false);
    expect(withinRange(on('2020-01-01T00:00:00'), { from: '2026-06-31' })).toBe(true);
  });
});
