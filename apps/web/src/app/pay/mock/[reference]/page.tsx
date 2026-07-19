'use client';

import { Suspense, use, useState } from 'react';
import { useSearchParams } from 'next/navigation';

/** Which service settles this reference. Anything else is treated as a school fee payment. */
const ROUTES = ['payments', 'billing'] as const;

/**
 * Stand-in for a real gateway's hosted checkout, used when a school has connected no
 * gateway (dev/demo). Completing here posts the same signed callback a real gateway sends,
 * so the production settlement path is what gets exercised.
 *
 * The gateway tells us who to call back with `?via=`. School fees and a school's own
 * subscription are settled by different services against different tables, and guessing from
 * the reference would put one module's naming convention in this page.
 */
function MockCheckout({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = use(params);
  const search = useSearchParams();
  const requested = search.get('via');
  const via = ROUTES.includes(requested as (typeof ROUTES)[number]) ? requested : 'payments';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function complete(outcome: 'success' | 'failed') {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/pay/${via}/mock/${encodeURIComponent(reference)}/complete`, {
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
    // Back where that kind of payer belongs: a guardian to the public return page, a school
    // owner to their own subscription page, which reads `ref` to report what happened.
    const ref = encodeURIComponent(reference);
    window.location.href =
      via === 'billing' ? `/settings/billing?ref=${ref}` : `/pay/return?ref=${ref}`;
  }

  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
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

// `useSearchParams` suspends, and this page is only ever reached by a gateway redirect, so
// there is nothing worth rendering before the query string is known.
export default function MockCheckoutPage(props: { params: Promise<{ reference: string }> }) {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <MockCheckout {...props} />
    </Suspense>
  );
}
