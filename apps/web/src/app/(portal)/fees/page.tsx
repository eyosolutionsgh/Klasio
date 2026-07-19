'use client';

import { useCallback, useEffect, useState } from 'react';
import DepositQueue from '@/components/DepositQueue';
import SendReminders from '@/components/SendReminders';

interface Overview {
  invoiced: number;
  collected: number;
  outstanding: number;
  byMethod: { method: string; amount: number }[];
  recentPayments: {
    id: string;
    student: string;
    className: string;
    amount: number;
    method: string;
    reference: string;
    receiptNumber: string | null;
    createdAt: string;
  }[];
  defaulterCount: number;
}
interface Defaulter {
  studentId: string;
  name: string;
  admissionNo: string;
  className: string;
  phone: string | null;
  balance: number;
}

const METHOD_LABEL: Record<string, string> = {
  MOMO: 'Mobile Money',
  CASH: 'Cash',
  BANK: 'Bank',
  CARD: 'Card',
};

export default function FeesPage() {
  const [termId, setTermId] = useState('');
  const [ov, setOv] = useState<Overview | null>(null);
  const [defaulters, setDefaulters] = useState<Defaulter[]>([]);
  const [payFor, setPayFor] = useState<Defaulter | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [depositFor, setDepositFor] = useState<Defaulter | null>(null);
  const [payLink, setPayLink] = useState<{ student: string; url: string } | null>(null);
  // Defaults to GHS so the first paint never shows a currency this school does not use.
  const [currency, setCurrency] = useState('GHS');

  const money = (n: number) =>
    `${currency} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  useEffect(() => {
    fetch('/api/proxy/me')
      .then((r) => r.json())
      .then((me) => {
        if (me.currentTerm) setTermId(me.currentTerm.id);
        if (me.school?.currency) setCurrency(me.school.currency);
      });
  }, []);

  const load = useCallback(async () => {
    if (!termId) return;
    const [o, d] = await Promise.all([
      fetch(`/api/proxy/fees/overview?termId=${termId}`).then((r) => r.json()),
      fetch(`/api/proxy/fees/defaulters?termId=${termId}`).then((r) => r.json()),
    ]);
    setOv(o);
    setDefaulters(d);
  }, [termId]);

  useEffect(() => {
    load();
  }, [load]);

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payFor) return;
    setBusy(true);
    const res = await fetch('/api/proxy/fees/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: payFor.studentId,
        amount: Number(amount),
        method,
        note: note || undefined,
      }),
    });
    setBusy(false);
    if (res.ok) {
      const body = await res.json();
      setToast(`Payment recorded — receipt ${body.receiptNumber} for ${body.student}.`);
      setPayFor(null);
      setAmount('');
      setNote('');
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      setToast(body.message ?? 'Could not record payment.');
    }
  }

  /** Mint a public pay link the bursar can send to the guardian (guardians have no login). */
  async function createPayLink(d: Defaulter) {
    setToast(null);
    const res = await fetch('/api/proxy/payments/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: d.studentId, channel: 'MOMO', amount: d.balance }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setPayLink({ student: d.name, url: body.payUrl });
    else setToast(body.message ?? 'Could not create a payment link.');
  }

  const collectedPct = ov && ov.invoiced > 0 ? Math.round((ov.collected / ov.invoiced) * 100) : 0;

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Fees</h1>
        <p className="text-sm text-oat mt-1.5">
          Billing, collections and the defaulter list for this term.
        </p>
      </div>

      {toast && (
        <p
          role="status"
          className="mt-4 text-sm text-leaf bg-leaf/10 border border-leaf/20 rounded-lg px-3 py-2 rise"
        >
          {toast}
        </p>
      )}

      {ov && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            {[
              {
                label: 'Invoiced',
                value: money(ov.invoiced),
                tip: 'Total billed this term',
                cls: 'rise-1',
              },
              {
                label: 'Collected',
                value: money(ov.collected),
                tip: `${collectedPct}% of invoiced`,
                cls: 'rise-2',
                tone: 'text-leaf',
              },
              {
                label: 'Outstanding',
                value: money(ov.outstanding),
                tip: 'Still to be collected',
                cls: 'rise-3',
                tone: 'text-clay',
              },
              {
                label: 'Defaulters',
                value: String(ov.defaulterCount),
                tip: 'Students with a balance owing',
                cls: 'rise-4',
              },
            ].map((s) => (
              <div
                key={s.label}
                data-tip={s.tip}
                className={`tip card card-accent p-5 rise ${s.cls}`}
              >
                <p className="text-[11px] uppercase tracking-widest text-oat">{s.label}</p>
                <p className={`font-display text-2xl mt-2 tabular ${s.tone ?? 'text-ink'}`}>
                  {s.value}
                </p>
              </div>
            ))}
          </div>

          <DepositQueue onSettled={load} />

          <div className="grid lg:grid-cols-[1.3fr_1fr] gap-6 mt-8">
            {/* Defaulters */}
            <section className="card overflow-hidden rise rise-3">
              <div className="px-6 pt-5 pb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <h2 className="font-display text-xl">Defaulters</h2>
                <span className="flex items-center gap-1 text-[12px]">
                  <span className="text-oat">Export:</span>
                  {(['csv', 'xlsx'] as const).map((f) => (
                    <a
                      key={f}
                      href={`/api/proxy/fees/defaulters/export?termId=${termId}&format=${f}`}
                      className="rounded-md border border-mist px-2 py-0.5 text-brand hover:bg-brand-mist transition uppercase"
                    >
                      {f}
                    </a>
                  ))}
                </span>
              </div>
              <div className="px-6 pb-1">
                <SendReminders termId={termId} currency={currency} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[380px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
                      <th className="px-6 py-2.5 font-medium">Student</th>
                      <th className="px-3 py-2.5 font-medium">Class</th>
                      <th className="px-3 py-2.5 font-medium text-right">Balance</th>
                      <th className="px-6 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {defaulters.slice(0, 12).map((d) => (
                      <tr key={d.studentId} className="border-b border-mist/60 last:border-0">
                        <td className="px-6 py-2.5">
                          <p className="font-medium">{d.name}</p>
                          <p className="text-[11px] text-oat tabular">{d.admissionNo}</p>
                        </td>
                        <td className="px-3 py-2.5">{d.className}</td>
                        <td className="px-3 py-2.5 text-right tabular font-medium text-clay">
                          {money(d.balance)}
                        </td>
                        <td className="px-6 py-2.5 text-right whitespace-nowrap">
                          <button
                            onClick={() => setDepositFor(d)}
                            data-tip="Record a bank deposit with proof for a bursar to confirm"
                            className="tip text-[12.5px] font-medium text-brand border border-brand/40 rounded-full px-3 py-1 hover:bg-brand-mist transition mr-1.5"
                          >
                            Bank deposit
                          </button>
                          <button
                            onClick={() => createPayLink(d)}
                            data-tip="Create a pay-online link to send to the guardian"
                            className="tip text-[12.5px] font-medium text-brand border border-brand/40 rounded-full px-3 py-1 hover:bg-brand-mist transition mr-1.5"
                          >
                            Pay link
                          </button>
                          <button
                            onClick={() => {
                              setPayFor(d);
                              setAmount(String(d.balance));
                            }}
                            className="text-[12.5px] font-medium text-brand border border-brand/40 rounded-full px-3 py-1 hover:bg-brand-mist transition"
                          >
                            Record payment
                          </button>
                        </td>
                      </tr>
                    ))}
                    {defaulters.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-6 py-10 text-center text-oat">
                          No outstanding balances — every invoice is settled. 🎉
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Recent payments + methods */}
            <div className="space-y-6">
              <section className="card p-6 rise rise-4">
                <h2 className="font-display text-xl">Collection by method</h2>
                <ul className="mt-4 space-y-3">
                  {ov.byMethod.map((m) => {
                    const pct = ov.collected > 0 ? Math.round((m.amount / ov.collected) * 100) : 0;
                    return (
                      <li key={m.method ?? 'other'}>
                        <div className="flex justify-between text-sm">
                          <span>{METHOD_LABEL[m.method] ?? m.method}</span>
                          <span className="tabular font-medium">
                            {money(m.amount)} <span className="text-oat">({pct}%)</span>
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-parchment mt-1.5 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-brand"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="card p-6 rise rise-4">
                <h2 className="font-display text-xl">Recent payments</h2>
                <ul className="mt-4 space-y-3">
                  {ov.recentPayments.slice(0, 6).map((p) => (
                    <li
                      key={p.id}
                      className="flex justify-between gap-3 text-sm border-b border-mist/50 last:border-0 pb-2.5 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="font-medium truncate">{p.student}</p>
                        <p className="text-[11px] text-oat tabular">
                          {p.receiptNumber} · {METHOD_LABEL[p.method] ?? p.method}
                        </p>
                      </div>
                      <p className="tabular font-medium text-leaf shrink-0">{money(p.amount)}</p>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </>
      )}

      {/* Bank-deposit submission — records a claim + proof; nothing hits the ledger yet */}
      {depositFor && (
        <div
          className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal
        >
          <form
            className="card w-full max-w-md p-7 rise"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              fd.append('studentId', depositFor.studentId);
              setBusy(true);
              const res = await fetch('/api/proxy/fees/deposits', { method: 'POST', body: fd });
              const body = await res.json().catch(() => ({}));
              setBusy(false);
              if (res.ok) {
                setToast(
                  `Deposit ${body.reference} recorded — awaiting bursar confirmation. Nothing has been credited yet.`,
                );
                setDepositFor(null);
                load();
              } else {
                setToast(body.message ?? 'Could not record that deposit.');
              }
            }}
          >
            <div className="accent-rule h-[2px] -mt-7 -mx-7 mb-6 rounded-t-[10px]" />
            <h2 className="font-display text-2xl">Record bank deposit</h2>
            <p className="text-sm text-oat mt-1">
              {depositFor.name} · owes{' '}
              <span className="tabular font-medium text-clay">{money(depositFor.balance)}</span>
            </p>

            <label className="block text-sm font-medium mt-6 mb-1.5">Amount ({currency})</label>
            <input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              defaultValue={depositFor.balance}
              className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 tabular outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />

            <label className="block text-sm font-medium mt-4 mb-1.5">Date deposited</label>
            <input
              name="depositedAt"
              type="date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
              className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand"
            />

            <div className="grid grid-cols-2 gap-3 mt-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Bank</label>
                <input
                  name="bankName"
                  placeholder="GCB"
                  className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Teller / ref</label>
                <input
                  name="bankRef"
                  className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand"
                />
              </div>
            </div>

            <label className="block text-sm font-medium mt-4 mb-1.5">
              Proof of payment <span className="text-oat font-normal">(photo or PDF)</span>
            </label>
            <input
              name="proof"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="text-sm"
            />

            <div className="flex gap-3 mt-7">
              <button
                type="button"
                onClick={() => setDepositFor(null)}
                className="flex-1 rounded-lg border border-mist py-2.5 text-sm hover:border-oat transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 rounded-lg bg-brand text-paper text-sm font-medium py-2.5 hover:bg-brand-deep transition disabled:opacity-60"
              >
                {busy ? 'Recording…' : 'Submit for confirmation'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Pay-link dialog — the bursar copies this to the guardian (SMS/WhatsApp) */}
      {payLink && (
        <div
          className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal
        >
          <div className="card w-full max-w-lg p-7 rise">
            <h2 className="font-display text-2xl">Payment link</h2>
            <p className="text-sm text-oat mt-1">
              Send this to {payLink.student}&apos;s guardian — they can pay by mobile money without
              needing an account.
            </p>
            <input
              readOnly
              value={payLink.url}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full mt-5 rounded-lg border border-mist bg-parchment/50 px-3.5 py-2.5 text-sm tabular outline-none"
            />
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => navigator.clipboard?.writeText(payLink.url)}
                className="flex-1 rounded-lg bg-brand text-paper text-sm font-medium py-2.5 hover:bg-brand-deep transition"
              >
                Copy link
              </button>
              <button
                onClick={() => setPayLink(null)}
                className="flex-1 rounded-lg border border-mist py-2.5 text-sm hover:border-oat transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record payment dialog */}
      {payFor && (
        <div
          className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal
        >
          <form onSubmit={recordPayment} className="card w-full max-w-md p-7 rise">
            <div className="accent-rule h-[2px] -mt-7 -mx-7 mb-6 rounded-t-[10px]" />
            <h2 className="font-display text-2xl">Record payment</h2>
            <p className="text-sm text-oat mt-1">
              {payFor.name} · {payFor.className} · owes{' '}
              <span className="tabular font-medium text-clay">{money(payFor.balance)}</span>
            </p>

            <label className="block text-sm font-medium mt-6 mb-1.5" htmlFor="amount">
              Amount ({currency})
            </label>
            <input
              id="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 tabular outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />

            <label className="block text-sm font-medium mt-4 mb-1.5">Payment method</label>
            <div className="grid grid-cols-3 gap-2">
              {['CASH', 'MOMO', 'BANK'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`rounded-lg border px-3 py-2 text-sm transition ${
                    method === m
                      ? 'bg-brand text-paper border-brand'
                      : 'border-mist bg-white hover:border-brand'
                  }`}
                >
                  {METHOD_LABEL[m]}
                </button>
              ))}
            </div>

            <label className="block text-sm font-medium mt-4 mb-1.5" htmlFor="note">
              Note <span className="text-oat font-normal">(optional)</span>
            </label>
            <input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. MoMo from 024 xxx, part payment"
              className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />

            <div className="flex gap-3 mt-7">
              <button
                type="button"
                onClick={() => setPayFor(null)}
                className="flex-1 rounded-lg border border-mist py-2.5 text-sm hover:border-oat transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 rounded-lg bg-brand text-paper text-sm font-medium py-2.5 hover:bg-brand-deep transition disabled:opacity-60"
              >
                {busy ? 'Recording…' : 'Record & issue receipt'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
