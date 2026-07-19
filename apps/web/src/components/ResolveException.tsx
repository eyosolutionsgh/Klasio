'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Button, useAsyncAction } from './Button';
import { SaveIcon } from './icons';

const field =
  'w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

/** The note the API insists on. Kept here so the button and the hint cannot drift apart. */
const MIN_NOTE = 4;

const CHOICES = [
  {
    v: 'MATCHED' as const,
    l: 'It is ours',
    hint: 'The money belongs to a payment we hold',
  },
  {
    v: 'DISPUTED' as const,
    l: 'Query the gateway',
    hint: 'The amount is wrong — raise it with them',
  },
  {
    v: 'IGNORED' as const,
    l: 'Set aside',
    hint: 'Not our money, or a duplicate line',
  },
];

/**
 * Close one settlement exception.
 *
 * The reason is mandatory server-side, so it is mandatory here too and visibly so: the button
 * stays disabled and says what is missing, rather than letting a bursar type nothing, press save
 * and be handed a 400 they cannot act on.
 */
export default function ResolveException({
  id,
  reference,
  student,
  note,
  currentStatus,
}: {
  id: string;
  reference: string;
  student: string | null;
  note: string | null;
  currentStatus: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<'MATCHED' | 'DISPUTED' | 'IGNORED'>('MATCHED');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const short = reason.trim().length < MIN_NOTE;

  const submit = useAsyncAction(async () => {
    if (short) return;
    setError(null);
    const res = await fetch(`/api/proxy/reconciliation/rows/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, note: reason.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        Array.isArray(body.message) ? body.message.join('. ') : (body.message ?? 'Could not save.'),
      );
      throw new Error('rejected');
    }
    setOpen(false);
    setReason('');
    router.refresh();
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-[12.5px] font-medium text-brand border border-brand/40 rounded-full px-3 py-1 hover:bg-brand-mist transition whitespace-nowrap"
      >
        {currentStatus === 'MATCHED' || currentStatus === 'IGNORED' ? 'Reopen' : 'Resolve'}
      </button>
    );
  }
  // The dialog is fixed, and the card it is launched from sits inside a transformed `.rise`
  // ancestor — which would capture it. Portalling to the body is the only way out.
  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Resolve settlement exception"
      className="brand-scope fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
      onClick={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <form onSubmit={submit.run} className="card w-full max-w-md p-6">
        <h2 className="font-display text-2xl">Resolve exception</h2>
        <p className="text-sm text-oat mt-1.5">
          Reference <span className="tabular text-ink">{reference}</span>
          {student ? ` · ${student}` : ' · no payment on file'}
        </p>
        {note && <p className="text-[12.5px] text-oat mt-2">Matched against: {note}</p>}

        <p className="text-[11px] uppercase tracking-wider text-oat mt-5 mb-2">
          What did you find?
        </p>
        <div className="space-y-2">
          {CHOICES.map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setStatus(o.v)}
              aria-pressed={status === o.v}
              className={`w-full text-left rounded-lg border px-3.5 py-2.5 transition ${
                status === o.v
                  ? 'bg-brand text-paper border-brand'
                  : 'border-mist hover:border-brand'
              }`}
            >
              <span className="block text-sm font-medium">{o.l}</span>
              <span
                className={`block text-[11px] ${status === o.v ? 'text-paper/70' : 'text-oat'}`}
              >
                {o.hint}
              </span>
            </button>
          ))}
        </div>

        <label className="block text-[13px] mt-4">
          <span className="block text-oat mb-1">
            Why <span className="text-danger">— required</span>
          </span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={MIN_NOTE}
            autoFocus
            placeholder="Hubtel confirmed it was a test charge, refunded 4 Mar"
            className={field}
          />
          <span className={`block text-[11px] mt-1 ${short ? 'text-clay' : 'text-oat'}`}>
            {short
              ? `At least ${MIN_NOTE} characters. This is what the next person reads.`
              : 'Kept on the row and in the audit log against your name.'}
          </span>
        </label>

        {error && <p className="text-sm text-danger mt-3">{error}</p>}

        <div className="flex items-center gap-3 mt-5">
          {/* The label still names what is missing while the note is too short; the button is
              disabled then, so the "Adding…" conjugation of that wording is never reached. */}
          <Button type="submit" state={submit.state} icon={<SaveIcon />} disabled={short}>
            {short ? 'Add a reason to save' : 'Save resolution'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
