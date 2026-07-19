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
 * The parameters that belong to a list's own paging and sorting, rather than to its filters.
 * These are the ones a namespace has to rename; a filter key is already specific to its table.
 */
const PAGE_KEYS = ['page', 'perPage', 'sort', 'order', 'from', 'to'] as const;

/**
 * The URL key a list uses for one of its paging parameters.
 *
 * A route with two paged tables cannot let both read `?page=` — turning to page 2 of one would
 * turn the other with it, and the second table's rows would be as unreachable as if it were
 * capped. A namespace gives the second table its own keys (`invPage`, `invSort`…). The primary
 * list on a route passes no namespace and keeps the bare names, so URLs people have already
 * bookmarked keep working and the common case stays readable.
 */
export function nsKey(key: string, ns?: string): string {
  return ns ? `${ns}${key[0].toUpperCase()}${key.slice(1)}` : key;
}

/** Read one of a list's paging parameters, honouring its namespace. */
export function nsParam(
  current: ListSearchParams,
  key: (typeof PAGE_KEYS)[number],
  ns?: string,
): string | undefined {
  return one(current[nsKey(key, ns)]);
}

/**
 * Merge changes into the current search params and render a query string.
 *
 * Passing `undefined` for a key removes it, which is how a "clear filter" link is expressed.
 * Changing anything other than `page` resets to page 1 — landing on page 7 of a list that now has
 * two pages shows an empty table, and reads as "no results" rather than "you were holding a stale
 * page number".
 *
 * `ns` namespaces only the paging keys in `changes`; filter keys are passed through untouched, so
 * a caller writes `{ page: 2, status: 'PAID' }` the same way whichever table it is driving. It
 * also scopes the page reset — narrowing one table's filter must not throw the *other* table back
 * to its first page.
 */
export function listHref(
  base: string,
  current: ListSearchParams,
  changes: Record<string, string | number | undefined>,
  ns?: string,
): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v === undefined) continue;
    p.set(k, Array.isArray(v) ? (v[0] ?? '') : v);
  }
  const pageish = new Set<string>(PAGE_KEYS);
  for (const [k, v] of Object.entries(changes)) {
    const key = pageish.has(k) ? nsKey(k, ns) : k;
    if (v === undefined || v === '') p.delete(key);
    else p.set(key, String(v));
  }
  if (!('page' in changes)) p.delete(nsKey('page', ns));
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Turn a page's `searchParams` into the query string the API expects.
 *
 * Only keys the endpoint knows about are forwarded — the DTOs reject unknown properties, so
 * passing the raw params through would make any stray URL parameter a 400.
 *
 * A namespaced list reads `invPage` from the URL but still sends plain `page` to the API: the
 * namespace exists to keep two tables apart in one address bar, and the endpoint only ever serves
 * one of them.
 */
export function apiQuery(
  current: ListSearchParams,
  keys: string[],
  extra: Record<string, string | number | undefined> = {},
  ns?: string,
): string {
  const p = new URLSearchParams();
  for (const k of keys) {
    const v = one(current[k]);
    if (v) p.set(k, v);
  }
  for (const k of PAGE_KEYS) {
    const v = nsParam(current, k, ns);
    if (v) p.set(k, v);
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
