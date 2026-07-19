'use client';

import { useActionState } from 'react';
import { addClient } from '@/lib/actions';

/**
 * Adding a client is mostly about getting the slug right.
 *
 * It is what the licence binds to, so a mismatch produces a licence the school cannot install —
 * and they find out, not us. Hence the warning rather than a helpful auto-generated slug: this
 * field has to be copied from the school's own server, not invented here.
 */
export default function NewClient() {
  const [error, action, pending] = useActionState(addClient, null);

  return (
    <section className="card mt-6 p-6 max-w-xl">
      <h2 className="text-base font-medium">Add a client</h2>
      <form action={action} className="mt-4 grid sm:grid-cols-2 gap-4 text-sm">
        <label className="block">
          <span className="text-oat">School name</span>
          <input
            name="name"
            required
            className="mt-1 w-full rounded border border-mist px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-oat">Slug</span>
          <input
            name="slug"
            required
            placeholder="kwahu-ridge-academy"
            className="mt-1 w-full rounded border border-mist px-3 py-2 font-mono"
          />
          <span className="block text-xs text-oat mt-1">
            Must match the school&apos;s own server exactly — a licence bound to the wrong slug will
            not install.
          </span>
        </label>
        <label className="block">
          <span className="text-oat">Contact name</span>
          <input name="contactName" className="mt-1 w-full rounded border border-mist px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-oat">Contact email</span>
          <input
            name="contactEmail"
            type="email"
            className="mt-1 w-full rounded border border-mist px-3 py-2"
          />
        </label>

        {error && (
          <p role="alert" className="sm:col-span-2 text-danger">
            {error}
          </p>
        )}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-navy text-paper px-4 py-2 font-medium disabled:opacity-60"
          >
            {pending ? 'Adding…' : 'Add client'}
          </button>
        </div>
      </form>
    </section>
  );
}
