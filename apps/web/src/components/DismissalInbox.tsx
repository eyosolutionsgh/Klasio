'use client';

import { useCallback, useEffect, useState } from 'react';

interface Request {
  id: string;
  student: string;
  admissionNo: string;
  guardian: string;
  guardianPhone: string;
  forDate: string;
  details: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED';
  decisionNote: string | null;
  createdAt: string;
}

const day = (d: string) =>
  new Date(d).toLocaleDateString('en-GH', { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * Requests from guardians to change today's pickup. They arrive from the parent portal and mean
 * nothing until the front office decides — so the decision has to be visible right where
 * dismissal happens.
 */
export default function DismissalInbox() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch('/api/proxy/pickup/dismissal-requests');
    if (res.ok) setRequests(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(id: string, status: 'APPROVED' | 'DECLINED') {
    setBusy(id);
    const res = await fetch(`/api/proxy/pickup/dismissal-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, decisionNote: note[id] || undefined }),
    });
    setBusy(null);
    if (res.ok) load();
  }

  const pending = requests.filter((r) => r.status === 'PENDING');
  const decided = requests.filter((r) => r.status !== 'PENDING').slice(0, 5);

  return (
    <section className="card p-6 rise rise-4">
      <h2 className="font-display text-xl">
        Pickup change requests
        {pending.length > 0 && (
          <span className="ml-2 text-[11px] uppercase tracking-wider bg-clay/10 text-clay rounded-full px-2 py-0.5 align-middle">
            {pending.length} waiting
          </span>
        )}
      </h2>
      <p className="text-sm text-oat mt-1.5">
        From parents. Nothing changes at the gate until you decide — the parent is texted either
        way.
      </p>

      <ul className="mt-4 space-y-4">
        {pending.map((r) => (
          <li key={r.id} className="rounded-lg border border-clay/30 bg-clay/5 p-4">
            <div className="flex justify-between gap-3">
              <p className="text-sm font-medium">{r.student}</p>
              <p className="text-[11px] text-oat shrink-0">{day(r.forDate)}</p>
            </div>
            <p className="text-[12px] text-oat">
              from {r.guardian} · <span className="tabular">{r.guardianPhone}</span>
            </p>
            <p className="text-sm mt-2">{r.details}</p>
            <input
              value={note[r.id] ?? ''}
              onChange={(e) => setNote((n) => ({ ...n, [r.id]: e.target.value }))}
              placeholder="Note back to the parent (optional)"
              className="w-full min-h-11 rounded-lg border border-mist bg-white px-3 py-2 text-sm mt-3 outline-none focus:border-brand"
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => decide(r.id, 'APPROVED')}
                disabled={busy === r.id}
                className="min-h-11 rounded-lg bg-brand text-paper text-sm font-medium px-4 hover:bg-brand-deep transition disabled:opacity-60"
              >
                Approve
              </button>
              <button
                onClick={() => decide(r.id, 'DECLINED')}
                disabled={busy === r.id}
                className="min-h-11 rounded-lg border border-clay/40 text-clay text-sm font-medium px-4 hover:bg-clay/10 transition disabled:opacity-60"
              >
                Decline
              </button>
            </div>
          </li>
        ))}
        {pending.length === 0 && <li className="text-sm text-oat">Nothing waiting.</li>}
      </ul>

      {decided.length > 0 && (
        <>
          <p className="text-[11px] uppercase tracking-wider text-oat mt-5">Recently decided</p>
          <ul className="mt-2 space-y-2">
            {decided.map((r) => (
              <li key={r.id} className="flex justify-between gap-3 text-[13px]">
                <span className="truncate">
                  {r.student} · {day(r.forDate)}
                </span>
                <span className={`shrink-0 ${r.status === 'APPROVED' ? 'text-leaf' : 'text-clay'}`}>
                  {r.status.toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
