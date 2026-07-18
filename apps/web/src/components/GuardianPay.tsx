'use client';

import { useState } from 'react';

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (balance <= 0) return null;

  const money = (n: number) =>
    `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/family/guardian/wards/${wardId}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(amount),
          channel,
          phone: phone.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          Array.isArray(data.message)
            ? data.message.join('. ')
            : (data.message ?? 'That did not go through.'),
        );
        return;
      }
      // The gateway owns the rest of the journey. Settlement happens on its webhook, so the
      // portal simply refreshes when the parent comes back.
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      onDone();
      setOpen(false);
    } catch {
      setError('Could not reach the school. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const field =
    'w-full min-h-11 rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-4 w-full min-h-11 rounded-lg bg-brand text-paper text-sm font-medium px-4 hover:bg-brand-deep transition"
      >
        Pay {money(balance)}
      </button>
    );
  }

  return (
    <form onSubmit={pay} className="mt-4 space-y-3 border-t border-mist/60 pt-4">
      <label className="block text-[13px]">
        <span className="block text-oat mb-1">How much would you like to pay?</span>
        <input
          required
          type="number"
          step="0.01"
          min="1"
          max={balance}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={`${field} tabular`}
        />
        <span className="block text-[11px] text-oat mt-1">
          The full balance is {money(balance)}. You can pay part of it.
        </span>
      </label>

      <fieldset>
        <legend className="text-[13px] text-oat mb-1">Pay with</legend>
        <div className="flex gap-2">
          {(['MOMO', 'CARD'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              className={`min-h-11 flex-1 rounded-lg border text-sm px-3 transition ${
                channel === c
                  ? 'border-brand bg-brand-mist font-medium text-brand'
                  : 'border-mist text-oat'
              }`}
            >
              {c === 'MOMO' ? 'Mobile money' : 'Card'}
            </button>
          ))}
        </div>
      </fieldset>

      {channel === 'MOMO' && (
        <label className="block text-[13px]">
          <span className="block text-oat mb-1">Mobile money number</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="024 000 0000"
            inputMode="tel"
            className={field}
          />
          <span className="block text-[11px] text-oat mt-1">
            Leave blank to use the number on your account.
          </span>
        </label>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        <button
          disabled={busy}
          className="min-h-11 flex-1 rounded-lg bg-brand text-paper text-sm font-medium px-4 hover:bg-brand-deep transition disabled:opacity-60"
        >
          {busy ? 'Starting…' : `Pay ${money(Number(amount) || 0)}`}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-11 px-4 text-[13px] text-oat"
        >
          Cancel
        </button>
      </div>
      <p className="text-[11px] text-oat">
        Your receipt appears here automatically once the payment clears.
      </p>
    </form>
  );
}
