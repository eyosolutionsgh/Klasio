'use client';

import { use, useState } from 'react';

/**
 * Stand-in for a real gateway's hosted checkout, used when a school has connected no
 * gateway (dev/demo). Completing here posts the same signed callback a real gateway sends,
 * so the production settlement path is what gets exercised.
 */
export default function MockCheckoutPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = use(params);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function complete(outcome: 'success' | 'failed') {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/pay/payments/mock/${encodeURIComponent(reference)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? 'Could not complete');
      setBusy(false);
      return;
    }
    window.location.href = `/pay/return?ref=${encodeURIComponent(reference)}`;
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card max-w-md w-full p-8 text-center">
        <p className="text-[11px] uppercase tracking-widest text-oat">Test gateway</p>
        <p className="font-display text-2xl mt-2">Simulate payment</p>
        <p className="text-sm text-oat mt-2">
          No real money moves here. This school has not connected a live payment gateway.
        </p>
        <p className="text-[11px] text-oat mt-4 tabular">{reference}</p>
        <div className="mt-6 space-y-2">
          <button
            onClick={() => complete('success')}
            disabled={busy}
            className="w-full rounded-lg bg-forest text-paper font-medium py-3 hover:bg-forest-deep transition disabled:opacity-60"
          >
            {busy ? 'Working…' : 'Approve payment'}
          </button>
          <button
            onClick={() => complete('failed')}
            disabled={busy}
            className="w-full rounded-lg border border-mist py-2.5 text-sm hover:border-oat transition disabled:opacity-60"
          >
            Decline
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>
    </main>
  );
}
