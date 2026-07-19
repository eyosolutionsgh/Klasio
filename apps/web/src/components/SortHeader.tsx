import Link from 'next/link';
import { listHref, one, type ListSearchParams } from '@/lib/list';

/**
 * A sortable column heading.
 *
 * Renders a `<th>` containing a link, so sorting is a navigation like every other list control.
 * The `aria-sort` attribute is what makes the arrow mean anything to a screen reader — the glyph
 * alone is decorative, and a column that is "sorted ascending" has to be announced as such.
 *
 * Clicking the active column flips the direction; clicking a new one starts at the column's own
 * natural direction. Names read best A–Z, but dates and amounts almost always want newest and
 * largest first, so `defaultOrder` lets each column say which it is instead of everything
 * starting ascending and needing a second click.
 */
export default function SortHeader({
  column,
  base,
  params,
  children,
  defaultOrder = 'asc',
  align = 'left',
  className = '',
}: {
  /** The `sort` value this column sends — must be on the endpoint's allowlist. */
  column: string;
  base: string;
  params: ListSearchParams;
  children: React.ReactNode;
  defaultOrder?: 'asc' | 'desc';
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  const active = one(params.sort) === column;
  const order = (one(params.order) as 'asc' | 'desc' | undefined) ?? 'asc';
  const next = active ? (order === 'asc' ? 'desc' : 'asc') : defaultOrder;
  const alignCls =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

  return (
    <th
      scope="col"
      aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-5 py-3 font-medium ${alignCls} ${className}`}
    >
      <Link
        href={listHref(base, params, { sort: column, order: next })}
        className={`group inline-flex items-center gap-1 rounded transition hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${active ? 'text-brand' : ''}`}
      >
        {children}
        <SortArrow active={active} order={order} />
        <span className="sr-only">
          {active
            ? `, sorted ${order === 'asc' ? 'ascending' : 'descending'}. Activate to sort ${
                next === 'asc' ? 'ascending' : 'descending'
              }`
            : `, not sorted. Activate to sort ${next === 'asc' ? 'ascending' : 'descending'}`}
        </span>
      </Link>
    </th>
  );
}

/**
 * The direction glyph. Idle columns show a faint double chevron that firms up on hover, so a
 * reader can tell which headings are sortable before clicking one and finding out.
 */
function SortArrow({ active, order }: { active: boolean; order: 'asc' | 'desc' }) {
  if (!active) {
    return (
      <svg
        width="0.85em"
        height="0.85em"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        focusable="false"
        className="opacity-30 transition group-hover:opacity-70"
      >
        <path d="m8 10 4-4 4 4M8 14l4 4 4-4" />
      </svg>
    );
  }
  return (
    <svg
      width="0.85em"
      height="0.85em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {order === 'asc' ? <path d="m6 14 6-6 6 6" /> : <path d="m6 10 6 6 6-6" />}
    </svg>
  );
}
