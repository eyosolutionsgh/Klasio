'use client';

import { useActionState, useState } from 'react';
import { ENTITLEMENT_CATALOGUE } from '@eyo/shared';
import { issue } from '@/lib/actions';
import { DEFAULT_TERM, LICENCE_TERMS } from '@/lib/terms';

export interface SellablePackage {
  id: string;
  name: string;
  description: string | null;
  tier: string;
  entitlements: string[];
}

/**
 * Issuing a renewal, in a browser.
 *
 * Pick a package and see what is in it. This used to be a tier plus forty checkboxes, which asked
 * whoever was selling to reconstruct the product from memory every time — and to get it right
 * silently, for a school that would not find out until a feature was missing. Composing the
 * product is a separate job, done once, on the packages page.
 *
 * The feature list is shown rather than folded away: this is the last moment somebody can notice
 * they picked the wrong thing.
 */
export default function IssueForm({
  clientId,
  packages,
  currentPackageId,
  devKey = false,
}: {
  clientId: string;
  packages: SellablePackage[];
  /** What this school is on now, so a renewal is one click. */
  currentPackageId?: string | null;
  /** Signing with the committed development key — see `lib/vendor-key.ts`. */
  devKey?: boolean;
}) {
  const [error, action, pending] = useActionState(issue, null);
  const [packageId, setPackageId] = useState(
    currentPackageId && packages.some((p) => p.id === currentPackageId)
      ? currentPackageId
      : (packages[0]?.id ?? ''),
  );

  const chosen = packages.find((p) => p.id === packageId) ?? null;

  if (packages.length === 0) {
    return (
      <section className="card mt-5 p-6">
        <h2 className="text-base font-semibold">Issue a licence</h2>
        <p className="text-sm text-clay mt-2">
          Build a package first — a licence is a package sold to a school for a term.{' '}
          <a href="/packages" className="underline underline-offset-2">
            Packages
          </a>
        </p>
      </section>
    );
  }

  return (
    <section className="card mt-5 p-6">
      <h2 className="text-base font-semibold">Issue a licence</h2>
      <p className="text-sm text-slate mt-1">
        Signed here and recorded against this school. It takes effect on their server once they
        install it.
      </p>

      {/*
        Said before the form rather than after it. A licence signed with the development key
        verifies only on a server running from a checkout, so a real school would be sent something
        that refuses to install — and finding that out after clicking Issue wastes the customer's
        time as well as yours.
      */}
      {devKey && (
        <p className="mt-3 rounded-lg bg-clay/10 text-clay text-sm px-3 py-2">
          Signing with the development key. Licences issued here work on a development server and
          are refused by any school running a real one.
        </p>
      )}

      <form action={action} className="mt-5">
        <input type="hidden" name="clientId" value={clientId} />

        {/* items-start, so every field sits on the same top edge whether or not it carries a hint. */}
        <div className="grid sm:grid-cols-3 gap-x-4 gap-y-4 items-start">
          <div>
            <label htmlFor="packageId" className="label">
              Package
            </label>
            <select
              id="packageId"
              name="packageId"
              value={packageId}
              onChange={(e) => setPackageId(e.target.value)}
              className="field"
            >
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="hint">
              {chosen && chosen.id === currentPackageId ? 'What they are on now.' : ''}
            </span>
          </div>

          <div>
            <label htmlFor="term" className="label">
              Term
            </label>
            <select id="term" name="term" defaultValue={DEFAULT_TERM} className="field">
              {LICENCE_TERMS.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
            {/* The four things with a price. A trial or a bridge comes from `licence:mint --days`. */}
            <span className="hint">Runs from today.</span>
          </div>

          <div>
            <label htmlFor="graceDays" className="label">
              Grace days
            </label>
            <input
              id="graceDays"
              name="graceDays"
              type="number"
              min={0}
              max={365}
              defaultValue={30}
              className="field"
            />
            <span className="hint">Still working after expiry.</span>
          </div>
        </div>

        {chosen && (
          <div className="mt-6 border-t border-mist pt-5">
            <p className="text-sm font-medium text-slate">
              {chosen.name} includes
              <span className="text-oat font-normal"> · {chosen.entitlements.length} features</span>
            </p>
            {chosen.description && <p className="text-xs text-slate mt-1">{chosen.description}</p>}

            {/*
              Read-only on purpose. Changing what a school gets means changing the product, on the
              packages page, where the change is deliberate and applies to everyone sold it next.
            */}
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {chosen.entitlements.map((code) => (
                <li
                  key={code}
                  title={code}
                  className="text-[11px] rounded-full bg-hush text-slate px-2 py-0.5"
                >
                  {ENTITLEMENT_CATALOGUE.find((e) => e.code === code)?.label ?? code}
                </li>
              ))}
            </ul>
            <p className="text-xs text-oat mt-2.5">
              Shown to the school as {chosen.tier}. To change what is included, edit the package.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-6 flex items-center gap-3 flex-wrap">
          <button type="submit" disabled={pending} className="btn btn-primary">
            {pending ? 'Signing…' : 'Issue licence'}
          </button>
          <span className="text-xs text-oat">Replaces the current licence in our records.</span>
        </div>
      </form>
    </section>
  );
}
