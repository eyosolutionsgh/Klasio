'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { revoke } from '@/lib/actions';

/**
 * Withdrawing a licence, with the one thing a vendor most needs to know about it said plainly.
 *
 * Withdrawing does not reach the school. Their server verifies the signed file locally and has no
 * obligation to talk to anyone, which is the whole basis of selling to schools with unreliable
 * internet. So this changes the vendor's record and nothing at the school — and a supplier who
 * clicks it believing otherwise finds out from the customer, weeks later.
 *
 * Behind a dialog with a required reason rather than a bare button. The reason is the deliberate
 * step: it is what makes the record worth having a year later, and it is enough friction that
 * nobody withdraws the wrong row on the way past.
 */
export default function RevokeLicence({
  licenceId,
  licenceRef,
  current,
}: {
  licenceId: string;
  /** The human-facing id, so the dialog names what is about to be withdrawn. */
  licenceRef: string;
  /** Whether this is the licence in force — which changes what withdrawing it means. */
  current: boolean;
}) {
  const [error, action, pending] = useActionState(revoke, null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const submitted = useRef(false);
  useEffect(() => {
    if (pending) submitted.current = true;
    else if (submitted.current && !error) {
      submitted.current = false;
      setOpen(false);
    }
  }, [pending, error]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-danger underline underline-offset-2"
      >
        Withdraw
      </button>

      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        aria-labelledby={`revoke-${licenceId}`}
        className="modal backdrop:bg-ink/40 rounded-xl p-0 w-[min(32rem,92vw)] border border-mist shadow-2xl"
      >
        <form action={action} className="p-6">
          <input type="hidden" name="licenceId" value={licenceId} />

          <h2 id={`revoke-${licenceId}`} className="text-base font-semibold">
            Withdraw {licenceRef}?
          </h2>

          {/*
            The correction this dialog exists to make. Stated before the reason field, because it
            changes whether someone wants to do this at all.
          */}
          <p className="text-sm text-slate mt-2">
            This records the licence as withdrawn here. The school&apos;s server checks its copy on
            its own machine, so it keeps running on this licence until the licence expires.
            {current && ' To move them sooner, issue a shorter one they will install.'}
          </p>

          <div className="mt-5">
            <label htmlFor={`reason-${licenceId}`} className="label">
              Why it is being withdrawn
            </label>
            <input
              id={`reason-${licenceId}`}
              name="reason"
              required
              minLength={4}
              autoFocus
              placeholder="Refunded, issued in error, replaced by agreement…"
              className="field"
            />
            <span className="hint">Kept with the licence, for whoever reads this next year.</span>
          </div>

          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}

          <div className="mt-6 flex items-center justify-end gap-3">
            <button type="button" onClick={() => setOpen(false)} className="btn btn-quiet">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="btn btn-primary">
              {pending ? 'Withdrawing…' : 'Withdraw licence'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
