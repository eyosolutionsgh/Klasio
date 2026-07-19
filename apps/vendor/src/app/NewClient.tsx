'use client';

import { useActionState } from 'react';
import { addClient } from '@/lib/actions';

/**
 * Adding a school comes down to getting the slug right.
 *
 * It is what a licence binds to, so a mismatch produces a licence the school cannot install — and
 * they are the ones who find out. Hence a warning rather than a helpfully auto-generated slug:
 * this field is copied from the school's own server, never invented here.
 */
export default function NewClient() {
  const [error, action, pending] = useActionState(addClient, null);

  return (
    <section className="card mt-5 p-6">
      <h2 className="text-base font-semibold">Add a school</h2>
      <p className="text-sm text-slate mt-1">
        Adding one with a slug already reporting claims its history too.
      </p>

      <form action={action} className="mt-5">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-4 items-start">
          <div>
            <label htmlFor="name" className="label">
              School name
            </label>
            <input id="name" name="name" required className="field" />
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
          <p role="alert" className="mt-4 text-sm text-danger">
            {error}
          </p>
        )}

        <button type="submit" disabled={pending} className="btn btn-primary mt-5">
          {pending ? 'Adding…' : 'Add school'}
        </button>
      </form>
    </section>
  );
}
