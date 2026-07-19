'use client';

import { useCallback, useEffect, useState } from 'react';
import FeeRollover, { type TermOption } from '@/components/FeeRollover';
import ReminderSettings from '@/components/ReminderSettings';
import ConcessionRules from '@/components/ConcessionRules';
import { Button, useAsyncAction } from '@/components/Button';
import { CashIcon, PlusIcon, SaveIcon } from '@/components/icons';

interface FeeItem {
  id: string;
  name: string;
  amount: number;
  levelId: string | null;
  optional: boolean;
}
interface Level {
  id: string;
  name: string;
}
interface ClassRoom {
  id: string;
  name: string;
  studentCount: number;
}
interface AcademicYear {
  id: string;
  name: string;
  terms: { id: string; name: string }[];
}

export default function FeeStructurePage() {
  const [termId, setTermId] = useState('');
  const [termName, setTermName] = useState('');
  const [levels, setLevels] = useState<Level[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [items, setItems] = useState<FeeItem[]>([]);
  const [billClassId, setBillClassId] = useState('');
  /** How many were billed and how many were skipped — detail the button itself cannot carry. */
  const [billSummary, setBillSummary] = useState<string | null>(null);
  const [billError, setBillError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [levelId, setLevelId] = useState('');
  const [optional, setOptional] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Defaults to GHS so the first paint never shows a currency this school does not use.
  const [currency, setCurrency] = useState('GHS');
  const [held, setHeld] = useState<string[]>([]);
  /** Which item is being re-priced, and the values being typed into it. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FeeItem | null>(null);

  // Both POST and PATCH on /fees/items are `fees.structure`. Anyone without it sees the list.
  const canStructure = held.includes('fees.structure');

  const money = (n: number) =>
    `${currency} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  useEffect(() => {
    Promise.all([
      fetch('/api/proxy/me').then((r) => r.json()),
      fetch('/api/proxy/school/structure').then((r) => r.json()),
    ]).then(([me, s]) => {
      if (me.currentTerm) {
        setTermId(me.currentTerm.id);
        setTermName(`${me.currentTerm.academicYear?.name ?? ''} · ${me.currentTerm.name}`);
      }
      if (me.school?.currency) setCurrency(me.school.currency);
      setHeld(me.permissions ?? []);
      setLevels(s.levels ?? []);
      setClasses(s.classes ?? []);
      // Years come back newest first; the rollover picker reads better oldest first, so a term
      // and the one after it sit next to each other in the list.
      setTerms(
        ((s.years ?? []) as AcademicYear[])
          .slice()
          .reverse()
          .flatMap((y) => y.terms.map((t) => ({ id: t.id, label: `${y.name} · ${t.name}` }))),
      );
    });
  }, []);

  const bill = useAsyncAction(async () => {
    setBillSummary(null);
    setBillError(null);
    const res = await fetch('/api/proxy/fees/invoices/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ termId, classId: billClassId || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // The button can only say it did not work; the server's reason is the useful part.
      setBillError(body.message ?? 'Could not generate the term bills.');
      throw new Error('billing rejected');
    }
    setBillSummary(
      `Billed ${body.created} student${body.created === 1 ? '' : 's'} ${money(body.total)} each.` +
        (body.skipped ? ` ${body.skipped} already had a bill for this term and were skipped.` : ''),
    );
  });

  const load = useCallback(async () => {
    if (!termId) return;
    const res = await fetch(`/api/proxy/fees/items?termId=${termId}`);
    if (res.ok) setItems(await res.json());
  }, [termId]);

  useEffect(() => {
    load();
  }, [load]);

  const add = useAsyncAction(async () => {
    setMessage(null);
    const res = await fetch('/api/proxy/fees/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        termId,
        name,
        amount: Number(amount),
        levelId: levelId || undefined,
        optional,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(body.message ?? 'Could not add the fee item.');
      throw new Error('add rejected');
    }
    setName('');
    setAmount('');
    setOptional(false);
    load();
  });

  async function remove(id: string) {
    const res = await fetch(`/api/proxy/fees/items/${id}`, { method: 'DELETE' });
    if (res.ok) load();
    else setMessage('Could not remove that item.');
  }

  /**
   * Re-price or rename an item in the structure.
   *
   * This changes what future bills are built from. Bills already issued carry their own
   * `lines` snapshot and are not touched — which is right, but is the opposite of what a bursar
   * correcting a price expects, so the table says so beside the button.
   */
  const saveEdit = useAsyncAction(async () => {
    if (!draft) return;
    setMessage(null);
    const res = await fetch(`/api/proxy/fees/items/${draft.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: draft.name.trim(),
        amount: Number(draft.amount),
        // Empty is how the form says "every level" — the API reads it back to null.
        levelId: draft.levelId ?? '',
        optional: draft.optional,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(
        Array.isArray(body.message)
          ? body.message.join('. ')
          : (body.message ?? 'Could not save that item.'),
      );
      throw new Error('save rejected');
    }
    setEditingId(null);
    setDraft(null);
    load();
  });

  const compulsory = items.filter((i) => !i.optional).reduce((a, i) => a + i.amount, 0);
  const field =
    'rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Fee structure</h1>
        <p className="text-sm text-oat mt-1.5">
          What each student is billed for {termName || 'the current term'}. Compulsory items make up
          the term bill; optional items (transport, feeding) are billed only to the students who
          take them, set on each student's page.
        </p>
      </div>

      {/* The table scrolls inside its own card on narrow screens rather than widening the page. */}
      <div className="card mt-6 overflow-hidden rise rise-2">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
                <th className="px-5 py-3 font-medium">Item</th>
                <th className="px-5 py-3 font-medium">Applies to</th>
                <th className="px-5 py-3 font-medium text-right">Amount</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((i) =>
                editingId === i.id && draft ? (
                  <tr key={i.id} className="border-b border-mist/60 last:border-0 bg-parchment/40">
                    <td colSpan={4} className="px-5 py-4">
                      <form onSubmit={saveEdit.run} className="flex flex-wrap items-end gap-3">
                        <label className="text-[13px]">
                          <span className="block text-oat mb-1">Item name</span>
                          <input
                            required
                            minLength={2}
                            value={draft.name}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                            className={`${field} w-48 min-h-11`}
                          />
                        </label>
                        <label className="text-[13px]">
                          <span className="block text-oat mb-1">Amount ({currency})</span>
                          <div className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                              <CashIcon />
                            </span>
                            <input
                              required
                              type="number"
                              min="0"
                              step="0.01"
                              value={draft.amount}
                              onChange={(e) =>
                                setDraft({ ...draft, amount: Number(e.target.value) })
                              }
                              className={`${field} w-32 tabular min-h-11 pl-10`}
                            />
                          </div>
                        </label>
                        <label className="text-[13px]">
                          <span className="block text-oat mb-1">Level</span>
                          <select
                            value={draft.levelId ?? ''}
                            onChange={(e) =>
                              setDraft({ ...draft, levelId: e.target.value || null })
                            }
                            className={`${field} w-40 min-h-11`}
                          >
                            <option value="">All levels</option>
                            {levels.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-[13px] flex items-center gap-2 min-h-11">
                          <input
                            type="checkbox"
                            checked={draft.optional}
                            onChange={(e) => setDraft({ ...draft, optional: e.target.checked })}
                          />
                          <span>Optional</span>
                        </label>
                        <Button type="submit" state={saveEdit.state} icon={<SaveIcon />}>
                          Save item
                        </Button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setDraft(null);
                          }}
                          className="min-h-11 px-2 text-[13px] text-oat hover:text-brand transition"
                        >
                          Cancel
                        </button>
                        <p className="w-full text-[11px] text-oat">
                          This changes what future bills are built from.{' '}
                          <strong className="text-ink">
                            Bills already issued are not re-priced
                          </strong>{' '}
                          — each bill keeps the lines it was raised with, so the ledger still says
                          what was actually billed. To correct a bill already sent, reverse it and
                          raise it again.
                        </p>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={i.id} className="border-b border-mist/60 last:border-0">
                    <td className="px-5 py-3 font-medium">
                      {i.name}
                      {i.optional && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider bg-parchment text-oat rounded-full px-2 py-0.5">
                          Optional
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-oat">
                      {i.levelId
                        ? (levels.find((l) => l.id === i.levelId)?.name ?? '—')
                        : 'All levels'}
                    </td>
                    <td className="px-5 py-3 text-right tabular font-medium">{money(i.amount)}</td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {canStructure && (
                        <>
                          <button
                            onClick={() => {
                              setEditingId(i.id);
                              setDraft({ ...i });
                              setMessage(null);
                            }}
                            data-tip="Re-prices future bills; bills already issued are unchanged"
                            className="tip text-[12.5px] font-medium text-brand hover:underline underline-offset-2"
                          >
                            Change
                          </button>
                          <button
                            onClick={() => remove(i.id)}
                            data-tip="Removes it from future bills; bills already issued are unchanged"
                            className="tip ml-3 text-[12.5px] text-clay hover:underline underline-offset-2"
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ),
              )}
              {items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-oat">
                    No fee items yet for this term — add one below, then generate the term bills.
                  </td>
                </tr>
              )}
            </tbody>
            {items.length > 0 && (
              <tfoot>
                <tr className="bg-parchment/60">
                  <td className="px-5 py-3 font-medium" colSpan={2}>
                    Compulsory total per student
                  </td>
                  <td className="px-5 py-3 text-right tabular font-display text-base">
                    {money(compulsory)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Directly under the table it fills: the empty state says "add one below", and copying
          last term forward is almost always the quicker way to do that. */}
      <div className="mt-6">
        <FeeRollover terms={terms} currentTermId={termId} onDone={load} />
      </div>

      <form onSubmit={add.run} className="card p-6 mt-6 rise rise-3 max-w-2xl">
        <h2 className="font-display text-xl">Add a fee item</h2>
        <div className="flex flex-wrap items-end gap-3 mt-4">
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Item name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="School Fees"
              className={`${field} w-48`}
            />
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Amount ({currency})</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                <CashIcon />
              </span>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`${field} w-32 tabular pl-10`}
              />
            </div>
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Level</span>
            <select
              value={levelId}
              onChange={(e) => setLevelId(e.target.value)}
              className={`${field} w-40`}
            >
              <option value="">All levels</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[13px] flex items-center gap-2 pb-2">
            <input
              type="checkbox"
              checked={optional}
              onChange={(e) => setOptional(e.target.checked)}
            />
            <span>Optional</span>
          </label>
          <Button type="submit" state={add.state} disabled={!termId} icon={<PlusIcon />}>
            Add item
          </Button>
        </div>
        {message && <p className="text-sm text-danger mt-3">{message}</p>}
      </form>

      <section className="card p-6 mt-6 rise rise-3 max-w-2xl">
        <h2 className="font-display text-xl">Generate term bills</h2>
        <p className="text-sm text-oat mt-1.5">
          Bills every active student the compulsory items above for {termName || 'the current term'}
          . Students who already have a bill for this term are skipped, so it is safe to run again
          after enrolling someone new.
        </p>
        <div className="flex flex-wrap items-end gap-3 mt-4">
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Who to bill</span>
            <select
              value={billClassId}
              onChange={(e) => setBillClassId(e.target.value)}
              className={`${field} w-56`}
            >
              <option value="">Every active student</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.studentCount})
                </option>
              ))}
            </select>
          </label>
          {/* "Bill" is not one of the conjugated verbs, so the wording is spelled out. */}
          <Button
            state={bill.state}
            onClick={bill.run}
            disabled={!termId || compulsory === 0}
            data-tip={compulsory === 0 ? 'Add at least one compulsory fee item first' : undefined}
            className="tip"
            icon={<CashIcon />}
            pendingLabel="Generating…"
            doneLabel="Bills raised"
            failedLabel="Couldn't bill"
          >
            {`Bill ${money(compulsory)} per student`}
          </Button>
        </div>
        {/* Kept beside the button: the counts, and how many were skipped, are what the bursar
            actually needs — the button can only say it worked. */}
        {billSummary && <p className="text-sm mt-3">{billSummary}</p>}
        {billError && <p className="text-sm text-danger mt-3">{billError}</p>}
      </section>

      {/* After billing, because a concession only means anything against a bill. */}
      <ConcessionRules levels={levels} />

      <div className="mt-6">
        <ReminderSettings />
      </div>
    </div>
  );
}
