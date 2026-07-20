'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import type { EntitlementSpec, LicenceTier } from '@eyo/shared';
import { savePackage } from '@/lib/actions';

const TIERS: LicenceTier[] = ['BASIC', 'MEDIUM', 'ADVANCED'];

interface Existing {
  id: string;
  name: string;
  description: string;
  tier: LicenceTier;
  entitlements: string[];
  archived: boolean;
}

/**
 * Build a package, or change one.
 *
 * The feature list is grouped by the tier each feature normally ships with, because that is the
 * only ordering that means anything to someone pricing a product — it shows what a package is
 * reaching up for. It is presentation only: ticking a Medium feature into a package labelled Basic
 * is exactly the freedom packages exist to give.
 */
export default function PackageEditor({
  catalogue,
  existing,
}: {
  catalogue: EntitlementSpec[];
  existing?: Existing;
}) {
  const [error, action, pending] = useActionState(savePackage, null);
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState<LicenceTier>(existing?.tier ?? 'MEDIUM');
  const [picked, setPicked] = useState<Set<string>>(new Set(existing?.entitlements ?? []));
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

  const toggle = (code: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  /** Everything a tier normally ships with, so a whole tier can be taken as a starting point. */
  const takeTier = (t: LicenceTier) => {
    const rank: Record<LicenceTier, number> = { BASIC: 0, MEDIUM: 1, ADVANCED: 2 };
    setPicked(new Set(catalogue.filter((e) => rank[e.tier] <= rank[t]).map((e) => e.code)));
  };

  const grouped = TIERS.map((t) => ({ tier: t, items: catalogue.filter((e) => e.tier === t) }));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={existing ? 'btn btn-quiet h-9 px-3 shrink-0' : 'btn btn-primary shrink-0'}
      >
        {existing ? 'Edit' : 'New package'}
      </button>

      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        aria-labelledby="package-title"
        className="modal backdrop:bg-ink/40 rounded-xl p-0 w-[min(46rem,94vw)] border border-mist shadow-2xl"
      >
        <form action={action} className="p-6 max-h-[85vh] overflow-y-auto">
          {existing && <input type="hidden" name="id" value={existing.id} />}

          <h2 id="package-title" className="text-base font-semibold">
            {existing ? `Edit ${existing.name}` : 'New package'}
          </h2>
          <p className="text-sm text-slate mt-1">
            Editing leaves every licence already issued exactly as it was sold.
          </p>

          <div className="grid sm:grid-cols-3 gap-x-4 gap-y-4 items-start mt-5">
            <div className="sm:col-span-2">
              <label htmlFor="pkg-name" className="label">
                Name
              </label>
              <input
                id="pkg-name"
                name="name"
                required
                defaultValue={existing?.name}
                autoFocus
                className="field"
              />
              <span className="hint">What a school sees on its invoice.</span>
            </div>

            <div>
              <label htmlFor="pkg-tier" className="label">
                Shown to the school as
              </label>
              <select
                id="pkg-tier"
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
              {/* A label, never a rule: what a school can do comes from the ticks below. */}
              <span className="hint">A word on their screens only.</span>
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="pkg-desc" className="label">
                Description
              </label>
              <input
                id="pkg-desc"
                name="description"
                defaultValue={existing?.description}
                placeholder="Who this is for, in a line"
                className="field"
              />
              <span className="hint" />
            </div>
          </div>

          <fieldset className="mt-5 border-t border-mist pt-5">
            <legend className="sr-only">Features</legend>
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <p className="text-sm font-medium text-slate">
                Features
                <span className="text-oat font-normal"> · {picked.size} chosen</span>
              </p>
              {/* A starting point, not a constraint — every tick stays editable afterwards. */}
              <p className="text-xs text-oat">
                Start from{' '}
                {TIERS.map((t, i) => (
                  <span key={t}>
                    {i > 0 && ' · '}
                    <button
                      type="button"
                      onClick={() => takeTier(t)}
                      className="text-navy underline underline-offset-2"
                    >
                      {t}
                    </button>
                  </span>
                ))}
              </p>
            </div>

            {grouped.map((group) => (
              <div key={group.tier} className="mt-4">
                <p className="text-[11px] uppercase tracking-widest text-oat">
                  Normally {group.tier}
                </p>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1 mt-1.5">
                  {group.items.map((e) => (
                    <label
                      key={e.code}
                      className="flex items-start gap-2.5 text-sm py-1.5 cursor-pointer group"
                    >
                      <input
                        type="checkbox"
                        name="entitlements"
                        value={e.code}
                        checked={picked.has(e.code)}
                        onChange={() => toggle(e.code)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[#002b5b]"
                      />
                      <span className="min-w-0">
                        <span className="block leading-snug group-hover:text-navy">{e.label}</span>
                        <span className="block text-[11px] text-oat font-mono truncate">
                          {e.code}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>

          {error && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {error}
            </p>
          )}

          <div className="mt-6 flex items-center justify-end gap-3">
            <button type="button" onClick={() => setOpen(false)} className="btn btn-quiet">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="btn btn-primary">
              {pending ? 'Saving…' : existing ? 'Save package' : 'Create package'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
