'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

const field =
  'w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

/**
 * Cancel a ledger entry by appending its reversal.
 *
 * The ledger is append-only, so there is no edit and no delete — a charge raised in error is
 * cancelled by recording that it was cancelled, and both halves stay on the family's history. The
 * alternative a bursar reaches for otherwise is a fake compensating payment, which is precisely
 * the lie the append-only design exists to prevent.
 */
export default function ReverseEntry({
  entryId,
  label,
  amount,
}: {
  entryId: string;
  label: string;
  amount: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/proxy/fees/ledger/${entryId}/reverse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: String(f.get('reason') ?? '').trim() }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(
        Array.isArray(body.message)
          ? body.message.join('. ')
          : (body.message ?? 'Could not reverse this entry.'),
      );
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="no-print text-[11px] text-oat hover:text-danger hover:underline underline-offset-2 transition"
      >
        Reverse
      </button>
    );
  }
  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reverse a ledger entry"
      className="brand-scope fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
      onClick={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <form onSubmit={submit} className="card w-full max-w-md p-6">
        <h2 className="font-display text-2xl">Reverse this entry</h2>
        <p className="text-sm text-oat mt-1.5">
          Cancels <span className="font-medium text-ink">{label}</span> of{' '}
          <span className="font-medium text-ink tabular">{amount}</span>. Nothing is deleted — both
          the original and this correction stay on the record, so the family can see what happened.
        </p>

        <label className="block text-[13px] mt-4">
          <span className="block text-oat mb-1">Why is this being reversed?</span>
          <input
            name="reason"
            required
            minLength={4}
            placeholder="Bill raised twice in error"
            className={field}
          />
          <span className="block text-[11px] text-oat mt-1">
            Shown in the ledger and the audit log.
          </span>
        </label>

        {error && <p className="text-sm text-danger mt-3">{error}</p>}

        <div className="flex items-center gap-3 mt-5">
          <button
            disabled={busy}
            className="min-h-11 rounded-lg bg-danger text-paper text-sm font-medium px-5 hover:opacity-90 transition disabled:opacity-60"
          >
            {busy ? 'Reversing…' : 'Reverse entry'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-11 px-3 text-[13px] text-oat hover:text-brand transition"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
