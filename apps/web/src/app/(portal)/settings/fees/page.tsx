'use client';

import { useCallback, useEffect, useState } from 'react';
import FeeRollover, { type TermOption } from '@/components/FeeRollover';
import ReminderSettings from '@/components/ReminderSettings';

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

const money = (n: number) =>
  `GHS ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FeeStructurePage() {
  const [termId, setTermId] = useState('');
  const [termName, setTermName] = useState('');
  const [levels, setLevels] = useState<Level[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [items, setItems] = useState<FeeItem[]>([]);
  const [billClassId, setBillClassId] = useState('');
  const [billing, setBilling] = useState(false);
  const [billResult, setBillResult] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [levelId, setLevelId] = useState('');
  const [optional, setOptional] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/proxy/me').then((r) => r.json()),
      fetch('/api/proxy/school/structure').then((r) => r.json()),
    ]).then(([me, s]) => {
      if (me.currentTerm) {
        setTermId(me.currentTerm.id);
        setTermName(`${me.currentTerm.academicYear?.name ?? ''} · ${me.currentTerm.name}`);
      }
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

  async function generateInvoices() {
    setBilling(true);
    setBillResult(null);
    const res = await fetch('/api/proxy/fees/invoices/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ termId, classId: billClassId || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    setBilling(false);
    setBillResult(
      res.ok
        ? `Billed ${body.created} student${body.created === 1 ? '' : 's'} ${money(body.total)} each.` +
            (body.skipped
              ? ` ${body.skipped} already had a bill for this term and were skipped.`
              : '')
        : (body.message ?? 'Could not generate invoices.'),
    );
  }

  const load = useCallback(async () => {
    if (!termId) return;
    const res = await fetch(`/api/proxy/fees/items?termId=${termId}`);
    if (res.ok) setItems(await res.json());
  }, [termId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
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
    setBusy(false);
    if (res.ok) {
      setName('');
      setAmount('');
      setOptional(false);
      load();
    } else {
      setMessage(body.message ?? 'Could not add the fee item.');
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/proxy/fees/items/${id}`, { method: 'DELETE' });
    if (res.ok) load();
    else setMessage('Could not remove that item.');
  }

  const compulsory = items.filter((i) => !i.optional).reduce((a, i) => a + i.amount, 0);
  const field =
    'rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Fee structure</h1>
        <p className="text-sm text-oat mt-1.5">
          What each student is billed for {termName || 'the current term'}. Compulsory items make up
          the term invoice; optional items (transport, feeding) are billed only to the students who
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
              {items.map((i) => (
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
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => remove(i.id)}
                      data-tip="Removes it from future invoices; bills already issued are unchanged"
                      className="tip text-[12.5px] text-clay hover:underline underline-offset-2"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-oat">
                    No fee items yet for this term — add one below, then generate invoices.
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

      <form onSubmit={add} className="card p-6 mt-6 rise rise-3 max-w-2xl">
        <h2 className="font-display text-xl">Add a fee item</h2>
        <div className="flex flex-wrap items-end gap-3 mt-4">
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Item name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tuition"
              className={`${field} w-48`}
            />
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Amount (GHS)</span>
            <input
              required
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`${field} w-32 tabular`}
            />
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
          <button
            type="submit"
            disabled={busy || !termId}
            className="rounded-lg bg-brand text-paper text-sm font-medium px-5 py-2 hover:bg-brand-deep transition disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Add item'}
          </button>
        </div>
        {message && <p className="text-sm text-danger mt-3">{message}</p>}
      </form>

      <section className="card p-6 mt-6 rise rise-3 max-w-2xl">
        <h2 className="font-display text-xl">Generate term invoices</h2>
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
          <button
            onClick={generateInvoices}
            disabled={billing || !termId || compulsory === 0}
            data-tip={compulsory === 0 ? 'Add at least one compulsory fee item first' : undefined}
            className="tip rounded-lg bg-brand text-paper text-sm font-medium px-5 py-2 hover:bg-brand-deep transition disabled:opacity-50"
          >
            {billing ? 'Generating…' : `Bill ${money(compulsory)} per student`}
          </button>
        </div>
        {billResult && <p className="text-sm mt-3">{billResult}</p>}
      </section>

      <div className="mt-6">
        <ReminderSettings />
      </div>
    </div>
  );
}
