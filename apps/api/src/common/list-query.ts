/**
 * Shared paging, sorting and date-range plumbing for every list endpoint.
 *
 * Lists used to return a bare array capped at a hard `take` — 200 students, 100 messages, 50
 * ledger entries. That cap is invisible from the outside: a school with 900 children saw 200 and
 * had no way to know the other 700 existed. Paging replaces a silent truncation with an honest
 * one, so the shape has to carry the total as well as the rows.
 *
 * Every list endpoint therefore returns a `Page<T>` envelope rather than `T[]`. Callers that want
 * the whole set (exports, the print sheets, the workers) pass `perPage: 'all'` and get it — the
 * envelope is about telling the truth to a screen, not about withholding rows from a report.
 */
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min, IsDateString } from 'class-validator';

/** The wire shape of every list response. */
export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
}

export const PER_PAGE_CHOICES = [10, 25, 50, 100] as const;
export const DEFAULT_PER_PAGE = 25;
/**
 * A ceiling for `perPage: 'all'`. Unbounded means one school with a decade of ledger entries can
 * exhaust the API's memory from an unauthenticated-shaped request, so "all" means "all, up to a
 * number no real school exceeds in one term" rather than literally unbounded.
 */
export const MAX_ROWS = 10_000;

/**
 * Base DTO for a paged, sorted list request.
 *
 * Query strings are all strings, so every numeric field needs `@Transform` before validation —
 * class-validator's `@IsInt` runs against the raw value, and `?page=2` would otherwise fail as a
 * string. Modules extend this and add their own filters.
 */
export class PageQuery {
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  page?: number;

  /**
   * `all` is deliberately part of the type rather than a separate flag: an export and a screen ask
   * the same question and differ only in how many rows they can show.
   */
  @IsOptional()
  @Transform(({ value }) =>
    value === 'all' ? 'all' : value === undefined || value === '' ? undefined : Number(value),
  )
  perPage?: number | 'all';

  @IsOptional()
  @IsString()
  sort?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  /** Inclusive start of the date window. Which column it filters is the module's business. */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Inclusive end — see `dateWindow`, which widens this to the end of the named day. */
  @IsOptional()
  @IsDateString()
  to?: string;
}

/** Resolve `page`/`perPage` into Prisma's `skip`/`take`. */
export function pageArgs(q: PageQuery): {
  skip: number;
  take: number;
  page: number;
  perPage: number;
} {
  if (q.perPage === 'all') return { skip: 0, take: MAX_ROWS, page: 1, perPage: MAX_ROWS };
  const perPage = Math.min(Math.max(Number(q.perPage) || DEFAULT_PER_PAGE, 1), 100);
  const page = Math.max(q.page ?? 1, 1);
  return { skip: (page - 1) * perPage, take: perPage, page, perPage };
}

/**
 * Turn a requested sort into a Prisma `orderBy`, against an allowlist.
 *
 * The allowlist is not politeness — `sort` arrives from a query string and is spread straight into
 * `orderBy`, so an unchecked value lets a caller order by (and therefore probe) a relation the
 * endpoint never meant to expose. Anything not on the list falls back to the column the endpoint
 * chose, rather than throwing: a stale bookmark should show the list, not an error.
 *
 * Values may be dotted for a relation — `classRoom.name` becomes `{ classRoom: { name: 'asc' } }`.
 *
 * Callers name `T` explicitly as the model's Prisma `…OrderByWithRelationInput`. Left to infer it
 * from the fallback, TypeScript widens `'asc'` in the literal to `string` and Prisma then rejects
 * the whole `findMany` — with an error about the *result* type, not about the sort.
 *
 * **Every result ends with `id` as a tiebreaker.** Almost nothing a reader wants to sort by is
 * unique — a status, a tier, an amount, a `createdAt` shared by every row of one import batch —
 * and `ORDER BY` on a non-unique column leaves the order among ties undefined. Postgres is then
 * free to answer `OFFSET 0` and `OFFSET 2` inconsistently, so a row appears on two pages while
 * another is skipped and can be reached from no page at all. That is silent data loss on a
 * screen that looks completely healthy, and it was reproducible on the deposit queue before this
 * was added.
 */
export function orderBy<T>(
  q: PageQuery,
  allowed: Record<string, string | string[]>,
  fallback: T | T[],
): T | T[] {
  const key = q.sort && q.sort in allowed ? q.sort : undefined;
  const dir = q.order ?? 'asc';
  const build = (path: string): Record<string, unknown> =>
    path
      .split('.')
      .reverse()
      .reduce<Record<string, unknown>>((acc, seg, i) => ({ [seg]: i === 0 ? dir : acc }), {});

  const chosen = key
    ? (() => {
        const paths = allowed[key];
        return Array.isArray(paths) ? paths.map(build) : [build(paths)];
      })()
    : Array.isArray(fallback)
      ? [...(fallback as unknown[])]
      : [fallback as unknown];

  return [...chosen, { id: 'asc' }] as T[];
}

/**
 * Build a Prisma date filter from `from`/`to`.
 *
 * `to` is widened to the end of that day. A user who types 12 August into a "to" box means
 * "including the 12th"; `lte: 2026-08-12T00:00:00Z` silently excludes almost all of it, which
 * reads as missing records rather than as a filter working correctly.
 */
export function dateWindow(q: PageQuery): { gte?: Date; lte?: Date } | undefined {
  if (!q.from && !q.to) return undefined;
  const window: { gte?: Date; lte?: Date } = {};
  if (q.from) window.gte = new Date(q.from);
  if (q.to) {
    const end = new Date(q.to);
    end.setHours(23, 59, 59, 999);
    window.lte = end;
  }
  return window;
}

/** Wrap rows and a total count into the envelope. */
export function toPage<T>(
  rows: T[],
  total: number,
  args: { page: number; perPage: number },
): Page<T> {
  return {
    rows,
    total,
    page: args.page,
    perPage: args.perPage,
    pageCount: Math.max(Math.ceil(total / args.perPage), 1),
  };
}
