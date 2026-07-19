/**
 * Client-free helpers for the paged/sorted list URLs.
 *
 * The portal's lists are server components, so a filter, a sort and a page are all just links —
 * there is no client data layer to hold list state. That makes the URL the single source of
 * truth, and it means every one of these helpers has to *preserve* the parameters it is not
 * changing. Sorting a filtered list must not silently drop the filter.
 */

export const DEFAULT_PER_PAGE = 25;
export const PER_PAGE_CHOICES = [10, 25, 50, 100];

/** The envelope every list endpoint returns. Mirrors `Page<T>` in the API's `common/list-query.ts`. */
export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
}

/** What a portal list page receives as `searchParams`, before its own filters are added. */
export type ListSearchParams = Record<string, string | string[] | undefined>;

/**
 * Merge changes into the current search params and render a query string.
 *
 * Passing `undefined` for a key removes it, which is how a "clear filter" link is expressed.
 * Changing anything other than `page` resets to page 1 — landing on page 7 of a list that now has
 * two pages shows an empty table, and reads as "no results" rather than "you were holding a stale
 * page number".
 */
export function listHref(
  base: string,
  current: ListSearchParams,
  changes: Record<string, string | number | undefined>,
): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v === undefined) continue;
    p.set(k, Array.isArray(v) ? (v[0] ?? '') : v);
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined || v === '') p.delete(k);
    else p.set(k, String(v));
  }
  if (!('page' in changes)) p.delete('page');
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Turn a page's `searchParams` into the query string the API expects.
 *
 * Only keys the endpoint knows about are forwarded — the DTOs reject unknown properties, so
 * passing the raw params through would make any stray URL parameter a 400.
 */
export function apiQuery(
  current: ListSearchParams,
  keys: string[],
  extra: Record<string, string | number | undefined> = {},
): string {
  const p = new URLSearchParams();
  for (const k of [...keys, 'page', 'perPage', 'sort', 'order', 'from', 'to']) {
    const v = current[k];
    const one = Array.isArray(v) ? v[0] : v;
    if (one) p.set(k, one);
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  return p.toString();
}

/** Read a single search param, collapsing the array form Next.js uses for repeats. */
export function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
