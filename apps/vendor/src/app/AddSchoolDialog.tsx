'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { addClient } from '@/lib/actions';

/**
 * Adding a school, from a dialog rather than a panel under the table.
 *
 * As a panel it sat below every row, so the more schools a supplier had the further they scrolled
 * to add one — the list growing made the most common write harder, which is backwards. In a dialog
 * it is one click from the top of the page whatever the list is doing.
 *
 * Getting the slug right is most of the job. It is what a licence binds to, so a mismatch produces
 * a licence the school cannot install and they are the ones who find out. Hence a warning rather
 * than a helpfully auto-generated slug: this is copied from the school's own server, never
 * invented here.
 */
export default function AddSchoolDialog() {
  const [error, action, pending] = useActionState(addClient, null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // `showModal` rather than an `open` attribute: it brings focus trapping, Escape, inert
    // background and the top layer with it, which is a lot to reimplement by hand.
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  /*
    A successful submit clears the error and revalidates the page, so the dialog closes on the
    transition from "submitting" to "no error". A form that stayed open after succeeding would look
    like it had failed silently.
  */
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
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary shrink-0">
        Add school
      </button>

      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        aria-labelledby="add-school-title"
        className="modal backdrop:bg-ink/40 rounded-xl p-0 w-[min(34rem,92vw)] border border-mist shadow-2xl"
      >
        <form action={action} className="p-6">
          <h2 id="add-school-title" className="text-base font-semibold">
            Add a school
          </h2>
          <p className="text-sm text-slate mt-1">
            Using a slug that is already reporting claims its history too.
          </p>

          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-4 items-start mt-5">
            <div>
              <label htmlFor="name" className="label">
                School name
              </label>
              <input id="name" name="name" required autoFocus className="field" />
              <span className="hint" />
            </div>

            <div>
              <label htmlFor="slug" className="label">
                Slug
              </label>
              <input
                id="slug"
                name="slug"
                required
                placeholder="kwahu-ridge-academy"
                className="field font-mono"
              />
              <span className="hint">Copy it from the school’s own server, exactly.</span>
            </div>

            <div>
              <label htmlFor="contactName" className="label">
                Contact name
              </label>
              <input id="contactName" name="contactName" className="field" />
              <span className="hint" />
            </div>

            <div>
              <label htmlFor="contactEmail" className="label">
                Contact email
              </label>
              <input id="contactEmail" name="contactEmail" type="email" className="field" />
              <span className="hint" />
            </div>
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
              {pending ? 'Adding…' : 'Add school'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
