'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface GuardianLink {
  id: string;
  name: string;
  phone: string;
  relationship: string;
  isPrimary: boolean;
  canPickup: boolean;
  custodyFlag: string;
  whatsappOptIn: boolean;
  /** Other students who share this guardian record. */
  alsoGuardianTo: number;
}

const children = (n: number) => `${n} other ${n === 1 ? 'student' : 'students'}`;

const CUSTODY = [
  { value: 'NONE', label: 'No restriction' },
  { value: 'RESTRICTED', label: 'Restricted — check with the head' },
  { value: 'BLOCKED', label: 'Blocked — must not collect or see records' },
];

const field =
  'rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/15';

export default function StudentGuardians({
  studentId,
  guardians,
}: {
  studentId: string;
  guardians: GuardianLink[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/proxy/students/${studentId}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? 'That did not save.');
      return false;
    }
    setEditing(null);
    setAdding(false);
    router.refresh();
    return true;
  }

  function formValues(form: HTMLFormElement) {
    const f = new FormData(form);
    const custodyFlag = String(f.get('custodyFlag') ?? 'NONE');
    return {
      firstName: String(f.get('firstName') ?? '').trim(),
      lastName: String(f.get('lastName') ?? '').trim(),
      phone: String(f.get('phone') ?? '').trim(),
      relationship: String(f.get('relationship') ?? '').trim() || 'Guardian',
      custodyFlag,
      // Mirrors the server rule: a blocked guardian is never authorised for pickup.
      canPickup: custodyFlag === 'BLOCKED' ? false : f.get('canPickup') === 'on',
      isPrimary: f.get('isPrimary') === 'on',
      whatsappOptIn: f.get('whatsappOptIn') === 'on',
    };
  }

  /**
   * Name and phone live on the shared Guardian record, so editing them reaches every child that
   * guardian belongs to. The per-student settings below (relationship, custody, pickup, primary)
   * are on the link and only affect this child — so only a real contact change asks.
   */
  function confirmSharedEdit(g: GuardianLink, next: ReturnType<typeof formValues>) {
    if (g.alsoGuardianTo === 0) return true;
    const contactChanged =
      `${next.firstName} ${next.lastName}`.trim() !== g.name.trim() || next.phone !== g.phone;
    if (!contactChanged) return true;
    return confirm(
      `${g.name} is also guardian to ${children(g.alsoGuardianTo)} at this school.\n\n` +
        `Changing the name or phone number updates their record everywhere — ` +
        `including who the school calls about those children, and the phone they sign in ` +
        `to the parent portal with.\n\nApply this change to all of them?`,
    );
  }

  return (
    <section className="card p-6 rise rise-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl">Guardians</h2>
        <button
          onClick={() => {
            setAdding((a) => !a);
            setEditing(null);
          }}
          className="no-print text-[12.5px] font-medium text-forest hover:underline underline-offset-2"
        >
          {adding ? 'Cancel' : '+ Add guardian'}
        </button>
      </div>

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send('/guardians', 'POST', formValues(e.currentTarget));
          }}
          className="mt-4 rounded-lg bg-parchment/60 p-4 space-y-3"
        >
          <p className="text-xs text-oat">
            If this phone number already belongs to a guardian here, they are linked to this child
            too — siblings share one contact and one portal sign-in.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              name="firstName"
              required
              minLength={2}
              placeholder="First name"
              className={`${field} w-36`}
            />
            <input
              name="lastName"
              required
              minLength={2}
              placeholder="Last name"
              className={`${field} w-36`}
            />
            <input
              name="phone"
              required
              placeholder="024 123 4567"
              className={`${field} w-40 tabular`}
            />
            <input name="relationship" placeholder="Mother" className={`${field} w-32`} />
          </div>
          <select name="custodyFlag" defaultValue="NONE" className={`${field} w-full`}>
            {CUSTODY.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-4 text-[13px]">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="canPickup" defaultChecked /> Can pick up
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="isPrimary" /> Primary contact
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="whatsappOptIn" /> WhatsApp
            </label>
          </div>
          <button
            disabled={busy}
            className="rounded-lg bg-forest text-paper text-sm font-medium px-4 py-2 hover:bg-forest-deep transition disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Add guardian'}
          </button>
        </form>
      )}

      <ul className="mt-4 space-y-4">
        {guardians.map((g) =>
          editing === g.id ? (
            <li key={g.id}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const next = formValues(e.currentTarget);
                  if (!confirmSharedEdit(g, next)) return;
                  send(`/guardians/${g.id}`, 'PATCH', next);
                }}
                className="rounded-lg bg-parchment/60 p-4 space-y-3"
              >
                {g.alsoGuardianTo > 0 && (
                  <p className="text-xs text-clay bg-clay/10 rounded-md px-3 py-2">
                    Shared contact — also guardian to {children(g.alsoGuardianTo)}. The name and
                    phone below are theirs everywhere; custody, pickup and primary apply to this
                    child only.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <input
                    name="firstName"
                    required
                    minLength={2}
                    defaultValue={g.name.split(' ')[0]}
                    className={`${field} w-36`}
                  />
                  <input
                    name="lastName"
                    required
                    minLength={2}
                    defaultValue={g.name.split(' ').slice(1).join(' ')}
                    className={`${field} w-36`}
                  />
                  <input
                    name="phone"
                    required
                    defaultValue={g.phone}
                    className={`${field} w-40 tabular`}
                  />
                  <input
                    name="relationship"
                    defaultValue={g.relationship}
                    className={`${field} w-32`}
                  />
                </div>
                <select
                  name="custodyFlag"
                  defaultValue={g.custodyFlag}
                  className={`${field} w-full`}
                >
                  {CUSTODY.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap gap-4 text-[13px]">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="canPickup" defaultChecked={g.canPickup} /> Can pick
                    up
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="isPrimary" defaultChecked={g.isPrimary} /> Primary
                    contact
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="whatsappOptIn" defaultChecked={g.whatsappOptIn} />{' '}
                    WhatsApp
                  </label>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    disabled={busy}
                    className="rounded-lg bg-forest text-paper text-sm font-medium px-4 py-2 hover:bg-forest-deep transition disabled:opacity-60"
                  >
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="text-[13px] text-oat"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Remove ${g.name} from this student's guardians?`)) {
                        send(`/guardians/${g.id}`, 'DELETE');
                      }
                    }}
                    className="ml-auto text-[13px] text-clay hover:underline underline-offset-2"
                  >
                    Remove
                  </button>
                </div>
              </form>
            </li>
          ) : (
            <li key={g.id} className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  {g.name}
                  {g.isPrimary && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider bg-gold-soft text-ink rounded-full px-2 py-0.5">
                      Primary
                    </span>
                  )}
                </p>
                <p className="text-xs text-oat mt-0.5">
                  {g.relationship} · <span className="tabular">{g.phone}</span>
                  {g.whatsappOptIn && ' · WhatsApp ✓'}
                </p>
                <button
                  onClick={() => {
                    setEditing(g.id);
                    setAdding(false);
                  }}
                  className="no-print text-[12px] text-forest hover:underline underline-offset-2 mt-1"
                >
                  Edit
                </button>
              </div>
              <span
                data-tip={
                  g.custodyFlag === 'BLOCKED'
                    ? 'Blocked — must not collect this child or see their records'
                    : g.custodyFlag === 'RESTRICTED'
                      ? 'Restricted — check with the head before release'
                      : g.canPickup
                        ? 'Authorized to pick this child up'
                        : 'NOT authorized for pickup'
                }
                className={`tip text-[10px] uppercase tracking-wider rounded-full px-2 py-1 shrink-0 ${
                  g.custodyFlag !== 'NONE'
                    ? 'bg-danger/10 text-danger'
                    : g.canPickup
                      ? 'bg-forest-mist text-forest'
                      : 'bg-parchment text-oat'
                }`}
              >
                {g.custodyFlag !== 'NONE'
                  ? g.custodyFlag.toLowerCase()
                  : g.canPickup
                    ? 'Pickup ✓'
                    : 'No pickup'}
              </span>
            </li>
          ),
        )}
        {guardians.length === 0 && (
          <li className="text-sm text-oat">
            No guardian on record — the school has no one to call about this child.
          </li>
        )}
      </ul>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </section>
  );
}
