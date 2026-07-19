'use client';

import { useActionState } from 'react';
import type { LicenceTier } from '@eyo/shared';
import { issue } from '@/lib/actions';

/**
 * Issuing a renewal, in a browser.
 *
 * Defaults to whatever the school is on now and twelve months, because that is what a renewal
 * almost always is — the form should take one click for the common case and still allow the
 * unusual one.
 */
export default function IssueForm({
  clientId,
  currentTier,
}: {
  clientId: string;
  currentTier: LicenceTier;
}) {
  const [error, action, pending] = useActionState(issue, null);

  return (
    <section className="card mt-6 p-6">
      <h2 className="text-base font-medium">Issue a licence</h2>
      <p className="text-sm text-oat mt-1">
        Signed here and recorded against this client. Whatever is issued replaces the current one in
        our records — the school starts using it when they install it.
      </p>

      <form action={action} className="mt-4 grid sm:grid-cols-4 gap-4 text-sm items-end">
        <input type="hidden" name="clientId" value={clientId} />

        <label className="block">
          <span className="text-oat">Package</span>
          <select
            name="tier"
            defaultValue={currentTier}
            className="mt-1 w-full rounded border border-mist px-3 py-2 bg-white"
          >
            <option value="BASIC">BASIC</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="ADVANCED">ADVANCED</option>
          </select>
        </label>

        <label className="block">
          <span className="text-oat">Months</span>
          <input
            name="months"
            type="number"
            min={1}
            max={60}
            defaultValue={12}
            className="mt-1 w-full rounded border border-mist px-3 py-2"
          />
        </label>

        <label className="block">
          <span className="text-oat">Student cap</span>
          <input
            name="studentCap"
            placeholder="package default"
            className="mt-1 w-full rounded border border-mist px-3 py-2"
          />
          {/* Blank and "unlimited" mean different things, and the difference matters. */}
          <span className="block text-xs text-oat mt-1">blank, a number, or “unlimited”</span>
        </label>

        <label className="block">
          <span className="text-oat">Grace days</span>
          <input
            name="graceDays"
            type="number"
            min={0}
            max={365}
            defaultValue={30}
            className="mt-1 w-full rounded border border-mist px-3 py-2"
          />
        </label>

        <label className="block sm:col-span-3">
          <span className="text-oat">Extra entitlements</span>
          <input
            name="extras"
            placeholder="ai.remarks, exams.cbt"
            className="mt-1 w-full rounded border border-mist px-3 py-2 font-mono"
          />
          <span className="block text-xs text-oat mt-1">
            Sells one feature from a higher package without moving the school onto it.
          </span>
        </label>

        <div className="sm:col-span-1">
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded bg-navy text-paper px-4 py-2 font-medium disabled:opacity-60"
          >
            {pending ? 'Signing…' : 'Issue'}
          </button>
        </div>

        {error && (
          <p role="alert" className="sm:col-span-4 text-danger">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
