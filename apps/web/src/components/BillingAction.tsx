'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Combobox from './Combobox';

const CHANNELS = [
  { value: 'MOMO', label: 'Mobile money' },
  { value: 'CARD', label: 'Card' },
];

/**
 * The buy / step-down control on a single plan card.
 *
 * The two directions are deliberately not symmetrical, because the API is not symmetrical:
 * an upgrade is a payment that changes nothing until the gateway confirms it, a downgrade is
 * an intention that changes nothing until the paid period runs out. The copy below says both
 * out loud rather than showing one hopeful "Switch to…" button for either case.
 */
export default function BillingAction({
  tier,
  amount,
  currency,
  direction,
  currentTier,
  periodEnd,
  defaultPhone,
}: {
  tier: string;
  amount: number;
  currency: string;
  direction: 'upgrade' | 'downgrade';
  currentTier: string;
  /** When the paid period ends — the day a downgrade would actually take effect. */
  periodEnd: string | null;
  defaultPhone: string | null;
}) {
  const router = useRouter();
  const [openForm, setOpenForm] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [channel, setChannel] = useState('MOMO');
  const [phone, setPhone] = useState(defaultPhone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const money = `${currency} ${amount.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const effectiveAt = periodEnd
    ? new Date(periodEnd).toLocaleDateString('en-GH', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/proxy/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier, channel, phone: phone || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(
        Array.isArray(body.message)
          ? body.message.join('. ')
          : (body.message ?? 'Could not start that payment.'),
      );
      return;
    }
    if (body.checkoutUrl) {
      // Leaving the portal entirely: the tier still has not moved, and will not until the
      // gateway calls back. Nothing is updated optimistically here.
      window.location.href = body.checkoutUrl;
      return;
    }
    setBusy(false);
    setNote(
      `Payment ${body.reference} started for ${money}. ${tier} switches on only once the payment is confirmed.`,
    );
    router.refresh();
  }

  async function downgrade() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/proxy/billing/change-tier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(
        Array.isArray(body.message)
          ? body.message.join('. ')
          : (body.message ?? 'Could not schedule that change.'),
      );
      return;
    }
    setConfirming(false);
    setNote(body.message ?? `Scheduled: you move to ${tier} at the end of the paid period.`);
    router.refresh();
  }

  const btn =
    'w-full rounded-lg text-sm font-medium px-4 py-2.5 transition disabled:opacity-50 disabled:cursor-not-allowed';

  if (direction === 'downgrade') {
    return (
      <div className="mt-4">
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            data-tip={
              effectiveAt
                ? `You keep ${currentTier} until ${effectiveAt}`
                : 'Moves down at the end of the paid period'
            }
            className={`tip ${btn} border border-mist bg-white hover:border-ink`}
          >
            Move down to {tier}
          </button>
        ) : (
          <div className="rounded-lg border border-clay/30 bg-clay/5 p-3">
            <p className="text-[12.5px] text-ink">
              You keep <span className="font-medium">{currentTier}</span> and everything in it
              {effectiveAt ? (
                <>
                  {' '}
                  until <span className="font-medium">{effectiveAt}</span>, the end of the period
                  you have already paid for. {tier} starts the day after.
                </>
              ) : (
                <> until the end of the period you have already paid for.</>
              )}
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={downgrade}
                disabled={busy}
                className={`${btn} bg-ink text-paper hover:bg-ink/90`}
              >
                {busy ? 'Scheduling…' : 'Schedule it'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={busy}
                className={`${btn} border border-mist bg-white hover:border-ink`}
              >
                Keep {currentTier}
              </button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-[12.5px] text-danger mt-2">
            {error}
          </p>
        )}
        {note && (
          <p role="status" className="text-[12.5px] text-brand mt-2">
            {note}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4">
      {!openForm ? (
        <button
          onClick={() => setOpenForm(true)}
          className={`${btn} bg-brand text-paper hover:bg-brand-deep`}
        >
          Pay {money} for {tier}
        </button>
      ) : (
        <form onSubmit={pay} className="rounded-lg border border-mist bg-parchment/40 p-3">
          <Combobox
            label="Pay by"
            options={CHANNELS}
            value={channel}
            onChange={setChannel}
            allowClear={false}
            placeholder="Mobile money or card"
          />
          {channel === 'MOMO' && (
            <label className="block mt-3">
              <span className="block text-[11px] uppercase tracking-wider text-oat mb-1">
                Mobile money number
              </span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="024 000 0000"
                className="w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm tabular outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
            </label>
          )}
          <p className="text-[11.5px] text-oat mt-3">
            {tier} does not switch on when you press this. You are taken to the gateway to pay{' '}
            {money}; the plan changes only when the gateway confirms the money has arrived.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              type="submit"
              disabled={busy}
              className={`${btn} bg-brand text-paper hover:bg-brand-deep`}
            >
              {busy ? 'Starting…' : `Continue to pay ${money}`}
            </button>
            <button
              type="button"
              onClick={() => setOpenForm(false)}
              disabled={busy}
              className={`${btn} border border-mist bg-white hover:border-ink`}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-[12.5px] text-danger mt-2">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="text-[12.5px] text-brand mt-2">
          {note}
        </p>
      )}
    </div>
  );
}
