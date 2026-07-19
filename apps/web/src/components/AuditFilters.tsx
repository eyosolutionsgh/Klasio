'use client';

import { useRouter } from 'next/navigation';
import Combobox from './Combobox';
import DateRangeFilter from './DateRangeFilter';
import { listHref, one, type ListSearchParams } from '@/lib/list';

/**
 * Action, entity and date filters for the audit trail. The page itself is a server component, so
 * changing a filter navigates rather than mutating client state.
 *
 * Every control routes through `listHref`, which preserves the parameters it is not changing and
 * drops `page`. Narrowing to one action while holding page 6 would otherwise land on an empty
 * table that reads as "nothing was recorded" rather than "you were on a page that no longer
 * exists" — a particularly bad lie to tell about an audit log.
 */
export default function AuditFilters({
  actions,
  entities,
  params,
}: {
  actions: string[];
  entities: string[];
  params: ListSearchParams;
}) {
  const router = useRouter();
  const go = (changes: Record<string, string | undefined>) =>
    router.push(listHref('/audit', params, changes));

  const action = one(params.action) ?? '';
  const entity = one(params.entity) ?? '';

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Combobox
        label="Action"
        className="w-full sm:w-64"
        clearLabel="All actions"
        placeholder="Search actions…"
        options={actions.map((a) => ({ value: a, label: a }))}
        value={action}
        onChange={(v) => go({ action: v || undefined })}
      />
      <Combobox
        label="Entity"
        className="w-full sm:w-52"
        clearLabel="All entities"
        placeholder="Search entities…"
        options={entities.map((e) => ({ value: e, label: e }))}
        value={entity}
        onChange={(v) => go({ entity: v || undefined })}
      />
      <DateRangeFilter base="/audit" params={params} label="Recorded between" />
    </div>
  );
}
