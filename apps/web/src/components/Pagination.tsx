import Link from 'next/link';
import PerPageSelect from './PerPageSelect';
import { listHref, type ListSearchParams, type Page } from '@/lib/list';

/**
 * The pager under a list.
 *
 * Links, not buttons — the lists are server components, so a page change is a navigation. That
 * also means a page of results can be bookmarked and shared, and the back button does what a
 * reader expects.
 *
 * It renders even on a single page, because the row count is the point: "23 records" is the
 * answer to "did the filter work", and hiding the whole strip when everything fits takes that
 * away exactly when the list is short enough to doubt.
 */
export default function Pagination({
  page,
  base,
  params,
  label = 'records',
  ns,
}: {
  page: Pick<Page<unknown>, 'total' | 'page' | 'perPage' | 'pageCount'>;
  base: string;
  params: ListSearchParams;
  /** Plural noun for the count — "students", "payments". */
  label?: string;
  /**
   * URL-key namespace, for the second paged table on a route. Without one both tables read
   * `?page=` and turn together. See `nsKey` in `@/lib/list`.
   */
  ns?: string;
}) {
  const { total, pageCount } = page;
  const current = Math.min(page.page, pageCount);
  const first = total === 0 ? 0 : (current - 1) * page.perPage + 1;
  const last = Math.min(current * page.perPage, total);

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 border-t border-mist px-4 py-3 text-sm sm:px-5"
      aria-label="Pagination"
    >
      <p className="text-oat">
        {total === 0 ? (
          <>No {label}</>
        ) : (
          <>
            <span className="tabular">
              {first}–{last}
            </span>{' '}
            of <span className="tabular font-medium text-ink">{total}</span> {label}
          </>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-oat">
          <span className="hidden sm:inline">Rows</span>
          <PerPageSelect base={base} params={params} perPage={page.perPage} ns={ns} />
        </div>

        <div className="flex items-center gap-1">
          <PageLink
            base={base}
            params={params}
            to={current - 1}
            disabled={current <= 1}
            rel="prev"
            ns={ns}
          >
            <span aria-hidden>‹</span>
            <span className="sr-only">Previous page</span>
          </PageLink>

          {pageNumbers(current, pageCount).map((n, i) =>
            n === null ? (
              <span key={`gap-${i}`} className="px-1.5 text-oat" aria-hidden>
                …
              </span>
            ) : (
              <PageLink
                key={n}
                base={base}
                params={params}
                to={n}
                current={n === current}
                disabled={false}
                ns={ns}
              >
                <span className="tabular">{n}</span>
                <span className="sr-only"> page {n}</span>
              </PageLink>
            ),
          )}

          <PageLink
            base={base}
            params={params}
            to={current + 1}
            disabled={current >= pageCount}
            rel="next"
            ns={ns}
          >
            <span aria-hidden>›</span>
            <span className="sr-only">Next page</span>
          </PageLink>
        </div>
      </div>
    </nav>
  );
}

/**
 * Which page numbers to show: always the first and last, a window around the current one, and an
 * ellipsis for the gaps. A school with forty pages of alumni cannot have forty links.
 */
function pageNumbers(current: number, count: number): (number | null)[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const out: (number | null)[] = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(count - 1, current + 1);
  if (from > 2) out.push(null);
  for (let n = from; n <= to; n++) out.push(n);
  if (to < count - 1) out.push(null);
  out.push(count);
  return out;
}

function PageLink({
  base,
  params,
  to,
  disabled,
  current,
  rel,
  ns,
  children,
}: {
  base: string;
  params: ListSearchParams;
  to: number;
  disabled: boolean;
  current?: boolean;
  rel?: string;
  ns?: string;
  children: React.ReactNode;
}) {
  const cls =
    'inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm transition';
  if (disabled) {
    // A dead end is a <span>, not a disabled link — there is nothing to focus and nothing to
    // announce, and a link to the page you are already on is a trap for a screen-reader user.
    return (
      <span className={`${cls} border-mist/60 text-oat/50`} aria-hidden>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={listHref(base, params, { page: to === 1 ? undefined : to }, ns)}
      rel={rel}
      aria-current={current ? 'page' : undefined}
      className={
        current
          ? `${cls} border-brand bg-brand text-white font-medium`
          : `${cls} border-mist text-ink hover:bg-brand-mist hover:border-brand/40`
      }
    >
      {children}
    </Link>
  );
}
