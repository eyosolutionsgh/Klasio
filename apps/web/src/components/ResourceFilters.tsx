'use client';

import { useRouter } from 'next/navigation';
import Combobox from './Combobox';

/**
 * Level, class, subject and draft/published filters for the resource library. The page is a
 * server component, so changing a filter navigates rather than mutating client state.
 */
export default function ResourceFilters({
  levelId,
  classId,
  subjectId,
  published,
  levels,
  classes,
  subjects,
  states,
}: {
  levelId?: string;
  classId?: string;
  subjectId?: string;
  published?: string;
  levels: { id: string; name: string }[];
  classes: { id: string; name: string; level: string }[];
  subjects: { id: string; name: string }[];
  states: { key: string; label: string }[];
}) {
  const router = useRouter();

  function go(next: Record<string, string | undefined>) {
    const merged = { levelId, classId, subjectId, published, ...next };
    const p = new URLSearchParams();
    if (merged.levelId) p.set('levelId', merged.levelId);
    if (merged.classId) p.set('classId', merged.classId);
    if (merged.subjectId) p.set('subjectId', merged.subjectId);
    if (merged.published) p.set('published', merged.published);
    router.push(`/resources?${p}`);
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Combobox
        label="Level"
        className="w-full sm:w-48"
        clearLabel="All levels"
        placeholder="Search levels…"
        options={levels.map((l) => ({ value: l.id, label: l.name }))}
        value={levelId ?? ''}
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
        value={classId ?? ''}
        onChange={(v) => go({ classId: v || undefined })}
      />
      <Combobox
        label="Subject"
        className="w-full sm:w-56"
        clearLabel="All subjects"
        placeholder="Search subjects…"
        options={subjects.map((s) => ({ value: s.id, label: s.name }))}
        value={subjectId ?? ''}
        onChange={(v) => go({ subjectId: v || undefined })}
      />
      <Combobox
        label="Status"
        className="w-full sm:w-44"
        clearLabel="Everything"
        placeholder="Search status…"
        options={states.map((s) => ({ value: s.key, label: s.label }))}
        value={published ?? ''}
        onChange={(v) => go({ published: v || undefined })}
      />
    </div>
  );
}
