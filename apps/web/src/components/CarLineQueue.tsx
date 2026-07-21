'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface QueueRow {
  id: string;
  position: number;
  status: 'WAITING' | 'CALLED';
  announcedAt: string;
  guardian: { name: string; phone: string; hasPhoto: boolean };
  children: { id: string; name: string; className: string | null }[];
}

const time = (d: string) =>
  new Date(d).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' });

/**
 * The gate's live queue: which family is outside, in arrival order, and which child to bring
 * out next. Hidden entirely when the package has no car line (the API answers 403).
 */
export default function CarLineQueue() {
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/proxy/pickup/carline');
    if (!res.ok) {
      setRows(null);
      return;
    }
    setRows(await res.json());
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 10_000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  async function setStatus(id: string, status: 'CALLED' | 'DONE') {
    setBusy(id);
    const res = await fetch(`/api/proxy/pickup/carline/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setBusy(null);
    if (res.ok) load();
  }

  if (rows === null) return null;

  return (
    <section className="card p-6 rise rise-3">
      <h2 className="font-display text-xl">Car line</h2>
      <p className="text-sm text-oat mt-1.5">
        {rows.length === 0
          ? 'Nobody is waiting outside.'
          : `${rows.length} famil${rows.length === 1 ? 'y' : 'ies'} outside, in arrival order.`}
      </p>
      <ul className="mt-4 space-y-3">
        {rows.map((r) => (
          <li
            key={r.id}
            className={`rounded-lg border p-3 ${
              r.status === 'CALLED' ? 'border-leaf/40 bg-leaf/5' : 'border-mist'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  <span className="tabular text-oat mr-1.5">#{r.position}</span>
                  {r.guardian.name}
                </p>
                <p className="text-[11px] text-oat tabular">
                  arrived {time(r.announcedAt)} · {r.guardian.phone}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                {r.status === 'WAITING' ? (
                  <button
                    onClick={() => setStatus(r.id, 'CALLED')}
                    disabled={busy === r.id}
                    className="min-h-9 text-[12px] font-medium rounded-full border border-brand text-brand px-3 hover:bg-brand hover:text-white transition disabled:opacity-50"
                  >
                    Call forward
                  </button>
                ) : (
                  <button
                    onClick={() => setStatus(r.id, 'DONE')}
                    disabled={busy === r.id}
                    className="min-h-9 text-[12px] font-medium rounded-full border border-leaf text-leaf px-3 hover:bg-leaf hover:text-white transition disabled:opacity-50"
                  >
                    Handed over
                  </button>
                )}
              </div>
            </div>
            {r.children.length > 0 && (
              <p className="text-[12px] text-oat mt-1.5">
                {r.children
                  .map((c) => `${c.name}${c.className ? ` (${c.className})` : ''}`)
                  .join(' · ')}
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-oat mt-3">
        Bringing a child out is not releasing them — the release above still checks who is
        collecting and writes the log.
      </p>
    </section>
  );
}
