'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PromoteClass({
  fromClassId,
  fromClassName,
  classes,
}: {
  fromClassId: string;
  fromClassName: string;
  classes: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
        body: JSON.stringify({ fromClassId, toClassId: graduate ? undefined : toClassId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Promotion failed');
      setMsg(
        data.graduated
          ? `Graduated ${data.moved} student(s).`
          : `Moved ${data.moved} student(s). Outstanding fees carried forward.`,
      );
      setOpen(false);
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
            className="rounded-lg bg-forest text-paper text-sm font-medium px-4 py-2 hover:bg-forest-deep transition shrink-0"
          >
            Promote {fromClassName}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-oat">Move active students to</span>
          <select
            value={toClassId}
            onChange={(e) => setToClassId(e.target.value)}
            className="rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-forest"
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
            className="rounded-lg bg-forest text-paper text-sm font-medium px-4 py-2 hover:bg-forest-deep transition disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Promote'}
          </button>
          <button
            onClick={() => submit(true)}
            disabled={busy}
            className="rounded-lg border border-mist text-forest text-sm font-medium px-4 py-2 hover:bg-forest-mist transition disabled:opacity-50"
            data-tip="Mark all active students as graduated"
          >
            Graduate class
          </button>
          <button
            onClick={() => setOpen(false)}
            className="text-sm text-oat hover:text-forest transition"
          >
            Cancel
          </button>
        </div>
      )}
      {msg && <p className="text-xs text-forest mt-2">{msg}</p>}
    </div>
  );
}
