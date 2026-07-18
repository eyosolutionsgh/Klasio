'use client';

import { useRouter } from 'next/navigation';
import Combobox from './Combobox';

/**
 * Status and class filters for the students register. The page itself is a server component, so
 * changing a filter navigates rather than mutating client state.
 */
export default function StudentFilters({
  status,
  classId,
  q,
  statuses,
  classes,
}: {
  status: string;
  classId?: string;
  q?: string;
  statuses: { key: string; label: string }[];
  classes: { id: string; name: string; level?: string; studentCount: number }[];
}) {
  const router = useRouter();

  function go(next: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    const merged = { status, classId, q, ...next };
    if (merged.classId) p.set('classId', merged.classId);
    if (merged.q) p.set('q', merged.q);
    p.set('status', merged.status ?? 'ACTIVE');
    router.push(`/students?${p}`);
  }

  return (
    <div className="flex flex-wrap gap-3">
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
        value={classId ?? ''}
        onChange={(v) => go({ classId: v || undefined })}
      />
    </div>
  );
}
