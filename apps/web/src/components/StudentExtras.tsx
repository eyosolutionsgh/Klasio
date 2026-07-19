'use client';

import { useCallback, useEffect, useState } from 'react';

interface Extra {
  id: string;
  name: string;
  amount: number;
  subscribed: boolean;
}

/**
 * Optional fee items (transport, feeding) for one student. Compulsory items are billed to
 * everyone and are not listed here.
 */
export default function StudentExtras({ studentId }: { studentId: string }) {
  const [termId, setTermId] = useState('');
  const [termName, setTermName] = useState('');
  const [items, setItems] = useState<Extra[]>([]);
  const [invoiced, setInvoiced] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Defaults to GHS so the first paint never shows a currency this school does not use.
  const [currency, setCurrency] = useState('GHS');

  useEffect(() => {
    fetch('/api/proxy/me')
      .then((r) => r.json())
      .then((me) => {
        if (me.school?.currency) setCurrency(me.school.currency);
        if (me.currentTerm) {
          setTermId(me.currentTerm.id);
          setTermName(`${me.currentTerm.academicYear?.name ?? ''} · ${me.currentTerm.name}`);
        } else setLoaded(true);
      });
  }, []);

  const load = useCallback(async () => {
    if (!termId) return;
    const res = await fetch(`/api/proxy/fees/students/${studentId}/items?termId=${termId}`);
    if (res.ok) {
      const d = await res.json();
      setItems(d.items);
      setInvoiced(d.alreadyInvoiced);
    }
    setLoaded(true);
  }, [studentId, termId]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(item: Extra) {
    setBusy(item.id);
    setError(null);
    const res = await fetch(`/api/proxy/fees/students/${studentId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feeItemId: item.id, subscribed: !item.subscribed }),
    });
    setBusy(null);
    if (res.ok) load();
    else {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? 'Could not save that.');
    }
  }

  if (!loaded) return null;
  if (items.length === 0) return null;

  const money = (n: number) =>
    `${currency} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const takenTotal = items.filter((i) => i.subscribed).reduce((a, i) => a + i.amount, 0);

  return (
    <section className="card p-6 rise rise-3">
      <h2 className="font-display text-xl">Optional extras</h2>
      <p className="text-sm text-oat mt-1.5">
        Transport, feeding and the like for {termName || 'this term'} — billed only to the students
        who take them.
      </p>

      <ul className="mt-4 space-y-2">
        {items.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-3 text-sm min-h-11 cursor-pointer">
              <input
                type="checkbox"
                checked={i.subscribed}
                disabled={busy === i.id}
                onChange={() => toggle(i)}
                className="w-4 h-4"
              />
              <span>{i.name}</span>
            </label>
            <span className="tabular text-sm text-oat shrink-0">{money(i.amount)}</span>
          </li>
        ))}
      </ul>

      {takenTotal > 0 && (
        <p className="text-[13px] mt-3 pt-3 border-t border-mist/60">
          Adds <span className="tabular font-medium">{money(takenTotal)}</span> to this
          student&apos;s term bill.
        </p>
      )}
      {invoiced && (
        <p className="text-xs text-oat mt-2">
          This term&apos;s bill has already been issued — it keeps the items it was raised with.
          Changes here apply to the next bill.
        </p>
      )}
      {error && <p className="text-sm text-danger mt-2">{error}</p>}
    </section>
  );
}
