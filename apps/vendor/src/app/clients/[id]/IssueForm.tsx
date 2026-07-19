'use client';

import { useActionState, useState } from 'react';
import { ENTITLEMENT_CATALOGUE, includedIn, type LicenceTier } from '@eyo/shared';
import { issue } from '@/lib/actions';

const TIERS: LicenceTier[] = ['BASIC', 'MEDIUM', 'ADVANCED'];

/**
 * Issuing a renewal, in a browser.
 *
 * Defaults to the package the school is already on and twelve months, because that is what a
 * renewal almost always is: one click for the common case, with the unusual one still to hand.
 */
export default function IssueForm({
  clientId,
  currentTier,
}: {
  clientId: string;
  currentTier: LicenceTier;
}) {
  const [error, action, pending] = useActionState(issue, null);
  const [tier, setTier] = useState<LicenceTier>(currentTier);

  /*
    Only the features the chosen package leaves out.

    Ticking something the package already carries would be harmless and meaningless, so the list
    answers "what would this add?" rather than "what exists?" — which is the question someone
    building a quote is actually asking. It re-filters as the package changes.
  */
  const included = includedIn(tier);
  const extras = ENTITLEMENT_CATALOGUE.filter((e) => !included.has(e.code));

  return (
    <section className="card mt-5 p-6">
      <h2 className="text-base font-semibold">Issue a licence</h2>
      <p className="text-sm text-slate mt-1">
        Signed here and recorded against this school. It takes effect on their server once they
        install it.
      </p>

      <form action={action} className="mt-5">
        <input type="hidden" name="clientId" value={clientId} />

        {/* items-start, so every field sits on the same top edge whether or not it carries a hint. */}
        <div className="grid sm:grid-cols-4 gap-x-4 gap-y-4 items-start">
          <div>
            <label htmlFor="tier" className="label">
              Package
            </label>
            <select
              id="tier"
              name="tier"
              value={tier}
              onChange={(e) => setTier(e.target.value as LicenceTier)}
              className="field"
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span className="hint" />
          </div>

          <div>
            <label htmlFor="months" className="label">
              Months
            </label>
            <input
              id="months"
              name="months"
              type="number"
              min={1}
              max={60}
              defaultValue={12}
              className="field"
            />
            <span className="hint" />
          </div>

          <div>
            <label htmlFor="studentCap" className="label">
              Student cap
            </label>
            <input
              id="studentCap"
              name="studentCap"
              placeholder="package default"
              className="field"
            />
            {/* Blank and “unlimited” mean different things, so both are spelled out. */}
            <span className="hint">Blank for the package default, a number, or “unlimited”.</span>
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

        <fieldset className="mt-6 border-t border-mist pt-5">
          <legend className="sr-only">Extra features</legend>
          <p className="text-sm font-medium text-slate">Add features from a higher package</p>
          <p className="text-xs text-slate mt-1 mb-3">
            Sells a single feature while the school stays on {tier}. Everything {tier} already
            carries is theirs by default.
          </p>

          {extras.length === 0 ? (
            <p className="text-sm text-slate">{tier} carries every feature Klasio offers.</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
              {extras.map((e) => (
                <label
                  key={e.code}
                  className="flex items-start gap-2.5 text-sm py-1.5 cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    name="extras"
                    value={e.code}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[#002b5b]"
                  />
                  <span className="min-w-0">
                    <span className="block leading-snug group-hover:text-navy">{e.label}</span>
                    <span className="block text-[11px] text-oat font-mono truncate">{e.code}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

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
