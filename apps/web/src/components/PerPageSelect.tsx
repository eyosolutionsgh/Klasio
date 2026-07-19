'use client';

import { useRouter } from 'next/navigation';
import { listHref, PER_PAGE_CHOICES, type ListSearchParams } from '@/lib/list';

/**
 * Rows-per-page. The only part of the pager that needs the client, because a `<select>` has to
 * navigate on change — everything else in Pagination is a link and stays on the server.
 *
 * Changing the size drops `page`: page 7 of a 25-row list is somewhere in the middle of page 2 of
 * a 100-row one, and there is no honest way to map it. Going back to the top is predictable.
 */
export default function PerPageSelect({
  base,
  params,
  perPage,
  ns,
}: {
  base: string;
  params: ListSearchParams;
  perPage: number;
  /** URL-key namespace, when this is the second paged table on a route. */
  ns?: string;
}) {
  const router = useRouter();
  return (
    <select
      value={String(perPage)}
      aria-label="Rows per page"
      onChange={(e) => router.push(listHref(base, params, { perPage: e.target.value }, ns))}
      className="rounded-md border border-mist bg-white px-2 py-1 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
    >
      {PER_PAGE_CHOICES.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}
