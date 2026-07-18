'use client';

import { useRouter } from 'next/navigation';
import Combobox from './Combobox';

/**
 * File and state filters for the exception queue. The page is a server component, so changing a
 * filter navigates rather than mutating client state.
 */
export default function ReconciliationFilters({
  batchId,
  status,
  batches,
  states,
}: {
  batchId?: string;
  status?: string;
  batches: { id: string; label: string; hint: string }[];
  states: { key: string; label: string }[];
}) {
  const router = useRouter();

  function go(next: Record<string, string | undefined>) {
    const merged = { batchId, status, ...next };
    const p = new URLSearchParams();
    if (merged.batchId) p.set('batchId', merged.batchId);
    if (merged.status) p.set('status', merged.status);
    router.push(`/settings/reconciliation?${p}`);
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Combobox
        label="File"
        className="w-full sm:w-64"
        clearLabel="Every import"
        placeholder="Search imports…"
        options={batches.map((b) => ({ value: b.id, label: b.label, hint: b.hint }))}
        value={batchId ?? ''}
        onChange={(v) => go({ batchId: v || undefined })}
      />
      <Combobox
        label="State"
        className="w-full sm:w-52"
        // Matches the API's own default: the two states that still want a human.
        clearLabel="Still open"
        placeholder="Search states…"
        options={states.map((s) => ({ value: s.key, label: s.label }))}
        value={status ?? ''}
        onChange={(v) => go({ status: v || undefined })}
      />
    </div>
  );
}
