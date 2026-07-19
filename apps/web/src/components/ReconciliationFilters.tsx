'use client';

import { useRouter } from 'next/navigation';
import Combobox from './Combobox';
import DateRangeFilter from './DateRangeFilter';
import { listHref, one, type ListSearchParams } from '@/lib/list';

/**
 * File, state and import-date filters for the exception queue. The page is a server component, so
 * changing a filter navigates rather than mutating client state.
 *
 * Every control routes through `listHref` rather than rebuilding the query string by hand. The
 * hand-rolled version listed the two parameters it knew about and dropped everything else, so
 * changing the state filter while sorted by amount silently threw the sort away — and, once the
 * queue was paged, would have kept the reader on page 4 of a list that had just become one page.
 */
export default function ReconciliationFilters({
  params,
  batches,
  states,
}: {
  params: ListSearchParams;
  batches: { id: string; label: string; hint: string }[];
  states: { key: string; label: string }[];
}) {
  const router = useRouter();
  const go = (changes: Record<string, string | undefined>) =>
    router.push(listHref('/settings/reconciliation', params, changes));

  const batchId = one(params.batchId) ?? '';
  const status = one(params.status) ?? '';

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Combobox
        label="File"
        className="w-full sm:w-64"
        clearLabel="Every import"
        placeholder="Search imports…"
        options={batches.map((b) => ({ value: b.id, label: b.label, hint: b.hint }))}
        value={batchId}
        onChange={(v) => go({ batchId: v || undefined })}
      />
      <Combobox
        label="State"
        className="w-full sm:w-52"
        // Matches the API's own default: the two states that still want a human.
        clearLabel="Still open"
        placeholder="Search states…"
        options={states.map((s) => ({ value: s.key, label: s.label }))}
        value={status}
        onChange={(v) => go({ status: v || undefined })}
      />
      <DateRangeFilter base="/settings/reconciliation" params={params} label="Imported between" />
    </div>
  );
}
