'use client';

import { useCallback, useEffect, useState } from 'react';

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
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/proxy/fees/deposits?status=PENDING');
    if (res.ok) setDeposits(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function review(id: string, action: 'confirm' | 'reject') {
    setBusy(id);
    setMessage(null);
    const body =
      action === 'reject' ? JSON.stringify({ reason: 'Proof did not match the deposit' }) : '{}';
    const res = await fetch(`/api/proxy/fees/deposits/${id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok) {
      setMessage(
        action === 'confirm'
          ? data.alreadyApplied
            ? 'Already credited — no double posting.'
            : 'Confirmed and credited to the student ledger.'
          : 'Deposit rejected.',
      );
      load();
      onSettled();
    } else {
      setMessage(data.message ?? 'Could not review that deposit.');
    }
  }

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
            <tr key={d.id} className="border-b border-mist/60 last:border-0">
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
              <td className="px-6 py-2.5 text-right whitespace-nowrap">
                <button
                  onClick={() => review(d.id, 'confirm')}
                  disabled={busy === d.id}
                  className="text-[12.5px] font-medium text-brand border border-brand/40 rounded-full px-3 py-1 hover:bg-brand-mist transition disabled:opacity-50 mr-1.5"
                >
                  Confirm
                </button>
                <button
                  onClick={() => review(d.id, 'reject')}
                  disabled={busy === d.id}
                  className="text-[12.5px] font-medium text-clay border border-clay/40 rounded-full px-3 py-1 hover:bg-clay/5 transition disabled:opacity-50"
                >
                  Reject
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {message && <p className="px-6 py-3 text-sm text-brand">{message}</p>}
    </section>
  );
}
