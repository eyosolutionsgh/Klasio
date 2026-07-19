'use client';

import { useRouter } from 'next/navigation';
import Combobox from './Combobox';
import DateRangeFilter from './DateRangeFilter';
import { listHref, one, type ListSearchParams } from '@/lib/list';

/**
 * Status and date filters for the SMS send log. The page is a server component, so changing a
 * filter navigates rather than mutating client state.
 *
 * Routes through `listHref`, which preserves the parameters it is not changing — including the
 * search term — and drops `page`. Filtering to failures while holding page 3 would otherwise show
 * an empty table, which on this screen reads as "nothing failed".
 */
export default function MessageFilters({ params }: { params: ListSearchParams }) {
  const router = useRouter();
  const status = one(params.status) ?? '';

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Combobox
        label="Status"
        className="w-full sm:w-48"
        clearLabel="All statuses"
        placeholder="Search…"
        options={[
          { value: 'SENT', label: 'Sent' },
          { value: 'FAILED', label: 'Failed' },
          { value: 'QUEUED', label: 'Queued' },
        ]}
        value={status}
        onChange={(v) => router.push(listHref('/messaging', params, { status: v || undefined }))}
      />
      <DateRangeFilter base="/messaging" params={params} label="Sent between" />
    </div>
  );
}
