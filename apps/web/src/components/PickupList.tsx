'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, useAsyncAction } from '@/components/Button';
import { PhoneIcon, PlusIcon, PrintIcon, UserIcon } from '@/components/icons';

interface Person {
  kind: 'GUARDIAN' | 'DELEGATE';
  id: string;
  name: string;
  relationship: string;
  hasCard: boolean;
  hasPhoto?: boolean;
  message: string;
  expiresAt?: string | null;
  verdict: { allowed: boolean; requiresOverride?: boolean };
}

const field =
  'rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

/**
 * Who may collect this child. Guardians come from the student's own record; delegates (a driver,
 * an aunt) are added here, usually with an end date because that is how the arrangement works.
 */
export default function PickupList({ studentId }: { studentId: string }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{
    name: string;
    pin: string;
    kind: string;
    id: string;
  } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/proxy/pickup/authorised/${studentId}`);
    if (res.ok) {
      const d = await res.json();
      setPeople([...d.guardians, ...d.delegates]);
    }
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  const addDelegate = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    const f = new FormData(e.currentTarget);
    // `busy` still gates the per-row controls below, which are not this button's concern.
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/proxy/pickup/students/${studentId}/delegates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: String(f.get('name') ?? '').trim(),
        phone: String(f.get('phone') ?? '').trim(),
        relationship: String(f.get('relationship') ?? '').trim(),
        expiresAt: f.get('expiresAt') ? `${f.get('expiresAt')}T23:59:59.000Z` : undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      // Kept: the server names what was wrong with the person (duplicate phone, bad date).
      setError(d.message ?? 'Could not add that person.');
      throw new Error('add rejected');
    }
    setAdding(false);
    load();
  });

  async function issueCard(p: Person) {
    setBusy(true);
    const res = await fetch(`/api/proxy/pickup/cards/${p.kind}/${p.id}`, { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      // Shown once — the PIN is stored hashed and cannot be read back.
      setIssued({ name: p.name, pin: d.pin, kind: p.kind, id: p.id });
      load();
    } else setError(d.message ?? 'Could not issue a gate pass.');
  }

  const printCard = useAsyncAction(async () => {
    if (!issued) return;
    const res = await fetch(`/api/proxy/pickup/cards/${issued.kind}/${issued.id}/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: issued.pin }),
    });
    // Thrown rather than returned quietly: the PIN is shown once, so a pass that failed to
    // render must not look like it printed.
    if (!res.ok) throw new Error('pdf rejected');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });

  /**
   * Cancel a printed gate pass.
   *
   * A pass carries a PIN that opens the gate, so a lost or stolen one has to be stoppable without
   * removing the person — a guardian whose pass went missing must stay on the list. Until now the
   * only lever was removing them entirely, which is the wrong answer for exactly the people most
   * likely to have one.
   */
  async function revokeCard(p: Person) {
    if (
      !confirm(
        `Cancel ${p.name}'s gate pass? Their PIN and QR code stop working straight away. They stay on the list and can be issued a new one.`,
      )
    )
      return;
    setBusy(true);
    const res = await fetch(`/api/proxy/pickup/cards/${p.kind}/${p.id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) load();
    else setError('Could not cancel that gate pass.');
  }

  /**
   * Attach a face photo to a guardian.
   *
   * The release screen has always *shown* this photo to whoever is handing a child over, and
   * nothing in the product could ever put one there — so gate staff saw a broken image at exactly
   * the moment they were meant to be checking a face. This is the missing half.
   */
  async function uploadPhoto(p: Person, file: File) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/proxy/pickup/guardians/${p.id}/photo`, {
      method: 'POST',
      body: form,
    });
    setBusy(false);
    if (res.ok) load();
    else {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? 'Could not save that photo.');
    }
  }

  async function removeDelegate(id: string) {
    if (!confirm('Remove this person from the pickup list?')) return;
    const res = await fetch(`/api/proxy/pickup/delegates/${id}`, { method: 'DELETE' });
    if (res.ok) load();
  }

  return (
    <section className="card p-6 rise rise-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl">Who may collect</h2>
        <button
          onClick={() => setAdding((a) => !a)}
          className="no-print text-[12.5px] font-medium text-brand hover:underline underline-offset-2"
        >
          {adding ? 'Cancel' : '+ Add someone'}
        </button>
      </div>

      {adding && (
        <form onSubmit={addDelegate.run} className="mt-4 rounded-lg bg-parchment/60 p-4 space-y-3">
          <p className="text-xs text-oat">
            A driver, relative or neighbour. Give an end date if the arrangement is temporary.
          </p>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                <UserIcon />
              </span>
              <input
                name="name"
                required
                minLength={2}
                placeholder="Full name"
                className={`${field} w-40 pl-10`}
              />
            </div>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                <PhoneIcon />
              </span>
              <input
                name="phone"
                required
                placeholder="024 123 4567"
                className={`${field} w-36 tabular pl-10`}
              />
            </div>
            {/* No icon for the relationship — "Driver" is not a person, a phone or a date. */}
            <input name="relationship" required placeholder="Driver" className={`${field} w-32`} />
            <label className="text-[12px] text-oat flex items-center gap-2">
              until
              {/* A date input draws its own picker glyph; a second calendar would just crowd it. */}
              <input name="expiresAt" type="date" className={field} />
            </label>
          </div>
          <Button type="submit" state={addDelegate.state} icon={<PlusIcon />}>
            Add to pickup list
          </Button>
        </form>
      )}

      {issued && (
        <div className="mt-4 rounded-lg border border-gold/40 bg-gold-soft/40 p-4">
          <p className="text-sm font-medium">Gate pass issued for {issued.name}</p>
          <p className="text-[13px] text-oat mt-1">
            PIN <span className="font-display text-lg tabular text-ink">{issued.pin}</span> — shown
            once. Print the pass now or write it down.
          </p>
          <div className="flex items-center gap-3 mt-2">
            <Button
              onClick={printCard.run}
              state={printCard.state}
              icon={<PrintIcon />}
              pendingLabel="Preparing…"
              doneLabel="Opened"
              failedLabel="Couldn't print"
            >
              Print gate pass
            </Button>
            <button onClick={() => setIssued(null)} className="min-h-11 px-2 text-[13px] text-oat">
              Done
            </button>
          </div>
        </div>
      )}

      <ul className="mt-4 space-y-3">
        {people.map((p) => (
          <li key={`${p.kind}-${p.id}`} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {p.name}
                <span className="ml-2 text-[10px] uppercase tracking-wider text-oat">
                  {p.kind === 'GUARDIAN' ? 'guardian' : p.relationship}
                </span>
              </p>
              <p
                className={`text-[12px] mt-0.5 ${
                  !p.verdict.allowed
                    ? 'text-danger font-medium'
                    : p.verdict.requiresOverride
                      ? 'text-clay'
                      : 'text-oat'
                }`}
              >
                {p.message}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {p.verdict.allowed && (
                <button
                  onClick={() => issueCard(p)}
                  disabled={busy}
                  className="text-[12px] text-brand hover:underline underline-offset-2"
                >
                  {p.hasCard ? 'Reissue pass' : 'Issue pass'}
                </button>
              )}
              {p.kind === 'GUARDIAN' && (
                <label className="text-[12px] text-brand hover:underline underline-offset-2 cursor-pointer">
                  {p.hasPhoto ? 'Replace photo' : 'Add photo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    className="sr-only"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadPhoto(p, f);
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
              {p.hasCard && (
                <button
                  onClick={() => revokeCard(p)}
                  disabled={busy}
                  className="text-[12px] text-clay hover:underline underline-offset-2"
                >
                  Cancel pass
                </button>
              )}
              {p.kind === 'DELEGATE' && (
                <button
                  onClick={() => removeDelegate(p.id)}
                  className="text-[12px] text-clay hover:underline underline-offset-2"
                >
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
        {people.length === 0 && (
          <li className="text-sm text-oat">Nobody is authorised to collect this child yet.</li>
        )}
      </ul>
      {error && <p className="text-sm text-danger mt-3">{error}</p>}
    </section>
  );
}
