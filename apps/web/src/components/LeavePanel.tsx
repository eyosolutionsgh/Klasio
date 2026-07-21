'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, useAsyncAction } from '@/components/Button';
import { SendIcon } from '@/components/icons';

interface LeaveRow {
  id: string;
  staff?: string;
  roleName?: string | null;
  kind: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: string;
  decisionNote: string | null;
}

const KINDS = ['ANNUAL', 'SICK', 'MATERNITY', 'CASUAL', 'STUDY', 'OTHER'];

const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' });

const field =
  'min-h-11 rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand';

/**
 * Both sides of leave on one card: asking for your own (no permission needed), and — for
 * holders of hr.leave — deciding everyone else's. The API refuses self-approval whatever the
 * caller holds; this only mirrors that refusal in the UI.
 */
export default function LeavePanel({ canDecide }: { canDecide: boolean }) {
  const [mine, setMine] = useState<LeaveRow[]>([]);
  const [inbox, setInbox] = useState<LeaveRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, i] = await Promise.all([
      fetch('/api/proxy/hr/leave/mine').then((r) => (r.ok ? r.json() : [])),
      canDecide
        ? fetch('/api/proxy/hr/leave?status=PENDING').then((r) => (r.ok ? r.json() : []))
        : Promise.resolve([]),
    ]);
    setMine(m);
    setInbox(i);
  }, [canDecide]);

  useEffect(() => {
    load();
  }, [load]);

  const request = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    const f = new FormData(form);
    setError(null);
    const res = await fetch('/api/proxy/hr/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: String(f.get('kind')),
        startDate: String(f.get('startDate')),
        endDate: String(f.get('endDate')),
        reason: String(f.get('reason')),
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? 'Could not send that request.');
      throw new Error('rejected');
    }
    form.reset();
    load();
  });

  async function decide(id: string, status: 'APPROVED' | 'DECLINED') {
    const decisionNote =
      status === 'DECLINED' ? (prompt('A short note for the person (optional):') ?? '') : '';
    setBusy(id);
    const res = await fetch(`/api/proxy/hr/leave/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, decisionNote: decisionNote || undefined }),
    });
    setBusy(null);
    if (res.ok) load();
  }

  async function withdraw(id: string) {
    if (!confirm('Withdraw this request?')) return;
    const res = await fetch(`/api/proxy/hr/leave/${id}/cancel`, { method: 'POST' });
    if (res.ok) load();
  }

  const tone = (s: string) =>
    s === 'APPROVED'
      ? 'text-leaf'
      : s === 'DECLINED'
        ? 'text-danger'
        : s === 'CANCELLED'
          ? 'text-oat'
          : 'text-gold';

  return (
    <div className="space-y-6">
      <section className="card p-6 rise rise-3">
        <h2 className="font-display text-xl">Ask for leave</h2>
        <form onSubmit={request.run} className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <select name="kind" required className={field}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.charAt(0) + k.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
            <label className="text-[12px] text-oat flex items-center gap-2">
              from <input name="startDate" type="date" required className={field} />
            </label>
            <label className="text-[12px] text-oat flex items-center gap-2">
              to <input name="endDate" type="date" required className={field} />
            </label>
          </div>
          <textarea
            name="reason"
            required
            minLength={6}
            rows={2}
            placeholder="Why, briefly — whoever decides reads this."
            className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
          <Button type="submit" state={request.state} icon={<SendIcon />}>
            Send request
          </Button>
        </form>
        {error && <p className="text-sm text-danger mt-2">{error}</p>}

        {mine.length > 0 && (
          <ul className="mt-5 space-y-2">
            {mine.map((r) => (
              <li
                key={r.id}
                className="flex items-start justify-between gap-3 border-b border-mist/50 last:border-0 pb-2 last:pb-0"
              >
                <div>
                  <p className="text-sm">
                    <span className="font-medium">
                      {r.kind.charAt(0) + r.kind.slice(1).toLowerCase()}
                    </span>{' '}
                    · {fmt(r.startDate)} – {fmt(r.endDate)}
                  </p>
                  <p className={`text-[12px] ${tone(r.status)}`}>
                    {r.status.toLowerCase()}
                    {r.decisionNote && ` — ${r.decisionNote}`}
                  </p>
                </div>
                {r.status === 'PENDING' && (
                  <button
                    onClick={() => withdraw(r.id)}
                    className="text-[12px] text-oat hover:text-clay underline underline-offset-2 shrink-0"
                  >
                    Withdraw
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canDecide && (
        <section className="card p-6 rise rise-3">
          <h2 className="font-display text-xl">Leave requests</h2>
          <p className="text-sm text-oat mt-1.5">
            {inbox.length === 0
              ? 'Nothing waiting on a decision.'
              : `${inbox.length} waiting. Your own requests are not shown — someone else decides those.`}
          </p>
          <ul className="mt-4 space-y-3">
            {inbox.map((r) => (
              <li key={r.id} className="rounded-lg border border-mist p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      {r.staff}
                      {r.roleName && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-oat">
                          {r.roleName}
                        </span>
                      )}
                    </p>
                    <p className="text-[12px] text-oat">
                      {r.kind.charAt(0) + r.kind.slice(1).toLowerCase()} · {fmt(r.startDate)} –{' '}
                      {fmt(r.endDate)}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => decide(r.id, 'APPROVED')}
                      disabled={busy === r.id}
                      className="min-h-9 rounded-full border border-leaf text-leaf px-3 text-[12px] font-medium hover:bg-leaf hover:text-white transition disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => decide(r.id, 'DECLINED')}
                      disabled={busy === r.id}
                      className="min-h-9 rounded-full border border-danger text-danger px-3 text-[12px] font-medium hover:bg-danger hover:text-white transition disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                </div>
                <p className="text-[13px] mt-1.5">{r.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
