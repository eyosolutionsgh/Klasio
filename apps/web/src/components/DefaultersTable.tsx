'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import FileField from './FileField';
import SortHeader from './SortHeader';
import { Button, useAsyncAction } from './Button';
import RowMenu from './RowMenu';
import { ChoiceCards } from './ChoiceCards';
import { CalendarIcon, CashIcon, UploadIcon } from './icons';
import type { ListSearchParams } from '@/lib/list';

export interface Defaulter {
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

/**
 * The defaulter list, with the three things a bursar does to a line on it.
 *
 * The page around this is a server component — the rows, their order and which page of them is on
 * screen are all decided on the server from the URL. Only the actions are client-side, because
 * only the actions have state: three dialogs and the outcome of the last one.
 *
 * That outcome is one toast for the whole table rather than one per row. The receipt number is
 * what the bursar reads back to the person standing at the counter, and it must not be possible
 * for two rows to be announcing different receipts at once.
 */
export default function DefaultersTable({
  rows,
  currency,
  params,
  base = '/fees',
  termId,
  canClear = false,
}: {
  rows: Defaulter[];
  currency: string;
  params: ListSearchParams;
  base?: string;
  /** The term a fee clearance would apply to. */
  termId?: string;
  /**
   * Whether to offer releasing a held report at all — true only when the school runs the
   * "no fees, no report card" policy *and* this user may override it. Offering it to a school
   * that does not withhold reports would be offering to undo something that never happened.
   */
  canClear?: boolean;
}) {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<Defaulter | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [note, setNote] = useState('');
  const [depositFor, setDepositFor] = useState<Defaulter | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [payLink, setPayLink] = useState<{ student: string; url: string } | null>(null);
  const [clearFor, setClearFor] = useState<Defaulter | null>(null);
  const [clearReason, setClearReason] = useState('');

  const money = (n: number) =>
    `${currency} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // One dialog serves every defaulter, so the attachment has to be dropped when it switches
  // student. Keyed on depositFor rather than cleared at each open/close site: a teller slip
  // submitted against the wrong child is a real accounting error, and this cannot be forgotten
  // the next time someone adds a way to close the dialog.
  useEffect(() => {
    setProof(null);
  }, [depositFor]);

  /**
   * Re-fetch the server component rather than re-fetching a list into state.
   *
   * The money on this page — billed, collected, outstanding — is computed by the API over every
   * family, not over the rows below it. Patching one row's balance in the browser would leave
   * those totals describing the ledger as it was before the payment just recorded.
   */
  const refresh = () => router.refresh();

  const recordPayment = useAsyncAction(async () => {
    if (!payFor) return;
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
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setToast(body.message ?? 'Could not record payment.');
      // Thrown so the button settles on "Couldn't record" — nothing reached the ledger.
      throw new Error('payment rejected');
    }
    // Kept even though the button says "Recorded!": the receipt number is what the bursar
    // reads back to the payer, and the button cannot carry it.
    setToast(`Payment recorded — receipt ${body.receiptNumber} for ${body.student}.`);
    setPayFor(null);
    setAmount('');
    setNote('');
    refresh();
  });

  const submitDeposit = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    if (!depositFor) return;
    const fd = new FormData(e.currentTarget);
    fd.append('studentId', depositFor.studentId);
    const res = await fetch('/api/proxy/fees/deposits', { method: 'POST', body: fd });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // The server's reason (the 8MB cap, an unreadable file) is the useful half of this.
      setToast(body.message ?? 'Could not record that deposit.');
      throw new Error('deposit rejected');
    }
    // The reference and the "nothing credited yet" caveat are both news the button cannot give.
    setToast(
      `Deposit ${body.reference} recorded — awaiting bursar confirmation. Nothing has been credited yet.`,
    );
    setDepositFor(null);
    refresh();
  });

  const grantClearance = useAsyncAction(async () => {
    if (!clearFor || !termId) throw new Error('nothing to release');
    setToast(null);
    const res = await fetch('/api/proxy/fees/clearances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: clearFor.studentId, termId, reason: clearReason.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setToast(body.message ?? 'Could not release that report.');
      throw new Error('clearance rejected');
    }
    // Says what changed and, as importantly, what did not.
    setToast(
      `${clearFor.name}'s report released. The balance of ${money(clearFor.balance)} still stands.`,
    );
    setClearFor(null);
    refresh();
  });

  const copyPayLink = useAsyncAction(async () => {
    // Clipboard access is absent on insecure origins; without this the button would tick for a
    // copy that never happened.
    if (!payLink || !navigator.clipboard) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(payLink.url);
  });

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

  return (
    <>
      {toast && (
        <p
          role="status"
          className="mx-6 mb-3 text-sm text-leaf bg-leaf/10 border border-leaf/20 rounded-lg px-3 py-2"
        >
          {toast}
        </p>
      )}

      <div className="overflow-x-auto table-stack-wrap">
        {/* `sm:` scoped: an unconditional floor survives the stacking media query and forces the
            stacked cards wider than a 375px handset, which is the sideways scroll this exists to
            remove. */}
        <table className="w-full text-sm sm:min-w-[380px] table-stack">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <SortHeader column="name" base={base} params={params} className="px-6 py-2.5">
                Student
              </SortHeader>
              <SortHeader column="className" base={base} params={params} className="px-3 py-2.5">
                Class
              </SortHeader>
              <SortHeader
                column="balance"
                base={base}
                params={params}
                align="right"
                // Largest debt first on the first click: that is the order the list already
                // arrives in, and the order a bursar chases arrears in.
                defaultOrder="desc"
                className="px-3 py-2.5"
              >
                Balance
              </SortHeader>
              <th className="px-6 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.studentId} className="border-b border-mist/60 last:border-0">
                <td data-label="Student" className="px-6 py-2.5">
                  <p className="font-medium">{d.name}</p>
                  <p className="text-[11px] text-oat tabular">{d.admissionNo}</p>
                </td>
                <td data-label="Class" className="px-3 py-2.5">
                  {d.className}
                </td>
                <td
                  data-label="Balance"
                  className="px-3 py-2.5 text-right tabular font-medium text-clay"
                >
                  {money(d.balance)}
                </td>
                <td className="px-6 py-2.5 text-right">
                  <div className="flex items-center justify-end">
                    {/*
                      What the hover tips used to say is now the item's own wording — a menu has
                      room for a phrase where a row of buttons only had room for two words.
                    */}
                    <RowMenu
                      label={d.name}
                      actions={[
                        {
                          label: 'Record a payment',
                          onSelect: () => {
                            setPayFor(d);
                            setAmount(String(d.balance));
                          },
                        },
                        {
                          label: 'Lodge a bank deposit',
                          onSelect: () => setDepositFor(d),
                        },
                        {
                          label: 'Create a pay-online link',
                          onSelect: () => createPayLink(d),
                        },
                        {
                          label: 'Release the report despite the balance',
                          hidden: !canClear || !termId,
                          onSelect: () => {
                            setClearFor(d);
                            setClearReason('');
                          },
                        },
                      ]}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-10 text-center text-oat">
                  No outstanding balances match. Try a different class or search term.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Bank-deposit submission — records a claim + proof; nothing hits the ledger yet */}
      {depositFor && (
        <div
          className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal
        >
          <form className="card w-full max-w-md p-7 rise" onSubmit={submitDeposit.run}>
            <div className="accent-rule h-[2px] -mt-7 -mx-7 mb-6 rounded-t-[10px]" />
            <h2 className="font-display text-2xl">Record bank deposit</h2>
            <p className="text-sm text-oat mt-1">
              {depositFor.name} · owes{' '}
              <span className="tabular font-medium text-clay">{money(depositFor.balance)}</span>
            </p>

            <label className="block text-sm font-medium mt-6 mb-1.5">Amount ({currency})</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                <CashIcon />
              </span>
              <input
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                defaultValue={depositFor.balance}
                className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 pl-10 tabular outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
            </div>

            <label className="block text-sm font-medium mt-4 mb-1.5">Date deposited</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                <CalendarIcon />
              </span>
              <input
                name="depositedAt"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 pl-10 text-sm outline-none focus:border-brand"
              />
            </div>

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
            <FileField
              id="deposit-proof"
              name="proof"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              value={proof}
              onChange={setProof}
              disabled={submitDeposit.state === 'pending'}
              hint="A photo of the teller or the bank's PDF receipt, up to 8MB."
            />

            <div className="flex gap-3 mt-7">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setDepositFor(null)}
              >
                Cancel
              </Button>
              {/* "Submit" is not one of the conjugated verbs, so the wording is spelled out. */}
              <Button
                type="submit"
                className="flex-1"
                state={submitDeposit.state}
                icon={<UploadIcon />}
                pendingLabel="Submitting…"
                doneLabel="Submitted!"
                failedLabel="Couldn't submit"
              >
                Submit for confirmation
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Release a held report for one family, on the record */}
      {clearFor && (
        <div
          className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal
        >
          <form onSubmit={grantClearance.run} className="card w-full max-w-lg p-7 rise">
            <h2 className="font-display text-2xl">Release {clearFor.name}&apos;s report</h2>
            <p className="text-sm text-oat mt-1">
              Their family owes {money(clearFor.balance)}. Releasing lets them read this term&apos;s
              terminal report anyway, and changes nothing about what they owe.
            </p>
            <label className="block mt-5">
              <span className="text-xs uppercase tracking-widest text-oat">Why</span>
              <textarea
                value={clearReason}
                onChange={(e) => setClearReason(e.target.value)}
                required
                minLength={4}
                rows={3}
                placeholder="On an agreed payment plan until 30 September"
                className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
              {/* The same rule as a scholarship: unexplained, it is a favour rather than a decision. */}
              <span className="mt-1 block text-xs text-oat">
                Kept on the record with your name against it, so the next bursar can tell a payment
                plan from a favour.
              </span>
            </label>
            <div className="flex gap-3 mt-6">
              <Button
                type="submit"
                className="flex-1"
                state={grantClearance.state}
                pendingLabel="Releasing…"
                doneLabel="Released!"
                failedLabel="Couldn't release"
              >
                Release report
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setClearFor(null)}
              >
                Cancel
              </Button>
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
              <Button
                type="button"
                className="flex-1"
                onClick={copyPayLink.run}
                state={copyPayLink.state}
                pendingLabel="Copying…"
                doneLabel="Copied!"
                failedLabel="Couldn't copy"
              >
                Copy link
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setPayLink(null)}
              >
                Done
              </Button>
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
          <form onSubmit={recordPayment.run} className="card w-full max-w-md p-7 rise">
            <div className="accent-rule h-[2px] -mt-7 -mx-7 mb-6 rounded-t-[10px]" />
            <h2 className="font-display text-2xl">Record payment</h2>
            <p className="text-sm text-oat mt-1">
              {payFor.name} · {payFor.className} · owes{' '}
              <span className="tabular font-medium text-clay">{money(payFor.balance)}</span>
            </p>

            <label className="block text-sm font-medium mt-6 mb-1.5" htmlFor="amount">
              Amount ({currency})
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                <CashIcon />
              </span>
              <input
                id="amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 pl-10 tabular outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
            </div>

            {/*
              No icons on the cards: only "Cash" has an obvious one, and a set where two of three
              options carry a glyph reads as a rendering fault rather than a distinction.
            */}
            <ChoiceCards
              className="mt-4"
              legend="Payment method"
              name="method"
              value={method}
              onChange={setMethod}
              options={['CASH', 'MOMO', 'BANK'].map((m) => ({ value: m, label: METHOD_LABEL[m] }))}
            />

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
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setPayFor(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1"
                state={recordPayment.state}
                icon={<CashIcon />}
              >
                Record &amp; issue receipt
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
