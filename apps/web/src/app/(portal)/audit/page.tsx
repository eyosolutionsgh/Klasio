'use client';

import { useCallback, useEffect, useState } from 'react';

interface Entry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  detail: unknown;
  actor: string;
  createdAt: string;
}
interface AuditPage {
  total: number;
  page: number;
  pages: number;
  entries: Entry[];
}

export default function AuditPage() {
  const [data, setData] = useState<AuditPage | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetch('/api/proxy/audit/actions')
      .then((r) => r.json())
      .then((a) => setActions(Array.isArray(a) ? a : []));
  }, []);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page) });
    if (action) qs.set('action', action);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    const res = await fetch(`/api/proxy/audit?${qs}`);
    if (res.ok) setData(await res.json());
  }, [action, from, to, page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Audit log</h1>
        <p className="text-sm text-oat mt-1.5">Every recorded change — who did what, and when.</p>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3 rise rise-2">
        <label className="text-[13px]">
          <span className="block text-oat mb-1">Action</span>
          <select
            value={action}
            onChange={(e) => {
              setPage(1);
              setAction(e.target.value);
            }}
            className="rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-forest"
          >
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[13px]">
          <span className="block text-oat mb-1">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setPage(1);
              setFrom(e.target.value);
            }}
            className="rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-forest"
          />
        </label>
        <label className="text-[13px]">
          <span className="block text-oat mb-1">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setPage(1);
              setTo(e.target.value);
            }}
            className="rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-forest"
          />
        </label>
      </div>

      <div className="card mt-6 overflow-x-auto rise rise-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <th className="px-5 py-3 font-medium">When</th>
              <th className="px-5 py-3 font-medium">Actor</th>
              <th className="px-5 py-3 font-medium">Action</th>
              <th className="px-5 py-3 font-medium">Entity</th>
              <th className="px-5 py-3 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {data?.entries.map((e) => (
              <tr key={e.id} className="border-b border-mist/60 last:border-0 align-top">
                <td className="px-5 py-2.5 text-oat text-xs tabular whitespace-nowrap">
                  {new Date(e.createdAt).toLocaleString('en-GH', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td className="px-5 py-2.5">{e.actor}</td>
                <td className="px-5 py-2.5 font-medium tabular">{e.action}</td>
                <td className="px-5 py-2.5 text-oat">
                  {e.entity}
                  {e.entityId && <span className="text-[11px]"> · {e.entityId.slice(0, 8)}</span>}
                </td>
                <td className="px-5 py-2.5 text-[11px] text-oat font-mono max-w-xs truncate">
                  {e.detail ? JSON.stringify(e.detail) : ''}
                </td>
              </tr>
            ))}
            {data && data.entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-oat">
                  No audit entries match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.pages > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm rise">
          <span className="text-oat">
            Page {data.page} of {data.pages} · {data.total} entries
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={data.page <= 1}
              className="rounded-lg border border-mist px-3 py-1.5 hover:border-forest transition disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
              disabled={data.page >= data.pages}
              className="rounded-lg border border-mist px-3 py-1.5 hover:border-forest transition disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
