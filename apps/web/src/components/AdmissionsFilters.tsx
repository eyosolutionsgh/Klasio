'use client';

import { useRouter } from 'next/navigation';
import Combobox from './Combobox';

/**
 * Stage filter for the admissions pipeline. The page is a server component, so choosing a
 * stage navigates rather than filtering in the browser.
 */
export default function AdmissionsFilters({
  stage,
  q,
  stages,
}: {
  stage: string;
  q?: string;
  stages: { key: string; label: string; count: number }[];
}) {
  const router = useRouter();

  function go(next: string) {
    const p = new URLSearchParams();
    if (next) p.set('stage', next);
    if (q) p.set('q', q);
    router.push(`/admissions${p.toString() ? `?${p}` : ''}`);
  }

  return (
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
      value={stage}
      onChange={go}
    />
  );
}
