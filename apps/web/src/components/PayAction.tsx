'use client';

import { useState } from 'react';
import { Button, useAsyncAction } from '@/components/Button';
import { PhoneIcon } from '@/components/icons';

/** Starts gateway checkout for a public pay link and hands the payer off to the gateway. */
export default function PayAction({ token, reference }: { token: string; reference: string }) {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  const pay = useAsyncAction(async () => {
    setError(null);
    const res = await fetch(`/api/pay/payments/public/${token}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phone || undefined }),
    }).catch(() => null);
    const data: { message?: string; checkoutUrl?: string } = res
      ? await res.json().catch(() => ({}))
      : {};
    if (!res || !res.ok) {
      // The gateway's own words — "number not on MTN MoMo", "link already paid" — are what the
      // payer can act on, so they stay on screen beside the button's "Couldn't start payment".
      setError(data.message ?? 'Could not start payment');
      throw new Error('checkout rejected');
    }
    if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
    } else {
      window.location.href = `/pay/return?ref=${encodeURIComponent(reference)}`;
    }
  });

  return (
    <div className="mt-6">
      <label className="block text-sm font-medium mb-1.5" htmlFor="phone">
        Mobile money number <span className="text-oat font-normal">(optional)</span>
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
          <PhoneIcon />
        </span>
        <input
          id="phone"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="024 123 4567"
          className="w-full rounded-lg border border-mist bg-white pl-10 pr-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
        />
      </div>
      <Button
        onClick={pay.run}
        state={pay.state}
        className="mt-4 w-full"
        // "Pay" is not one of the conjugated verbs, and the wording matters here — the payer is
        // about to be sent to a gateway, so say that rather than "Working…".
        pendingLabel="Starting payment…"
        doneLabel="Redirecting…"
        failedLabel="Couldn't start payment"
      >
        Pay now
      </Button>
      {error && <p className="mt-3 text-sm text-danger text-center">{error}</p>}
    </div>
  );
}
