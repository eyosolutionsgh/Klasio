import type { ClientHealth } from './health';

/**
 * Searching, filtering and paging the client list.
 *
 * Pure, so the awkward parts are testable: a page number past the end of a filtered list, a filter
 * that matches nothing, and the fact that the counts on the status chips must describe the whole
 * book rather than the page you happen to be looking at.
 *
 * ## Why this happens in memory
 *
 * Health is worked out from a licence and the newest heartbeat, so it exists nowhere in the
 * database to put in a WHERE clause. Computing it for every client on each page load is fine at
 * the scale this tool is for — a supplier with tens or hundreds of schools — and keeps health in
 * one place rather than duplicated into a column that can go stale.
 *
 * The ceiling is real, though: past a few thousand clients, denormalise health onto Client when a
 * licence is issued or a heartbeat arrives, and move this into SQL. `q` is already applied in the
 * query, which is what keeps the in-memory set small in the case that matters.
 */
export const PAGE_SIZE = 25;

/** Order of the status chips, and the order rows sort in. Most urgent first. */
export const HEALTH_ORDER: ClientHealth[] = [
  'ATTENTION',
  'EXPIRED',
  'SILENT',
  'EXPIRING',
  'UNLICENSED',
  'OK',
];

export interface Listed<T> {
  rows: T[];
  total: number;
  page: number;
  pageCount: number;
  from: number;
  to: number;
}

/**
 * Take the whole assessed set and return one page of it.
 *
 * `total` is the size of the *filtered* set, and the caller counts statuses separately across
 * everything — a chip reading "3" while its own filter shows 3 of 40 would be describing two
 * different things with one number.
 */
export function paginate<T>(all: T[], page: number, pageSize = PAGE_SIZE): Listed<T> {
  const total = all.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Clamped rather than trusted: `?page=99` after narrowing a filter is a normal thing to happen
  // with URL state and the back button, and an empty table would read as "nothing matched".
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * pageSize;
  const rows = all.slice(start, start + pageSize);

  return {
    rows,
    total,
    page: current,
    pageCount,
    from: total === 0 ? 0 : start + 1,
    to: start + rows.length,
  };
}

/** Tally every status across the whole set, so a chip says how many exist rather than how many show. */
export function countByHealth<T extends { health: ClientHealth }>(
  all: T[],
): Record<ClientHealth, number> {
  const counts = Object.fromEntries(HEALTH_ORDER.map((h) => [h, 0])) as Record<
    ClientHealth,
    number
  >;
  for (const row of all) counts[row.health] += 1;
  return counts;
}

/** Build a URL that keeps the filters already in play and changes one of them. */
export function withParams(
  current: Record<string, string | undefined>,
  changes: Record<string, string | number | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries({ ...current, ...changes })) {
    const value = raw === undefined || raw === null ? '' : String(raw);
    // A cleared filter leaves no trace, so "no filters" has exactly one URL rather than `?q=&status=`.
    if (!value) continue;
    // Page one is the default; writing it only makes every link longer.
    if (key === 'page' && value === '1') continue;
    params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/?${qs}` : '/';
}
