'use client';

import { useRouter } from 'next/navigation';
import Combobox from './Combobox';

/**
 * Term picker for the statutory returns page. The page is a server component and the figures are
 * recomputed on every request, so changing the term navigates rather than mutating client state.
 */
export default function ReturnsFilters({
  termId,
  terms,
}: {
  termId: string;
  terms: { id: string; label: string }[];
}) {
  const router = useRouter();

  return (
    <Combobox
      label="Term"
      className="w-full sm:w-72"
      allowClear={false}
      placeholder="Search terms…"
      options={terms.map((t) => ({ value: t.id, label: t.label }))}
      value={termId}
      onChange={(v) => router.push(`/settings/returns?termId=${v}`)}
    />
  );
}
