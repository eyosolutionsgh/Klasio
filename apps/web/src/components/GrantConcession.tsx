'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Button, useAsyncAction } from './Button';
import { ChoiceCards } from './ChoiceCards';
import { CashIcon, PlusIcon, SaveIcon } from './icons';

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
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const apply = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    const f = new FormData(e.currentTarget);
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
    if (!res.ok) {
      setError(
        Array.isArray(body.message) ? body.message.join('. ') : (body.message ?? 'Could not save.'),
      );
      throw new Error('concession rejected');
    }
    setOpen(false);
    router.refresh();
  });

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        variant="ghost"
        size="sm"
        icon={<PlusIcon />}
        className="no-print"
      >
        Discount or waiver
      </Button>
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
      <form onSubmit={apply.run} className="card w-full max-w-md p-6">
        <h2 className="font-display text-2xl">Discount or waiver</h2>
        <p className="text-sm text-oat mt-1.5">
          Reduces what {studentName} owes. It is recorded as its own ledger entry with the reason —
          nothing is erased.
        </p>

        <ChoiceCards
          legend="Kind of concession"
          name="type"
          value={type}
          onChange={setType}
          options={[
            { value: 'DISCOUNT', label: 'Discount' },
            { value: 'WAIVER', label: 'Waiver' },
          ]}
          className="mt-5"
        />
        {/* The cards themselves carry no hint, so the two readings stay spelled out here. */}
        <p className="text-[11px] text-oat mt-1.5">
          Discount — sibling, staff, bursary. Waiver — hardship, written off.
        </p>

        <label className="block text-[13px] mt-4">
          <span className="block text-oat mb-1">Amount (GHS)</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
              <CashIcon />
            </span>
            <input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              className={`${field} pl-10`}
            />
          </div>
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
          <Button
            type="submit"
            state={apply.state}
            // The concession is written to the ledger, so the save icon rather than a tick.
            icon={<SaveIcon />}
            pendingLabel="Applying…"
            doneLabel="Applied!"
            failedLabel="Couldn't apply"
          >
            Apply
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
