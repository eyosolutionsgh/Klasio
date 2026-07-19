'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, useAsyncAction } from '@/components/Button';
import { CheckIcon, CloseIcon } from '@/components/icons';

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
  const [note, setNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch('/api/proxy/pickup/dismissal-requests');
    if (res.ok) setRequests(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decide = useCallback(
    async (id: string, status: 'APPROVED' | 'DECLINED') => {
      const res = await fetch(`/api/proxy/pickup/dismissal-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, decisionNote: note[id] || undefined }),
      });
      // Thrown so the button settles on "Couldn't approve" — a decision that did not land must
      // not read as one that did, because the guardian is texted off the back of it.
      if (!res.ok) throw new Error('decision rejected');
      load();
    },
    [load, note],
  );

  const pending = requests.filter((r) => r.status === 'PENDING');
  const decided = requests.filter((r) => r.status !== 'PENDING').slice(0, 5);

  return (
    <section className="card p-6 rise rise-4">
      <h2 className="font-display text-xl">
        Collection change requests
        {pending.length > 0 && (
          <span className="ml-2 text-[11px] uppercase tracking-wider bg-clay/10 text-clay rounded-full px-2 py-0.5 align-middle">
            {pending.length} waiting
          </span>
        )}
      </h2>
      <p className="text-sm text-oat mt-1.5">
        From guardians. Nothing changes at the gate until you decide — the guardian is texted either
        way.
      </p>

      <ul className="mt-4 space-y-4">
        {pending.map((r) => (
          <RequestCard
            key={r.id}
            request={r}
            note={note[r.id] ?? ''}
            onNoteChange={(v) => setNote((n) => ({ ...n, [r.id]: v }))}
            decide={decide}
          />
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

/**
 * One waiting request. Its own component because each request runs its own decision, so the
 * pending and outcome state belongs to the card rather than to the inbox.
 */
function RequestCard({
  request: r,
  note,
  onNoteChange,
  decide,
}: {
  request: Request;
  note: string;
  onNoteChange: (value: string) => void;
  decide: (id: string, status: 'APPROVED' | 'DECLINED') => Promise<void>;
}) {
  const approve = useAsyncAction(() => decide(r.id, 'APPROVED'));
  const decline = useAsyncAction(() => decide(r.id, 'DECLINED'));

  return (
    <li className="rounded-lg border border-clay/30 bg-clay/5 p-4">
      <div className="flex justify-between gap-3">
        <p className="text-sm font-medium">{r.student}</p>
        <p className="text-[11px] text-oat shrink-0">{day(r.forDate)}</p>
      </div>
      <p className="text-[12px] text-oat">
        from {r.guardian} · <span className="tabular">{r.guardianPhone}</span>
      </p>
      <p className="text-sm mt-2">{r.details}</p>
      {/* No icon: a free note back to a guardian is not any of the meanings the set covers. */}
      <input
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        placeholder="Note back to the guardian (optional)"
        className="w-full min-h-11 rounded-lg border border-mist bg-white px-3 py-2 text-sm mt-3 outline-none focus:border-brand"
      />
      <div className="flex items-center gap-2 mt-2">
        <Button onClick={approve.run} state={approve.state} icon={<CheckIcon />}>
          Approve
        </Button>
        <Button
          variant="danger"
          onClick={decline.run}
          state={decline.state}
          icon={<CloseIcon />}
          pendingLabel="Declining…"
          doneLabel="Declined!"
          failedLabel="Couldn't decline"
        >
          Decline
        </Button>
      </div>
    </li>
  );
}
