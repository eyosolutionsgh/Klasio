'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

const field =
  'w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

/**
 * Discount, waiver or scholarship against a student's account. Heads and owners only — this is
 * forgiving money, and it lands in the ledger as its own entry with the reason attached.
 */
export default function GrantConcession({
  studentId,
  studentName,
}: {
  studentId: string;
  studentName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'DISCOUNT' | 'WAIVER'>('DISCOUNT');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await fetch('/api/proxy/fees/concessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId,
        type,
        amount: Number(f.get('amount')),
        reason: String(f.get('reason') ?? '').trim(),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(
        Array.isArray(body.message) ? body.message.join('. ') : (body.message ?? 'Could not save.'),
      );
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="no-print text-[12.5px] font-medium text-brand hover:underline underline-offset-2"
      >
        + Discount or waiver
      </button>
    );
  }
  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Grant a concession"
      className="brand-scope fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
      onClick={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <form onSubmit={submit} className="card w-full max-w-md p-6">
        <h2 className="font-display text-2xl">Discount or waiver</h2>
        <p className="text-sm text-oat mt-1.5">
          Reduces what {studentName} owes. It is recorded as its own ledger entry with the reason —
          nothing is erased.
        </p>

        <div className="flex gap-2 mt-5">
          {(
            [
              { v: 'DISCOUNT', l: 'Discount', hint: 'Sibling, staff, bursary' },
              { v: 'WAIVER', l: 'Waiver', hint: 'Hardship, written off' },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setType(o.v)}
              aria-pressed={type === o.v}
              className={`flex-1 rounded-lg border px-3 py-2.5 text-left transition ${
                type === o.v ? 'bg-brand text-paper border-brand' : 'border-mist hover:border-brand'
              }`}
            >
              <span className="block text-sm font-medium">{o.l}</span>
              <span className={`block text-[11px] ${type === o.v ? 'text-paper/70' : 'text-oat'}`}>
                {o.hint}
              </span>
            </button>
          ))}
        </div>

        <label className="block text-[13px] mt-4">
          <span className="block text-oat mb-1">Amount (GHS)</span>
          <input name="amount" type="number" min="0.01" step="0.01" required className={field} />
        </label>
        <label className="block text-[13px] mt-3">
          <span className="block text-oat mb-1">Reason</span>
          <input
            name="reason"
            required
            minLength={4}
            placeholder="Second sibling — 10% concession"
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
            className="min-h-11 rounded-lg bg-brand text-paper text-sm font-medium px-5 hover:bg-brand-deep transition disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Apply'}
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
