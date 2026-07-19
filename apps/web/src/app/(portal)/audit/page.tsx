import { api } from '@/lib/api';
import AuditFilters from '@/components/AuditFilters';
import Pagination from '@/components/Pagination';
import SortHeader from '@/components/SortHeader';
import { apiQuery, type ListSearchParams, type Page } from '@/lib/list';

interface Entry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  detail: unknown;
  actor: string;
  createdAt: string;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  // The page's own filters, plus the paging/sorting/date keys `apiQuery` always forwards.
  const qs = apiQuery(params, ['action', 'entity']);

  const [entries, actions, entities] = await Promise.all([
    api<Page<Entry>>(`/audit?${qs}`),
    api<string[]>('/audit/actions'),
    api<string[]>('/audit/entities'),
  ]);

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Audit log</h1>
        <p className="text-sm text-oat mt-1.5">
          Every recorded change — who did what, and when. {entries.total} matching.
        </p>
      </div>

      <div className="mt-6 rise rise-2">
        <AuditFilters actions={actions} entities={entities} params={params} />
      </div>

      <div className="card mt-6 overflow-x-auto rise rise-3 table-stack-wrap">
        <table className="w-full text-sm table-stack">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <SortHeader column="createdAt" base="/audit" params={params} defaultOrder="desc">
                When
              </SortHeader>
              {/*
                Not sortable: the actor is a name resolved from a bare `userId` after the page has
                been chosen, so the database has nothing to order by but an opaque id.
              */}
              <th scope="col" className="px-5 py-3 font-medium">
                Actor
              </th>
              <SortHeader column="action" base="/audit" params={params}>
                Action
              </SortHeader>
              <SortHeader column="entity" base="/audit" params={params}>
                Entity
              </SortHeader>
              <th scope="col" className="px-5 py-3 font-medium">
                Detail
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.rows.map((e) => (
              <tr key={e.id} className="border-b border-mist/60 last:border-0 align-top">
                <td
                  data-label="When"
                  className="px-5 py-2.5 text-oat text-xs tabular whitespace-nowrap"
                >
                  {new Date(e.createdAt).toLocaleString('en-GH', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td data-label="Actor" className="px-5 py-2.5">
                  {e.actor}
                </td>
                <td data-label="Action" className="px-5 py-2.5 font-medium tabular">
                  {e.action}
                </td>
                <td data-label="Entity" className="px-5 py-2.5 text-oat">
                  {e.entity}
                  {e.entityId && <span className="text-[11px]"> · {e.entityId.slice(0, 8)}</span>}
                </td>
                <td
                  data-label="Detail"
                  className="px-5 py-2.5 text-[11px] text-oat font-mono max-w-xs truncate"
                >
                  {e.detail ? JSON.stringify(e.detail) : ''}
                </td>
              </tr>
            ))}
            {entries.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-oat">
                  No audit entries match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination page={entries} base="/audit" params={params} label="entries" />
      </div>
    </div>
  );
}
