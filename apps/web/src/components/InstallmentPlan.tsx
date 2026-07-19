'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, useAsyncAction } from './Button';
import { CashIcon, EditIcon, PlusIcon, SaveIcon, TrashIcon } from './icons';

interface Part {
  id: string;
  sequence: number;
  amount: number;
  paid: number;
  outstanding: number;
  dueDate: string;
  note: string | null;
  status: 'PAID' | 'DUE' | 'OVERDUE';
}
interface Plan {
  parts: Part[];
  scheduledTotal: number;
  paidTotal: number;
  overdue: number;
}
interface Draft {
  amount: string;
  dueDate: string;
  note: string;
}

const money = (n: number) =>
  `GHS ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });

const field =
  'rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

/**
 * A student's agreed payment plan.
 *
 * An instalment is a promise about *when*, not a second record of the money — the ledger stays
 * the only source of what is owed, and each part is marked against payments already made. Saving
 * replaces the whole plan, so the editor starts from what is on file rather than appending.
 */
export default function InstallmentPlan({
  studentId,
  balance,
  canEdit,
}: {
  studentId: string;
  balance: number;
  canEdit: boolean;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/proxy/fees/installments/${studentId}`);
    // A 403 here means the package does not include instalments — the section simply is not
    // part of this school's portal, so it stays hidden rather than showing a locked door.
    if (res.ok) setPlan(await res.json());
    setLoaded(true);
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  function startEditing() {
    setError(null);
    setRows(
      plan && plan.parts.length > 0
        ? plan.parts.map((p) => ({
            amount: String(p.amount),
            dueDate: p.dueDate.slice(0, 10),
            note: p.note ?? '',
          }))
        : // A fresh plan opens as three parts because that is how a term is usually split.
          [1, 2, 3].map(() => ({ amount: '', dueDate: '', note: '' })),
    );
    setEditing(true);
  }

  const save = useAsyncAction(async () => {
    setError(null);
    const res = await fetch('/api/proxy/fees/installments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId,
        parts: rows
          .filter((r) => r.amount && r.dueDate)
          .map((r) => ({
            amount: Number(r.amount),
            dueDate: new Date(r.dueDate).toISOString(),
            note: r.note.trim() || undefined,
          })),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setPlan(body);
      setEditing(false);
      return;
    }
    // The API refuses a plan that does not add up to the bill it splits. That message names the
    // two figures, so it is far more useful than anything generic we could put here.
    setError(
      Array.isArray(body.message) ? body.message.join('. ') : (body.message ?? 'Could not save.'),
    );
    throw new Error('plan rejected');
  });

  if (!loaded || !plan) return null;

  const draftTotal = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const has = plan.parts.length > 0;

  return (
    <section className="card p-6 rise rise-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl">Payment plan</h2>
        {canEdit && !editing && (
          <Button
            onClick={startEditing}
            variant="ghost"
            size="sm"
            icon={has ? <EditIcon /> : <PlusIcon />}
            className="no-print"
          >
            {has ? 'Replace plan' : 'Set up a plan'}
          </Button>
        )}
      </div>
      <p className="text-sm text-oat mt-1.5">
        When this family has agreed to pay, not a second record of the money. Each part is marked
        against payments already on the ledger, oldest first.
      </p>

      {editing ? (
        <div className="mt-4">
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <label className="text-[13px]">
                  {i === 0 && <span className="block text-oat mb-1">Amount (GHS)</span>}
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                      <CashIcon />
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={r.amount}
                      onChange={(e) =>
                        setRows(
                          rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)),
                        )
                      }
                      // A shade wider than before so the figure still fits beside the icon.
                      className={`${field} w-36 tabular pl-10`}
                    />
                  </div>
                </label>
                {/* No calendar icon on the date box: the native date control draws its own
                    picker indicator, and two calendars in one field read as a mistake. */}
                <label className="text-[13px]">
                  {i === 0 && <span className="block text-oat mb-1">Due</span>}
                  <input
                    type="date"
                    value={r.dueDate}
                    onChange={(e) =>
                      setRows(rows.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))
                    }
                    className={`${field} w-40 tabular`}
                  />
                </label>
                <label className="text-[13px] flex-1 min-w-[8rem]">
                  {i === 0 && <span className="block text-oat mb-1">Note</span>}
                  <input
                    value={r.note}
                    onChange={(e) =>
                      setRows(rows.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))
                    }
                    placeholder="Optional"
                    className={`${field} w-full`}
                  />
                </label>
                {/* Ghost rather than danger: this drops a row from a draft, nothing on file. */}
                <Button
                  type="button"
                  variant="ghost"
                  icon={<TrashIcon />}
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  disabled={rows.length === 1}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={<PlusIcon />}
            onClick={() => setRows([...rows, { amount: '', dueDate: '', note: '' }])}
            className="mt-3"
          >
            Add an instalment
          </Button>

          <p className="text-[13px] mt-3 pt-3 border-t border-mist/60">
            Plan totals <span className="tabular font-medium">{money(draftTotal)}</span> · the
            balance owed is <span className="tabular font-medium">{money(balance)}</span>.
          </p>

          <div className="flex items-center gap-3 mt-3">
            <Button
              type="button"
              onClick={save.run}
              state={save.state}
              icon={<SaveIcon />}
              // The label swaps between "Replace"/"Save", so both spellings are given here.
              pendingLabel="Saving…"
              doneLabel="Saved!"
              failedLabel="Couldn't save"
            >
              {has ? 'Replace plan' : 'Save plan'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
          {error && <p className="text-sm text-danger mt-2">{error}</p>}
          {has && (
            <p className="text-xs text-oat mt-2">
              Saving replaces the {plan.parts.length} instalment
              {plan.parts.length === 1 ? '' : 's'} already on file.
            </p>
          )}
        </div>
      ) : has ? (
        <>
          <ul className="mt-4 space-y-2">
            {plan.parts.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 border-b border-mist/50 last:border-0 pb-2 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {money(p.amount)}
                    <span className="ml-2 text-[13px] font-normal text-oat">
                      due {fmtDate(p.dueDate)}
                    </span>
                  </p>
                  {p.note && <p className="text-[11px] text-oat truncate">{p.note}</p>}
                </div>
                <span
                  className={`shrink-0 text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 ${
                    p.status === 'PAID'
                      ? 'bg-brand-mist text-brand'
                      : p.status === 'OVERDUE'
                        ? 'bg-danger/10 text-danger'
                        : 'bg-parchment text-oat'
                  }`}
                >
                  {p.status}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[13px] mt-3 pt-3 border-t border-mist/60">
            <span className="tabular font-medium">{money(plan.paidTotal)}</span> of{' '}
            <span className="tabular font-medium">{money(plan.scheduledTotal)}</span> covered
            {plan.overdue > 0 && (
              <span className="text-danger">
                {' · '}
                {plan.overdue} instalment{plan.overdue === 1 ? '' : 's'} overdue
              </span>
            )}
          </p>
        </>
      ) : (
        <p className="text-sm text-oat mt-3">
          No plan agreed — this family is billed for the term in full.
        </p>
      )}
    </section>
  );
}
