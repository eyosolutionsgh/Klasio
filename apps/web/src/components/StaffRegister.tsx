'use client';

import { useCallback, useEffect, useState } from 'react';

interface Row {
  userId: string;
  name: string;
  roleName: string;
  status: string | null;
  onLeave: string | null;
}

const STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as const;
const TONE: Record<string, string> = {
  PRESENT: 'border-leaf text-leaf',
  LATE: 'border-gold text-gold',
  ABSENT: 'border-danger text-danger',
  EXCUSED: 'border-oat text-oat',
};

/** The staff register: one tap per person per day, corrections replace the mark. */
export default function StaffRegister() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/proxy/hr/attendance?date=${date}`);
    if (res.ok) setRows(await res.json());
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  async function mark(userId: string, status: string) {
    setBusy(userId);
    setError(null);
    const res = await fetch('/api/proxy/hr/attendance/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, date, status }),
    });
    setBusy(null);
    if (res.ok) load();
    else {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? 'Could not save that mark.');
    }
  }

  return (
    <section className="card p-6 rise rise-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl">Staff register</h2>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="min-h-11 rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </div>
      <ul className="mt-4 space-y-2">
        {rows.map((r) => (
          <li
            key={r.userId}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-mist/50 last:border-0 pb-2.5 last:pb-0"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{r.name}</p>
              <p className="text-[11px] text-oat">
                {r.roleName}
                {r.onLeave && (
                  <span className="ml-2 text-gold">on {r.onLeave.toLowerCase()} leave</span>
                )}
              </p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => mark(r.userId, s)}
                  disabled={busy === r.userId}
                  aria-pressed={r.status === s}
                  className={`min-h-9 rounded-full border px-3 text-[11px] font-medium uppercase tracking-wide transition disabled:opacity-50 ${
                    r.status === s
                      ? `${TONE[s]} bg-parchment`
                      : 'border-mist text-oat hover:border-brand'
                  }`}
                >
                  {s.toLowerCase()}
                </button>
              ))}
            </div>
          </li>
        ))}
        {rows.length === 0 && <li className="text-sm text-oat">No staff to mark.</li>}
      </ul>
      {error && <p className="text-sm text-danger mt-3">{error}</p>}
    </section>
  );
}
