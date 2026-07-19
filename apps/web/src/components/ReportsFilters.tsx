'use client';

import { useRouter } from 'next/navigation';
import Combobox from './Combobox';
import DateRangeFilter from './DateRangeFilter';
import { listHref, one, type ListSearchParams } from '@/lib/list';

/**
 * Class and publication filters for the terminal-reports list.
 *
 * The class lives in the URL rather than in component state. It used to be local, which meant the
 * page could not be linked to, a refresh dropped back to whichever class happened to sort first,
 * and — once the list was paged — page 3 of one class became page 3 of another the moment the
 * selection changed. `listHref` drops `page` on every change here for exactly that reason.
 */
export default function ReportsFilters({
  classes,
  params,
}: {
  classes: { id: string; name: string; studentCount: number }[];
  params: ListSearchParams;
}) {
  const router = useRouter();
  const go = (changes: Record<string, string | undefined>) =>
    router.push(listHref('/reports', params, changes));

  return (
    <>
      <Combobox
        label="Class"
        className="w-full sm:w-56"
        allowClear={false}
        placeholder="Search classes…"
        options={classes.map((c) => ({
          value: c.id,
          label: c.name,
          hint: `${c.studentCount} student${c.studentCount === 1 ? '' : 's'}`,
        }))}
        value={one(params.classId) ?? ''}
        onChange={(v) => go({ classId: v || undefined })}
      />
      <Combobox
        label="Publication"
        className="w-full sm:w-44"
        clearLabel="All reports"
        placeholder="Search…"
        options={[
          { value: 'PUBLISHED', label: 'Published' },
          { value: 'UNPUBLISHED', label: 'Not published' },
        ]}
        value={one(params.status) ?? ''}
        onChange={(v) => go({ status: v || undefined })}
      />
      <DateRangeFilter base="/reports" params={params} label="Published between" />
    </>
  );
}
