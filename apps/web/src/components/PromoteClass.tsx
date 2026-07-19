'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Move a class up a year, or graduate it.
 *
 * Graduating is deliberately harder to reach than promoting. It marks every child in the class
 * GRADUATED with an exit date, and nothing in the product can put that back — the only recovery is
 * direct database access. It used to be a single unconfirmed click sitting beside "Promote", with
 * nothing naming the class or saying how many children it would affect.
 */
export default function PromoteClass({
  fromClassId,
  fromClassName,
  studentCount,
  classes,
}: {
  fromClassId: string;
  fromClassName: string;
  /** Active students the action will touch — the number that makes it real before confirming. */
  studentCount: number;
  classes: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmingGraduation, setConfirmingGraduation] = useState(false);
  const [toClassId, setToClassId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(graduate: boolean) {
    if (!graduate && !toClassId) {
      setMsg('Choose a destination class or graduate.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/proxy/students/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromClassId,
          toClassId: graduate ? undefined : toClassId,
          // Stated, not inferred from the absent destination — the API refuses to graduate a
          // class without it, so a dropped field can no longer end a year group by accident.
          ...(graduate ? { graduate: true } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Promotion failed');
      setMsg(
        data.graduated
          ? `Graduated ${data.moved} student(s).`
          : `Moved ${data.moved} student(s). Outstanding fees carried forward.`,
      );
      setOpen(false);
      setConfirmingGraduation(false);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Promotion failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      {!open ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-oat">
            End of term for <span className="font-medium text-ink">{fromClassName}</span>? Promote
            the class or graduate its students.
          </p>
          <button
            onClick={() => setOpen(true)}
            className="rounded-lg bg-brand text-paper text-sm font-medium px-4 py-2 hover:bg-brand-deep transition shrink-0"
          >
            Promote {fromClassName}
          </button>
        </div>
      ) : confirmingGraduation ? (
        /* The stop: names the class, counts the children, says plainly that it cannot be undone. */
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-4">
          <p className="font-medium text-danger">
            Graduate {fromClassName} — {studentCount} student{studentCount === 1 ? '' : 's'}?
          </p>
          <p className="text-[13px] text-oat mt-1.5 max-w-prose">
            Every active student in {fromClassName} will be marked as graduated and given today as
            their leaving date. They leave the register, the class roll and the fee lists.{' '}
            <span className="text-ink">This cannot be undone from the app.</span> If you meant to
            move them up a year, choose a class instead.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <button
              onClick={() => submit(true)}
              disabled={busy}
              className="min-h-11 rounded-lg bg-danger text-paper text-sm font-medium px-4 hover:opacity-90 transition disabled:opacity-50"
            >
              {busy ? 'Working…' : `Yes, graduate ${studentCount}`}
            </button>
            <button
              onClick={() => setConfirmingGraduation(false)}
              className="min-h-11 px-3 text-sm text-oat hover:text-brand transition"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-oat">
            Move {studentCount} active student{studentCount === 1 ? '' : 's'} to
          </span>
          <select
            value={toClassId}
            onChange={(e) => setToClassId(e.target.value)}
            className="rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand"
          >
            <option value="">— choose class —</option>
            {classes
              .filter((c) => c.id !== fromClassId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <button
            onClick={() => submit(false)}
            disabled={busy}
            className="rounded-lg bg-brand text-paper text-sm font-medium px-4 py-2 hover:bg-brand-deep transition disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Promote'}
          </button>
          {/* Muted, and ellipsised: it opens a question rather than doing the thing. */}
          <button
            onClick={() => setConfirmingGraduation(true)}
            disabled={busy}
            className="rounded-lg border border-mist text-oat text-sm font-medium px-4 py-2 hover:border-danger hover:text-danger transition disabled:opacity-50"
          >
            Graduate class…
          </button>
          <button
            onClick={() => setOpen(false)}
            className="text-sm text-oat hover:text-brand transition"
          >
            Cancel
          </button>
        </div>
      )}
      {msg && <p className="text-xs text-brand mt-2">{msg}</p>}
    </div>
  );
}
