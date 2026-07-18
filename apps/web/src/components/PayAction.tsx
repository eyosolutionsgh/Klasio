'use client';

import { useState } from 'react';

/** Starts gateway checkout for a public pay link and hands the payer off to the gateway. */
export default function PayAction({ token, reference }: { token: string; reference: string }) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pay/payments/public/${token}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Could not start payment');
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        window.location.href = `/pay/return?ref=${encodeURIComponent(reference)}`;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start payment');
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <label className="block text-sm font-medium mb-1.5" htmlFor="phone">
        Mobile money number <span className="text-oat font-normal">(optional)</span>
      </label>
      <input
        id="phone"
        inputMode="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="024 123 4567"
        className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
      />
      <button
        onClick={pay}
        disabled={busy}
        className="mt-4 w-full rounded-lg bg-brand text-paper font-medium py-3 hover:bg-brand-deep transition disabled:opacity-60"
      >
        {busy ? 'Starting payment…' : 'Pay now'}
      </button>
      {error && <p className="mt-3 text-sm text-danger text-center">{error}</p>}
    </div>
  );
}
