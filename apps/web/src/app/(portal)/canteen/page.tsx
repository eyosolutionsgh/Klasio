'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, useAsyncAction } from '@/components/Button';
import ConfirmButton from '@/components/ConfirmButton';

/**
 * Canteen wallet (canteen.wallet): a prepaid till, one wallet per pupil.
 *
 * The counter's whole job on one screen — find a child, see the balance, take a top-up or record a
 * lunch — with the day's totals above it. The balance is derived from an append-only ledger, so a
 * mistake is undone with a reversal, never an edit.
 */
interface Account {
  studentId: string;
  name: string;
  admissionNo: string | null;
  className: string | null;
  balance: number;
}
interface Txn {
  id: string;
  studentId: string;
  name: string;
  type: 'TOPUP' | 'SPEND' | 'REVERSAL';
  amount: number;
  note: string | null;
  createdAt: string;
  reversed: boolean;
}
interface Overview {
  stats: { funded: number; held: number; topupsToday: number; spendToday: number };
  accounts: Account[];
  recent: Txn[];
}

const field =
  'min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

const cedis = (n: number) =>
  `GHS ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const time = (d: string) =>
  new Date(d).toLocaleString('en-GH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function CanteenPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/proxy/canteen');
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    load();
    fetch('/api/proxy/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => setCanManage((me?.permissions ?? []).includes('canteen.manage')))
      .catch(() => {});
  }, [load]);

  async function send(path: string, body?: unknown) {
    setError(null);
    const res = await fetch(`/api/proxy${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        Array.isArray(d.message) ? d.message.join('. ') : (d.message ?? 'That did not work.'),
      );
      throw new Error('rejected');
    }
    await load();
    return d;
  }

  return (
    <div className="max-w-4xl">
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Canteen</h1>
        <p className="text-sm text-oat mt-1.5 max-w-prose">
          A prepaid wallet for each pupil. Take a top-up, record a lunch, and see who is running low
          — the balance is kept on an append-only ledger, so it always adds up.
        </p>
      </div>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      {data && (
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4 rise rise-2">
          {[
            ['Wallets funded', String(data.stats.funded)],
            ['Held', cedis(data.stats.held)],
            ['Topped up today', cedis(data.stats.topupsToday)],
            ['Spent today', cedis(data.stats.spendToday)],
          ].map(([label, v]) => (
            <div key={label} className="card p-4">
              <p className="text-[11px] uppercase tracking-wider text-oat">{label}</p>
              <p className="font-display text-xl mt-1 tabular">{v}</p>
            </div>
          ))}
        </div>
      )}

      {canManage && <Counter send={send} />}

      <div className="mt-6 grid lg:grid-cols-2 gap-5">
        <section className="card p-5">
          <h2 className="font-display text-lg">Wallets</h2>
          <p className="text-[12px] text-oat mt-0.5">Lowest balances first.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {(data?.accounts ?? []).map((a) => (
                  <tr key={a.studentId} className="border-b border-mist/40 last:border-0">
                    <td className="py-2">
                      {a.name}
                      {a.className ? <span className="text-oat"> · {a.className}</span> : null}
                    </td>
                    <td
                      className={`py-2 text-right tabular font-medium ${
                        a.balance <= 0 ? 'text-clay' : ''
                      }`}
                    >
                      {cedis(a.balance)}
                    </td>
                  </tr>
                ))}
                {data && data.accounts.length === 0 && (
                  <tr>
                    <td className="py-6 text-center text-oat" colSpan={2}>
                      No wallets funded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="font-display text-lg">Recent activity</h2>
          <ul className="mt-3 space-y-2">
            {(data?.recent ?? []).map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 text-[13px]">
                <span className={t.reversed ? 'line-through text-oat' : ''}>
                  <span className="font-medium">{t.name}</span>{' '}
                  <span className="text-oat">
                    · {t.note ?? (t.type === 'TOPUP' ? 'Top-up' : t.type.toLowerCase())} ·{' '}
                    {time(t.createdAt)}
                  </span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span
                    className={`tabular font-medium ${
                      t.type === 'TOPUP'
                        ? 'text-leaf'
                        : t.type === 'SPEND'
                          ? 'text-clay'
                          : 'text-oat'
                    }`}
                  >
                    {t.type === 'TOPUP' ? '+' : t.type === 'SPEND' ? '−' : ''}
                    {cedis(t.amount)}
                  </span>
                  {canManage && t.type !== 'REVERSAL' && !t.reversed && (
                    <ConfirmButton
                      label="Reverse"
                      question="Reverse this entry?"
                      confirmLabel="Reverse"
                      danger
                      triggerClassName="text-[11px] text-clay hover:underline underline-offset-2"
                      onConfirm={() => send(`/canteen/txns/${t.id}/reverse`)}
                    />
                  )}
                </span>
              </li>
            ))}
            {data && data.recent.length === 0 && (
              <li className="text-[13px] text-oat">Nothing yet.</li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Counter({ send }: { send: (path: string, body?: unknown) => Promise<unknown> }) {
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<Account[]>([]);
  const [picked, setPicked] = useState<Account | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  async function search(term: string) {
    setQ(term);
    setPicked(null);
    if (term.trim().length < 1) {
      setMatches([]);
      return;
    }
    const res = await fetch(`/api/proxy/canteen/students?q=${encodeURIComponent(term)}`);
    if (res.ok) setMatches(await res.json());
  }

  const topup = useAsyncAction(async () => {
    if (!picked) return;
    const r = (await send('/canteen/topup', {
      studentId: picked.studentId,
      amount: Number(amount),
      note,
    })) as { balance: number };
    setPicked({ ...picked, balance: r.balance });
    setAmount('');
    setNote('');
  });
  const spend = useAsyncAction(async () => {
    if (!picked) return;
    const r = (await send('/canteen/spend', {
      studentId: picked.studentId,
      amount: Number(amount),
      note,
    })) as { balance: number };
    setPicked({ ...picked, balance: r.balance });
    setAmount('');
    setNote('');
  });

  return (
    <section className="card p-5 mt-6">
      <h2 className="font-display text-lg">At the counter</h2>
      <p className="text-[12px] text-oat mt-0.5">
        Find a pupil, then take a top-up or record a lunch.
      </p>

      <div className="mt-3 relative max-w-md">
        <input
          className={`${field} block w-full`}
          placeholder="Search a pupil by name or admission number…"
          value={picked ? `${picked.name}${picked.className ? ` · ${picked.className}` : ''}` : q}
          onChange={(e) => search(e.target.value)}
        />
        {!picked && matches.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-lg border border-mist bg-white shadow-md max-h-56 overflow-auto">
            {matches.map((m) => (
              <li key={m.studentId}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-parchment flex justify-between"
                  onClick={() => {
                    setPicked(m);
                    setMatches([]);
                  }}
                >
                  <span>
                    {m.name}
                    {m.className ? <span className="text-oat"> · {m.className}</span> : null}
                  </span>
                  <span className="tabular text-oat">{cedis(m.balance)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {picked && (
        <div className="mt-4 rounded-lg border border-mist/70 p-4">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium">{picked.name}</p>
            <p className="text-sm">
              Balance{' '}
              <span
                className={`font-display text-lg tabular ${picked.balance <= 0 ? 'text-clay' : ''}`}
              >
                {cedis(picked.balance)}
              </span>
            </p>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-[12px] text-oat">
              Amount
              <input
                type="number"
                min="0.01"
                step="0.01"
                className={`${field} mt-1 block w-28`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="text-[12px] text-oat">
              Note
              <input
                className={`${field} mt-1 block w-40`}
                placeholder="Optional"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <Button
              size="sm"
              state={topup.state}
              disabled={!(Number(amount) > 0)}
              onClick={() => topup.run()}
            >
              Top up
            </Button>
            <Button
              size="sm"
              variant="secondary"
              state={spend.state}
              disabled={!(Number(amount) > 0)}
              onClick={() => spend.run()}
            >
              Record spend
            </Button>
            <button
              type="button"
              className="text-[12px] text-oat hover:text-ink ml-1"
              onClick={() => {
                setPicked(null);
                setQ('');
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
