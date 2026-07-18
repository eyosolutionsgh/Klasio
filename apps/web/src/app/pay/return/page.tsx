'use client';

import { useCallback, useEffect, useState } from 'react';

interface Status {
  reference: string;
  status: string;
  amount: number;
  currency: string;
}

/**
 * Where the gateway returns the payer. Polls the read-only status endpoint — settlement
 * itself happens server-side from the gateway webhook, so this page only observes.
 */
export default function PayReturnPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [tries, setTries] = useState(0);
  const reference =
    typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('ref') ?? '')
      : '';

  const poll = useCallback(async () => {
    if (!reference) return;
    const res = await fetch(`/api/pay/payments/${encodeURIComponent(reference)}/status`);
    if (res.ok) setStatus(await res.json());
  }, [reference]);

  useEffect(() => {
    poll();
  }, [poll]);

  useEffect(() => {
    if (!status || status.status === 'SUCCESS' || tries > 20) return;
    const t = setTimeout(() => {
      setTries((n) => n + 1);
      poll();
    }, 3000);
    return () => clearTimeout(t);
  }, [status, tries, poll]);

  const settled = status?.status === 'SUCCESS';
  const failed = status?.status === 'FAILED' || status?.status === 'EXPIRED';

  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
      <div className="card max-w-md w-full p-8 text-center relative overflow-hidden">
        <div className="kente-stripe h-1.5 absolute top-0 left-0 right-0" />
        {settled ? (
          <>
            <p className="font-display text-2xl mt-2 text-leaf">Payment received</p>
            <p className="text-sm text-oat mt-2">
              Thank you. The school has recorded {status.currency}{' '}
              {status.amount.toLocaleString('en-GH', { minimumFractionDigits: 2 })} against your
              ward&apos;s account.
            </p>
          </>
        ) : failed ? (
          <>
            <p className="font-display text-2xl mt-2 text-danger">Payment not completed</p>
            <p className="text-sm text-oat mt-2">
              Nothing was charged. Please try the payment link again or contact the school.
            </p>
          </>
        ) : (
          <>
            <p className="font-display text-2xl mt-2">Confirming payment…</p>
            <p className="text-sm text-oat mt-2">
              This can take a few moments while your mobile money provider confirms. You can safely
              close this page — the school will still receive the payment.
            </p>
          </>
        )}
        {status && (
          <p className="text-[11px] text-oat mt-6 tabular">Reference {status.reference}</p>
        )}
      </div>
    </main>
  );
}
