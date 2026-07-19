'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, useAsyncAction } from '@/components/Button';
import { CashIcon, CloseIcon } from '@/components/icons';

interface Deposit {
  id: string;
  reference: string;
  student: string;
  admissionNo: string;
  amount: number;
  bankName: string | null;
  bankRef: string | null;
  depositedAt: string;
  hasProof: boolean;
  status: string;
  note: string | null;
  reviewNote: string | null;
}

const money = (n: number) =>
  `GHS ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Bank deposits claimed with proof. Nothing here has touched the ledger — confirming is what
 * turns a claim into money, so the bursar reviews the proof first.
 */
export default function DepositQueue({ onSettled }: { onSettled: () => void }) {
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [error, setError] = useState<string | null>(null);
  /**
   * Confirming a deposit the ledger already carries succeeds without posting anything — an
   * outcome the button's tick cannot describe, and the one thing a bursar needs told, so it
   * survives the removal of the other success notes.
   */
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/proxy/fees/deposits?status=PENDING');
    if (res.ok) setDeposits(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const review = useCallback(
    async (id: string, action: 'confirm' | 'reject') => {
      setError(null);
      setNotice(null);
      const body =
        action === 'reject' ? JSON.stringify({ reason: 'Proof did not match the deposit' }) : '{}';
      const res = await fetch(`/api/proxy/fees/deposits/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The API's own reason — a deposit already reviewed, a missing proof — is the useful part.
        setError(data.message ?? 'Could not review that deposit.');
        throw new Error('review rejected');
      }
      if (action === 'confirm' && data.alreadyApplied)
        setNotice('Already credited — no double posting.');
      load();
      onSettled();
    },
    [load, onSettled],
  );

  if (deposits.length === 0) return null;

  return (
    <section className="card overflow-hidden rise rise-3 mt-6">
      <div className="px-6 pt-5 pb-3">
        <h2 className="font-display text-xl">Bank deposits awaiting confirmation</h2>
        <p className="text-xs text-oat mt-1">
          None of these are in the ledger yet — confirming credits the student and issues a receipt.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
            <th className="px-6 py-2.5 font-medium">Student</th>
            <th className="px-3 py-2.5 font-medium">Bank</th>
            <th className="px-3 py-2.5 font-medium text-right">Amount</th>
            <th className="px-3 py-2.5 font-medium">Proof</th>
            <th className="px-6 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {deposits.map((d) => (
            <DepositRow key={d.id} deposit={d} review={review} />
          ))}
        </tbody>
      </table>
      {notice && <p className="px-6 py-3 text-sm text-brand">{notice}</p>}
      {error && <p className="px-6 py-3 text-sm text-danger">{error}</p>}
    </section>
  );
}

/**
 * One claim, with its own pair of buttons.
 *
 * A row rather than inline markup because each row runs its own action: the pending/outcome state
 * belongs to the deposit being reviewed, not to the queue.
 */
function DepositRow({
  deposit: d,
  review,
}: {
  deposit: Deposit;
  review: (id: string, action: 'confirm' | 'reject') => Promise<void>;
}) {
  const confirm = useAsyncAction(() => review(d.id, 'confirm'));
  const reject = useAsyncAction(() => review(d.id, 'reject'));

  return (
    <tr className="border-b border-mist/60 last:border-0">
      <td className="px-6 py-2.5">
        <p className="font-medium">{d.student}</p>
        <p className="text-[11px] text-oat tabular">
          {d.admissionNo} · {d.reference}
        </p>
      </td>
      <td className="px-3 py-2.5 text-oat text-xs">
        {d.bankName ?? '—'}
        {d.bankRef && <span className="block tabular">{d.bankRef}</span>}
        <span className="block">{fmt(d.depositedAt)}</span>
      </td>
      <td className="px-3 py-2.5 text-right tabular font-medium">{money(d.amount)}</td>
      <td className="px-3 py-2.5">
        {d.hasProof ? (
          <a
            href={`/api/proxy/fees/deposits/${d.id}/proof`}
            className="text-[12.5px] text-brand hover:underline underline-offset-2"
          >
            View proof
          </a>
        ) : (
          <span className="text-xs text-clay">none attached</span>
        )}
      </td>
      <td className="px-6 py-2.5">
        <div className="flex items-center justify-end gap-1.5">
          {/* Cash, not a tick: confirming is what puts the money on the student's ledger. */}
          <Button
            size="sm"
            onClick={confirm.run}
            state={confirm.state}
            icon={<CashIcon />}
            pendingLabel="Confirming…"
            doneLabel="Confirmed!"
            failedLabel="Couldn't confirm"
          >
            Confirm
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={reject.run}
            state={reject.state}
            icon={<CloseIcon />}
            pendingLabel="Rejecting…"
            doneLabel="Rejected!"
            failedLabel="Couldn't reject"
          >
            Reject
          </Button>
        </div>
      </td>
    </tr>
  );
}
