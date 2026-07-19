'use client';

import { useRouter } from 'next/navigation';
import Combobox from './Combobox';
import DateRangeFilter from './DateRangeFilter';
import { listHref, one, type ListSearchParams } from '@/lib/list';

/**
 * Level, class, subject, draft/published and upload-date filters for the resource library. The
 * page is a server component, so changing a filter navigates rather than mutating client state.
 *
 * Every control routes through `listHref`, which preserves the parameters it is not changing and
 * drops `page`. This used to rebuild the query string from the four filter props it was given,
 * which meant changing a level while searching threw the search term away — and narrowing a filter
 * while holding page 3 would land on an empty table that reads as "nothing here".
 */
export default function ResourceFilters({
  levels,
  classes,
  subjects,
  states,
  params,
}: {
  levels: { id: string; name: string }[];
  classes: { id: string; name: string; level: string }[];
  subjects: { id: string; name: string }[];
  states: { key: string; label: string }[];
  params: ListSearchParams;
}) {
  const router = useRouter();
  const go = (changes: Record<string, string | undefined>) =>
    router.push(listHref('/resources', params, changes));

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Combobox
        label="Level"
        className="w-full sm:w-48"
        clearLabel="All levels"
        placeholder="Search levels…"
        options={levels.map((l) => ({ value: l.id, label: l.name }))}
        value={one(params.levelId) ?? ''}
        onChange={(v) => go({ levelId: v || undefined })}
      />
      <Combobox
        label="Class"
        className="w-full sm:w-56"
        clearLabel="All classes"
        placeholder="Search classes…"
        options={classes.map((c) => ({
          value: c.id,
          label: c.name,
          hint: c.level !== c.name ? c.level : undefined,
        }))}
        value={one(params.classId) ?? ''}
        onChange={(v) => go({ classId: v || undefined })}
      />
      <Combobox
        label="Subject"
        className="w-full sm:w-56"
        clearLabel="All subjects"
        placeholder="Search subjects…"
        options={subjects.map((s) => ({ value: s.id, label: s.name }))}
        value={one(params.subjectId) ?? ''}
        onChange={(v) => go({ subjectId: v || undefined })}
      />
      <Combobox
        label="Status"
        className="w-full sm:w-44"
        clearLabel="Everything"
        placeholder="Search status…"
        options={states.map((s) => ({ value: s.key, label: s.label }))}
        value={one(params.published) ?? ''}
        onChange={(v) => go({ published: v || undefined })}
      />
      <DateRangeFilter base="/resources" params={params} label="Uploaded between" />
    </div>
  );
}
