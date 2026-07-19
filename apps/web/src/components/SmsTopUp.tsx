'use client';

import { useState } from 'react';
import { Button, useAsyncAction } from './Button';
import { CashIcon, PlusIcon } from './icons';

/**
 * Record SMS credits the school has already bought from the vendor.
 *
 * Deliberately not a checkout: nothing is charged here. The school pays the vendor by transfer or
 * MoMo and this writes the credits onto their account, with the reference tying them to that
 * payment. Wording matters — a bursar who reads this as "buy now" will expect a debit that never
 * comes, or worse, expect credits they have not paid for.
 */
export default function SmsTopUp({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [credits, setCredits] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  const field =
    'rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

  const save = useAsyncAction(async () => {
    setError(null);
    const res = await fetch('/api/proxy/fees/sms/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credits: Number(credits), reference: reference.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        Array.isArray(body.message)
          ? body.message.join('. ')
          : (body.message ?? 'Could not record the top-up.'),
      );
      throw new Error('rejected');
    }
    setOpen(false);
    setCredits('');
    setReference('');
    onDone();
  });

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        icon={<PlusIcon />}
        onClick={() => setOpen(true)}
        data-tip="Add credits you have already paid the vendor for"
        className="tip"
      >
        Record a top-up
      </Button>
    );
  }

  return (
    <form onSubmit={save.run} className="card p-6 mt-4 rise rise-2 w-full max-w-2xl">
      <h2 className="font-display text-xl">Record an SMS top-up</h2>
      <p className="text-sm text-oat mt-1.5">
        This does not charge anything. Pay the vendor for credits by bank transfer or MoMo first,
        then record them here with the transfer reference so the purchase can be traced.
      </p>
      <div className="flex flex-wrap items-end gap-3 mt-4">
        <label className="text-[13px]">
          <span className="block text-oat mb-1">Credits bought</span>
          <input
            required
            type="number"
            min="1"
            step="1"
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
            className={`${field} w-32 tabular`}
          />
        </label>
        <label className="text-[13px] flex-1 min-w-[12rem]">
          <span className="block text-oat mb-1">Payment reference</span>
          <input
            required
            minLength={3}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="MoMo or bank transfer reference"
            className={`${field} w-full`}
          />
        </label>
        {/* CashIcon: what is being written down is a purchase already paid for. */}
        <Button type="submit" state={save.state} icon={<CashIcon />}>
          Record top-up
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
      {error && <p className="text-sm text-danger mt-3">{error}</p>}
    </form>
  );
}
