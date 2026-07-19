'use client';

import { useRouter } from 'next/navigation';
import Combobox from './Combobox';
import { listHref, one, type ListSearchParams } from '@/lib/list';

/**
 * The class filter over the defaulter list.
 *
 * There is deliberately no date range here. Arrears are cumulative — what a family owes is every
 * unpaid bill since they joined, netted against every payment — so "who owed money between March
 * and April" is not a question the ledger can answer, and a control that appeared to ask it would
 * produce a shortlist a bursar would then go and chase. The term is the as-of point, and the
 * overview above the list already names it.
 */
export default function FeeFilters({
  classes,
  params,
}: {
  classes: { id: string; name: string; level?: string; studentCount: number }[];
  params: ListSearchParams;
}) {
  const router = useRouter();
  const classId = one(params.classId) ?? '';

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Combobox
        label="Class"
        className="w-full sm:w-64"
        clearLabel="All classes"
        placeholder="Search classes…"
        options={classes.map((c) => ({
          value: c.id,
          label: c.name,
          hint: `${c.studentCount} student${c.studentCount === 1 ? '' : 's'}${
            c.level && c.level !== c.name ? ` · ${c.level}` : ''
          }`,
        }))}
        value={classId}
        onChange={(v) => router.push(listHref('/fees', params, { classId: v || undefined }))}
      />
    </div>
  );
}
