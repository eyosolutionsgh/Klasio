'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, useAsyncAction } from '@/components/Button';
import { CashIcon, CloseIcon } from '@/components/icons';
import { DEFAULT_PER_PAGE, type Page } from '@/lib/list';

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

const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Bank deposits claimed with proof. Nothing here has touched the ledger — confirming is what
 * turns a claim into money, so the bursar reviews the proof first.
 *
 * The queue pages on its own state rather than through the URL. It is a panel embedded in the fees
 * page, not the page's subject: driving it from `?page=` would mean a bursar working through
 * deposits also moved the defaulter list underneath, and a link to "the fees page, page 3" would
 * be ambiguous about which of the two tables it meant.
 */
export default function DepositQueue({ currency = 'GHS' }: { currency?: string }) {
  const router = useRouter();
  const [queue, setQueue] = useState<Page<Deposit> | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  /**
   * Confirming a deposit the ledger already carries succeeds without posting anything — an
   * outcome the button's tick cannot describe, and the one thing a bursar needs told, so it
   * survives the removal of the other success notes.
   */
  const [notice, setNotice] = useState<string | null>(null);

  const money = (n: number) =>
    `${currency} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const load = useCallback(async () => {
    const res = await fetch(`/api/proxy/fees/deposits?status=PENDING&page=${page}`);
    if (res.ok) setQueue(await res.json());
  }, [page]);

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
      await load();
      /**
       * Confirming appends a PAYMENT to the ledger, so the collected and outstanding figures on
       * the page around this are now stale. They are server-rendered from the API's own totals, so
       * the honest refresh is to ask the server again rather than to adjust a number here.
       */
      router.refresh();
    },
    [load, router],
  );

  const total = queue?.total ?? 0;
  // Hidden entirely when no deposit is waiting: a school that never takes bank slips should not
  // carry an empty table down the middle of its fees page.
  if (total === 0) return null;
  const rows = queue?.rows ?? [];
  const pageCount = queue?.pageCount ?? 1;
  const current = Math.min(queue?.page ?? 1, pageCount);
  const first = (current - 1) * (queue?.perPage ?? DEFAULT_PER_PAGE) + 1;

  return (
    <section className="card overflow-hidden rise rise-3 mt-6">
      <div className="px-6 pt-5 pb-3">
        <h2 className="font-display text-xl">Bank deposits awaiting confirmation</h2>
        <p className="text-xs text-oat mt-1">
          None of these are in the ledger yet — confirming credits the student and issues a receipt.
        </p>
      </div>
      <div className="overflow-x-auto table-stack-wrap">
        <table className="w-full text-sm table-stack">
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
            {rows.map((d) => (
              <DepositRow key={d.id} deposit={d} review={review} money={money} />
            ))}
          </tbody>
        </table>
      </div>

      {/*
        The count is the point of this strip even on a single page: "3 awaiting" is what tells a
        bursar the queue is nearly done, and it is the figure the old version could never show.
      */}
      <nav
        className="flex flex-wrap items-center justify-between gap-3 border-t border-mist px-4 py-3 text-sm sm:px-6"
        aria-label="Deposit queue pages"
      >
        <p className="text-oat">
          <span className="tabular">
            {first}–{first + rows.length - 1}
          </span>{' '}
          of <span className="tabular font-medium text-ink">{total}</span> awaiting confirmation
        </p>
        {pageCount > 1 && (
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={current <= 1}
              onClick={() => setPage(current - 1)}
            >
              Previous
            </Button>
            <span className="tabular text-oat px-1">
              {current} / {pageCount}
            </span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={current >= pageCount}
              onClick={() => setPage(current + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </nav>

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
  money,
}: {
  deposit: Deposit;
  review: (id: string, action: 'confirm' | 'reject') => Promise<void>;
  money: (n: number) => string;
}) {
  const confirm = useAsyncAction(() => review(d.id, 'confirm'));
  const reject = useAsyncAction(() => review(d.id, 'reject'));

  return (
    <tr className="border-b border-mist/60 last:border-0">
      <td data-label="Student" className="px-6 py-2.5">
        <p className="font-medium">{d.student}</p>
        <p className="text-[11px] text-oat tabular">
          {d.admissionNo} · {d.reference}
        </p>
      </td>
      <td data-label="Bank" className="px-3 py-2.5 text-oat text-xs">
        <span className="block">{d.bankName ?? '—'}</span>
        {d.bankRef && <span className="block tabular">{d.bankRef}</span>}
        <span className="block">{fmt(d.depositedAt)}</span>
      </td>
      <td data-label="Amount" className="px-3 py-2.5 text-right tabular font-medium">
        {money(d.amount)}
      </td>
      <td data-label="Proof" className="px-3 py-2.5">
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
        <div className="flex flex-wrap items-center justify-end gap-1.5">
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
