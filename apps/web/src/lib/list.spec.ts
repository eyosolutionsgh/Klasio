import { describe, expect, it } from 'vitest';
import { apiQuery, listHref, nsKey, nsParam } from './list';

describe('listHref', () => {
  it('preserves the parameters it is not changing', () => {
    // Sorting a filtered list must not silently drop the filter.
    const href = listHref('/students', { classId: 'c1', status: 'ACTIVE' }, { sort: 'name' });
    expect(href).toContain('classId=c1');
    expect(href).toContain('status=ACTIVE');
    expect(href).toContain('sort=name');
  });

  it('drops a key set to undefined, which is how "clear filter" is expressed', () => {
    expect(listHref('/students', { classId: 'c1' }, { classId: undefined })).toBe('/students');
  });

  /**
   * Landing on page 7 of a list that now has two pages shows an empty table, which reads as "no
   * results" rather than "you were holding a stale page number".
   */
  it('resets to page one when anything other than the page changes', () => {
    expect(listHref('/students', { page: '7' }, { status: 'ALUMNI' })).not.toContain('page=');
  });

  it('keeps the page when the page is what changed', () => {
    expect(listHref('/students', {}, { page: 3 })).toContain('page=3');
  });
});

describe('namespaced lists', () => {
  it('leaves the primary list on the bare keys so existing links keep working', () => {
    expect(nsKey('page')).toBe('page');
    expect(listHref('/x', {}, { page: 2 })).toBe('/x?page=2');
  });

  it('prefixes only the paging keys, never the filters', () => {
    expect(nsKey('perPage', 'inv')).toBe('invPerPage');
    const href = listHref('/x', {}, { page: 2, status: 'PENDING' }, 'inv');
    expect(href).toContain('invPage=2');
    // A filter key is already specific to its table and must not be renamed.
    expect(href).toContain('status=PENDING');
  });

  /**
   * The whole point. Two tables on one route sharing `?page=` means turning one turns the other,
   * and the second table's rows become as unreachable as if it were capped.
   */
  it('moves one table without disturbing the other', () => {
    const href = listHref('/platform/schools', { page: '3' }, { page: 2 }, 'inv');
    expect(href).toContain('page=3'); // the schools table stayed put
    expect(href).toContain('invPage=2');
  });

  it('scopes the page reset, so filtering one table does not rewind the other', () => {
    const href = listHref('/platform/schools', { page: '3', invPage: '4' }, { tier: 'MEDIUM' });
    expect(href).toContain('invPage=4'); // untouched
    expect(href).not.toContain('page=3'); // the list being filtered went back to the start
  });

  it('reads its own keys back', () => {
    const params = { page: '3', invPage: '4' };
    expect(nsParam(params, 'page')).toBe('3');
    expect(nsParam(params, 'page', 'inv')).toBe('4');
  });
});

describe('apiQuery', () => {
  it('forwards only the keys the endpoint declared, so a stray param is not a 400', () => {
    const qs = apiQuery({ classId: 'c1', somethingElse: 'x', page: '2' }, ['classId']);
    expect(qs).toContain('classId=c1');
    expect(qs).toContain('page=2');
    expect(qs).not.toContain('somethingElse');
  });

  /**
   * A namespace keeps two tables apart in one address bar; the endpoint only ever serves one of
   * them, so it still receives plain `page`.
   */
  it('sends a namespaced list to the API under the plain paging names', () => {
    const qs = apiQuery({ invPage: '2', invSort: 'usedAt', page: '9' }, [], {}, 'inv');
    expect(qs).toContain('page=2');
    expect(qs).toContain('sort=usedAt');
    expect(qs).not.toContain('invPage');
    expect(qs).not.toContain('page=9');
  });

  it('lets an explicit extra win, for a page-level default like the status tab', () => {
    expect(apiQuery({}, [], { status: 'ACTIVE' })).toBe('status=ACTIVE');
  });
});
