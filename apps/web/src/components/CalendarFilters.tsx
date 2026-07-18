'use client';

import { useRouter } from 'next/navigation';
import Combobox from './Combobox';

/**
 * Month, audience and level filters for the school calendar. The page is a server component, so
 * changing a filter navigates rather than mutating client state.
 */
export default function CalendarFilters({
  month,
  audience,
  levelId,
  months,
  audiences,
  levels,
}: {
  month: string;
  audience?: string;
  levelId?: string;
  months: { value: string; label: string }[];
  audiences: { key: string; label: string }[];
  levels: { id: string; name: string }[];
}) {
  const router = useRouter();

  function go(next: Record<string, string | undefined>) {
    const merged = { month, audience, levelId, ...next };
    const p = new URLSearchParams({ month: merged.month });
    if (merged.audience) p.set('audience', merged.audience);
    if (merged.levelId) p.set('levelId', merged.levelId);
    router.push(`/calendar?${p}`);
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Combobox
        label="Month"
        className="w-full sm:w-56"
        allowClear={false}
        placeholder="Search months…"
        options={months}
        value={month}
        onChange={(v) => go({ month: v })}
      />
      <Combobox
        label="Audience"
        className="w-full sm:w-52"
        clearLabel="Every audience"
        placeholder="Search audiences…"
        options={audiences.map((a) => ({ value: a.key, label: a.label }))}
        value={audience ?? ''}
        onChange={(v) => go({ audience: v || undefined })}
      />
      <Combobox
        label="Level"
        className="w-full sm:w-56"
        clearLabel="All levels"
        placeholder="Search levels…"
        options={levels.map((l) => ({ value: l.id, label: l.name }))}
        value={levelId ?? ''}
        onChange={(v) => go({ levelId: v || undefined })}
      />
    </div>
  );
}
