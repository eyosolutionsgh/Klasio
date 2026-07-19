'use client';

import { Suspense, use, useState } from 'react';
import { Button, useAsyncAction } from '@/components/Button';
import { CheckIcon, CloseIcon } from '@/components/icons';

/** Which service settles this reference. Anything else is treated as a school fee payment. */

/**
 * Stand-in for a real gateway's hosted checkout, used when a school has connected no
 * gateway (dev/demo). Completing here posts the same signed callback a real gateway sends,
 * so the production settlement path is what gets exercised.
 *
 * There is one settling module now. `?via=` used to pick between school fees and a school's own
 * subscription to the vendor; subscriptions are gone with the SaaS plane, so every mock
 * completion is a school fee.
 */
function MockCheckout({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = use(params);
  const [error, setError] = useState<string | null>(null);

  async function complete(outcome: 'success' | 'failed') {
    setError(null);
    const res = await fetch(`/api/pay/payments/mock/${encodeURIComponent(reference)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      // The gateway's own message is the useful half — the button can only say it failed.
      setError(d.message ?? 'Could not complete');
      throw new Error('rejected');
    }
    window.location.href = `/pay/return?ref=${encodeURIComponent(reference)}`;
  }

  const approve = useAsyncAction(() => complete('success'));
  const decline = useAsyncAction(() => complete('failed'));

  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
      <div className="card max-w-md w-full p-8 text-center">
        <p className="text-[11px] uppercase tracking-widest text-oat">Test gateway</p>
        <p className="font-display text-2xl mt-2">Simulate payment</p>
        <p className="text-sm text-oat mt-2">
          No real money moves here. This school has not connected a live payment gateway.
        </p>
        <p className="text-[11px] text-oat mt-4 tabular">{reference}</p>
        {/*
          Each button carries its own state, but either one in flight disables the other: the two
          outcomes settle the same reference, so letting both be pressed would race.
        */}
        <div className="mt-6 space-y-2">
          <Button
            onClick={approve.run}
            state={approve.state}
            disabled={decline.state === 'pending'}
            icon={<CheckIcon />}
            /*
              Forest, not the default brand teal: the public payer surfaces (pay, apply, family)
              are navy throughout. Marked important because `bg-forest` and the variant's
              `bg-brand` are both plain background utilities — which one wins is decided by
              Tailwind's own sort order, not by the order they appear here. Dropped once the
              action settles, so the button's own green/red outcome colour still comes through.
            */
            className={`w-full ${
              approve.state === 'done' || approve.state === 'failed'
                ? ''
                : 'bg-forest! text-paper hover:bg-forest-deep!'
            }`}
          >
            Approve payment
          </Button>
          <Button
            onClick={decline.run}
            state={decline.state}
            disabled={approve.state === 'pending'}
            variant="secondary"
            size="sm"
            icon={<CloseIcon />}
            pendingLabel="Declining…"
            doneLabel="Declined!"
            failedLabel="Couldn't decline"
            className="w-full"
          >
            Decline
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>
    </main>
  );
}

// `use(params)` suspends, and this page is only ever reached by a gateway redirect, so there is
// nothing worth rendering before the reference is known.
export default function MockCheckoutPage(props: { params: Promise<{ reference: string }> }) {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <MockCheckout {...props} />
    </Suspense>
  );
}
