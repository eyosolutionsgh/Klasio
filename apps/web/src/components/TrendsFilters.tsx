'use client';

import { useRouter } from 'next/navigation';
import Combobox from './Combobox';
import DateRangeFilter from './DateRangeFilter';
import { listHref, one, type ListSearchParams } from '@/lib/list';

/**
 * Class and marked-date filters for the attendance patterns page.
 *
 * The page itself is a server component, so a filter is a navigation rather than client state —
 * which is what lets a head teacher send someone the URL of "JHS 2, the fortnight after half term"
 * instead of describing which boxes to tick.
 *
 * Both controls route through `listHref`, which keeps the parameters they are not changing and
 * drops `page`. Narrowing to one class while holding page 3 of the whole school's chronic list
 * would otherwise land on an empty table reading as "nobody here", not "that page is gone".
 */
export default function TrendsFilters({
  classes,
  params,
}: {
  classes: { id: string; name: string; studentCount: number }[];
  params: ListSearchParams;
}) {
  const router = useRouter();
  const classId = one(params.classId) ?? '';

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Combobox
        label="Class"
        className="w-full sm:w-64"
        clearLabel="Every class"
        placeholder="Search classes…"
        options={classes.map((c) => ({
          value: c.id,
          label: c.name,
          hint: `${c.studentCount} student${c.studentCount === 1 ? '' : 's'}`,
        }))}
        value={classId}
        onChange={(v) =>
          router.push(listHref('/attendance/trends', params, { classId: v || undefined }))
        }
      />
      {/*
        The window narrows which registers are counted, not which children are listed — so the
        label says "marked between" rather than anything about the pupils.
      */}
      <DateRangeFilter base="/attendance/trends" params={params} label="Registers marked between" />
    </div>
  );
}
