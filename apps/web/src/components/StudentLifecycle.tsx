'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Action = 'transfer' | 'withdraw';

export default function StudentLifecycle({ studentId, name }: { studentId: string; name: string }) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/proxy/students/${studentId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? `${action} failed`);
      }
      setAction(null);
      setReason('');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${action} failed`);
    } finally {
      setBusy(false);
    }
  }

  if (!action) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => setAction('transfer')}
          className="rounded-lg border border-mist text-brand text-sm font-medium px-4 py-2 hover:bg-brand-mist transition"
          data-tip="Record that this student moved to another school"
        >
          Transfer
        </button>
        <button
          onClick={() => setAction('withdraw')}
          className="rounded-lg border border-mist text-clay text-sm font-medium px-4 py-2 hover:bg-clay/5 transition"
          data-tip="Record that this student left the school"
        >
          Withdraw
        </button>
      </div>
    );
  }

  return (
    <div className="card p-4 flex flex-wrap items-center gap-3">
      <span className="text-sm text-oat">
        {action === 'transfer' ? 'Transfer' : 'Withdraw'}{' '}
        <span className="font-medium text-ink">{name}</span> — reason (optional)
      </span>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={action === 'transfer' ? 'e.g. relocated to Kumasi' : 'e.g. fees / relocation'}
        className="rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand w-64"
      />
      <button
        onClick={submit}
        disabled={busy}
        className="rounded-lg bg-brand text-paper text-sm font-medium px-4 py-2 hover:bg-brand-deep transition disabled:opacity-50"
      >
        {busy ? 'Working…' : `Confirm ${action}`}
      </button>
      <button
        onClick={() => {
          setAction(null);
          setError(null);
        }}
        className="text-sm text-oat hover:text-brand transition"
      >
        Cancel
      </button>
      {error && <span className="text-xs text-red-600 w-full">{error}</span>}
    </div>
  );
}
