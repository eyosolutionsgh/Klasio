'use client';

import { useState } from 'react';
import { Button, useAsyncAction } from './Button';
import { ChoiceCards } from './ChoiceCards';
import { CashIcon, PhoneIcon } from './icons';

/**
 * Paying a school bill from the family portal.
 *
 * A parent should be able to clear a balance from their phone, at night, without asking the
 * school for a link first. Defaults to the whole balance because that is what most people want;
 * part-payment is offered because most people cannot always pay it all at once.
 */
export default function GuardianPay({
  wardId,
  balance,
  currency,
  onDone,
}: {
  wardId: string;
  balance: number;
  currency: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(balance));
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState<'MOMO' | 'CARD'>('MOMO');
  const [error, setError] = useState('');

  const money = (n: number) =>
    `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Declared before the `balance <= 0` bail-out below: a hook cannot sit behind an early return.
  const pay = useAsyncAction(async () => {
    setError('');
    let res: Response;
    try {
      res = await fetch(`/api/family/guardian/wards/${wardId}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(amount),
          channel,
          phone: phone.trim() || undefined,
        }),
      });
    } catch {
      setError('Could not reach the school. Check your connection and try again.');
      throw new Error('offline');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        Array.isArray(data.message)
          ? data.message.join('. ')
          : (data.message ?? 'That did not go through.'),
      );
      throw new Error('checkout rejected');
    }
    // The gateway owns the rest of the journey. Settlement happens on its webhook, so the
    // portal simply refreshes when the parent comes back.
    if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
      return;
    }
    onDone();
    setOpen(false);
  });

  if (balance <= 0) return null;

  const field =
    'w-full min-h-11 rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} icon={<CashIcon />} className="mt-4 w-full">
        {`Pay ${money(balance)}`}
      </Button>
    );
  }

  return (
    <form onSubmit={pay.run} className="mt-4 space-y-3 border-t border-mist/60 pt-4">
      <label className="block text-[13px]">
        <span className="block text-oat mb-1">How much would you like to pay?</span>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
            <CashIcon />
          </span>
          <input
            required
            type="number"
            step="0.01"
            min="1"
            max={balance}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${field} tabular pl-10`}
          />
        </div>
        <span className="block text-[11px] text-oat mt-1">
          The full balance is {money(balance)}. You can pay part of it.
        </span>
      </label>

      <ChoiceCards
        legend="Pay with"
        name="channel"
        value={channel}
        onChange={setChannel}
        options={[
          // Mobile money is paid from a phone number; a card is money off a card.
          { value: 'MOMO', label: 'Mobile money', icon: <PhoneIcon /> },
          { value: 'CARD', label: 'Card', icon: <CashIcon /> },
        ]}
      />

      {channel === 'MOMO' && (
        <label className="block text-[13px]">
          <span className="block text-oat mb-1">Mobile money number</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
              <PhoneIcon />
            </span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="024 000 0000"
              inputMode="tel"
              className={`${field} pl-10`}
            />
          </div>
          <span className="block text-[11px] text-oat mt-1">
            Leave blank to use the number on your account.
          </span>
        </label>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        <Button
          type="submit"
          state={pay.state}
          icon={<CashIcon />}
          className="flex-1"
          // The press only opens the gateway — "Paid!" would claim more than has happened.
          pendingLabel="Starting…"
          doneLabel="Started!"
          failedLabel="Couldn't start"
        >
          {`Pay ${money(Number(amount) || 0)}`}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <p className="text-[11px] text-oat">
        Your receipt appears here automatically once the payment clears.
      </p>
    </form>
  );
}
