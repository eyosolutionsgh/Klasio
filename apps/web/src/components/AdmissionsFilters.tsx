'use client';

import { useRouter } from 'next/navigation';
import Combobox from './Combobox';
import DateRangeFilter from './DateRangeFilter';
import { listHref, one, type ListSearchParams } from '@/lib/list';

/**
 * Stage and application-date filters for the admissions pipeline. The page is a server component,
 * so choosing a stage navigates rather than filtering in the browser.
 *
 * Every control routes through `listHref`, which preserves the parameters it is not changing and
 * drops `page`. It used to rebuild the query string from the two props it happened to be given,
 * which meant picking a stage while sorted by name silently threw the sort away — and narrowing to
 * a stage while holding page 4 would land on an empty table that reads as "no applications".
 */
export default function AdmissionsFilters({
  stages,
  params,
}: {
  stages: { key: string; label: string; count: number }[];
  params: ListSearchParams;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Combobox
        label="Stage"
        className="w-full sm:w-64"
        clearLabel="All stages"
        placeholder="Search stages…"
        options={stages.map((s) => ({
          value: s.key,
          label: s.label,
          hint: `${s.count} applicant${s.count === 1 ? '' : 's'}`,
        }))}
        value={one(params.stage) ?? ''}
        onChange={(v) => router.push(listHref('/admissions', params, { stage: v || undefined }))}
      />
      <DateRangeFilter base="/admissions" params={params} label="Applied between" />
    </div>
  );
}
