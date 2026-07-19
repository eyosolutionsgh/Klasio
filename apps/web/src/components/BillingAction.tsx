'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Combobox from './Combobox';
import { Button, useAsyncAction } from './Button';
import { CashIcon, PhoneIcon } from './icons';

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

  const pay = useAsyncAction(async () => {
    setError(null);
    const res = await fetch('/api/proxy/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier, channel, phone: phone || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        Array.isArray(body.message)
          ? body.message.join('. ')
          : (body.message ?? 'Could not start that payment.'),
      );
      // The button may only report failure once the action has actually rejected.
      throw new Error('rejected');
    }
    if (body.checkoutUrl) {
      // Leaving the portal entirely: the tier still has not moved, and will not until the
      // gateway calls back. Nothing is updated optimistically here.
      window.location.href = body.checkoutUrl;
      return;
    }
    setNote(
      `Payment ${body.reference} started for ${money}. ${tier} switches on only once the payment is confirmed.`,
    );
    router.refresh();
  });

  const downgrade = useAsyncAction(async () => {
    setError(null);
    const res = await fetch('/api/proxy/billing/change-tier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        Array.isArray(body.message)
          ? body.message.join('. ')
          : (body.message ?? 'Could not schedule that change.'),
      );
      throw new Error('rejected');
    }
    setConfirming(false);
    setNote(body.message ?? `Scheduled: you move to ${tier} at the end of the paid period.`);
    router.refresh();
  });

  if (direction === 'downgrade') {
    return (
      <div className="mt-4">
        {!confirming ? (
          <Button
            variant="secondary"
            onClick={() => setConfirming(true)}
            data-tip={
              effectiveAt
                ? `You keep ${currentTier} until ${effectiveAt}`
                : 'Moves down at the end of the paid period'
            }
            className="tip w-full"
          >
            {`Move down to ${tier}`}
          </Button>
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
              {/*
                "Schedule" is not one of the conjugated verbs, so its wording is spelled out. The
                ink treatment is kept over the primary variant's brand teal, but only while the
                button is offering itself — the tick and the alert carry their own colours.
              */}
              <Button
                onClick={downgrade.run}
                state={downgrade.state}
                pendingLabel="Scheduling…"
                doneLabel="Scheduled!"
                failedLabel="Couldn't schedule"
                className={`w-full ${
                  downgrade.state === 'done' || downgrade.state === 'failed'
                    ? ''
                    : 'bg-ink! hover:bg-ink/90!'
                }`}
              >
                Schedule it
              </Button>
              <Button
                variant="secondary"
                onClick={() => setConfirming(false)}
                disabled={downgrade.state === 'pending'}
                className="w-full"
              >
                {`Keep ${currentTier}`}
              </Button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-[12.5px] text-danger mt-2">
            {error}
          </p>
        )}
        {/*
          Kept even though the button now says "Scheduled!": this is the server's own wording for
          *when* the change lands, which the button has no room to say.
        */}
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
        <Button onClick={() => setOpenForm(true)} icon={<CashIcon />} className="w-full">
          {`Pay ${money} for ${tier}`}
        </Button>
      ) : (
        <form onSubmit={pay.run} className="rounded-lg border border-mist bg-parchment/40 p-3">
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
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                  <PhoneIcon />
                </span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="024 000 0000"
                  className="w-full min-h-11 rounded-lg border border-mist bg-white pl-10 pr-3.5 py-2 text-sm tabular outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                />
              </div>
            </label>
          )}
          <p className="text-[11.5px] text-oat mt-3">
            {tier} does not switch on when you press this. You are taken to the gateway to pay{' '}
            {money}; the plan changes only when the gateway confirms the money has arrived.
          </p>
          <div className="flex gap-2 mt-3">
            {/* "Continue" is not one of the conjugated verbs, so its wording is spelled out. */}
            <Button
              type="submit"
              state={pay.state}
              icon={<CashIcon />}
              pendingLabel="Starting…"
              doneLabel="Started!"
              failedLabel="Couldn't start"
              className="w-full"
            >
              {`Continue to pay ${money}`}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpenForm(false)}
              disabled={pay.state === 'pending'}
              className="w-full"
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-[12.5px] text-danger mt-2">
          {error}
        </p>
      )}
      {/*
        Kept: this carries the payment reference and the fact that the tier has *not* moved yet —
        neither of which fits on the button.
      */}
      {note && (
        <p role="status" className="text-[12.5px] text-brand mt-2">
          {note}
        </p>
      )}
    </div>
  );
}
