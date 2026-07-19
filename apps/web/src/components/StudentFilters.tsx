'use client';

import { useRouter } from 'next/navigation';
import Combobox from './Combobox';
import DateRangeFilter from './DateRangeFilter';
import { listHref, one, type ListSearchParams } from '@/lib/list';

/**
 * Status, class, gender and enrolment-date filters for the students register. The page itself is
 * a server component, so changing a filter navigates rather than mutating client state.
 *
 * Every control routes through `listHref`, which preserves the parameters it is not changing and
 * drops `page`. Narrowing a filter while holding page 4 would otherwise land on an empty table
 * that reads as "no matches" rather than "you were on a page that no longer exists".
 */
export default function StudentFilters({
  statuses,
  classes,
  params,
}: {
  statuses: { key: string; label: string }[];
  classes: { id: string; name: string; level?: string; studentCount: number }[];
  params: ListSearchParams;
}) {
  const router = useRouter();
  const go = (changes: Record<string, string | undefined>) =>
    router.push(listHref('/students', params, changes));

  const status = one(params.status) ?? 'ACTIVE';
  const classId = one(params.classId) ?? '';
  const gender = one(params.gender) ?? '';

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Combobox
        label="Status"
        className="w-full sm:w-52"
        allowClear={false}
        placeholder="Search status…"
        options={statuses.map((s) => ({ value: s.key, label: s.label }))}
        value={status}
        onChange={(v) => go({ status: v })}
      />
      <Combobox
        label="Class"
        className="w-full sm:w-64"
        clearLabel="All classes"
        placeholder="Search classes…"
        options={classes.map((c) => ({
          value: c.id,
          label: c.name,
          // Many classes are the only one in their level, so the names coincide — showing both
          // would just read "JHS 2 · JHS 2".
          hint: `${c.studentCount} student${c.studentCount === 1 ? '' : 's'}${
            c.level && c.level !== c.name ? ` · ${c.level}` : ''
          }`,
        }))}
        value={classId}
        onChange={(v) => go({ classId: v || undefined })}
      />
      <Combobox
        label="Gender"
        className="w-full sm:w-40"
        clearLabel="All"
        placeholder="Search…"
        options={[
          { value: 'MALE', label: 'Boys' },
          { value: 'FEMALE', label: 'Girls' },
        ]}
        value={gender}
        onChange={(v) => go({ gender: v || undefined })}
      />
      <DateRangeFilter base="/students" params={params} label="Enrolled between" />
    </div>
  );
}
