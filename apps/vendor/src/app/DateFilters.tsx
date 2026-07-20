'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { DateRange } from '@/lib/list';

/**
 * Two date ranges, tucked behind a summary until someone wants them.
 *
 * They answer different questions and both are worth having — expiry is the renewals list, issue
 * date is what was sold in a period — but four date inputs permanently across the top would make
 * the common case (find one school, glance at who needs a call) read as the complicated one. So
 * they collapse, and the summary says whether anything is set, because a filter you cannot see is
 * how a list ends up lying to you.
 */
export default function DateFilters({ expiry, issued }: { expiry: DateRange; issued: DateRange }) {
  const router = useRouter();
  const search = useSearchParams();

  const active = [expiry.from, expiry.to, issued.from, issued.to].filter(Boolean).length;

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(search.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // Any change to what is being filtered invalidates the page you were on.
    next.delete('page');
    const qs = next.toString();
    router.replace(qs ? `/?${qs}` : '/', { scroll: false });
  };

  const clear = () => {
    const next = new URLSearchParams(search.toString());
    for (const key of ['expFrom', 'expTo', 'issFrom', 'issTo', 'page']) next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `/?${qs}` : '/', { scroll: false });
  };

  return (
    /* Relative + absolute panel: in flow it widened the row and squeezed the search box next to
       it every time someone opened it. */
    <details className="group relative" open={active > 0}>
      <summary className="chip border border-mist text-slate hover:bg-hush cursor-pointer list-none select-none">
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M7 11h2v2H7zm0 4h2v2H7zm4-4h2v2h-2zm0 4h2v2h-2zm4-4h2v2h-2zm0 4h2v2h-2z" />
          <path d="M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm0 16H5V9h14z" />
        </svg>
        Dates
        {active > 0 && (
          <span className="rounded-full bg-navy text-white text-[11px] px-1.5 tabular-nums">
            {active}
          </span>
        )}
      </summary>

      <div className="card absolute right-0 z-20 mt-2 p-4 grid sm:grid-cols-2 gap-x-6 gap-y-4 w-[min(34rem,92vw)] shadow-lg">
        <Range
          legend="Expiring between"
          hint="Who to ring this month."
          from={{ name: 'expFrom', value: expiry.from }}
          to={{ name: 'expTo', value: expiry.to }}
          onChange={set}
        />
        <Range
          legend="Issued between"
          hint="What was sold in a period."
          from={{ name: 'issFrom', value: issued.from }}
          to={{ name: 'issTo', value: issued.to }}
          onChange={set}
        />

        {active > 0 && (
          <div className="sm:col-span-2 flex justify-end">
            <button type="button" onClick={clear} className="text-xs text-navy underline">
              Clear dates
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

function Range({
  legend,
  hint,
  from,
  to,
  onChange,
}: {
  legend: string;
  hint: string;
  from: { name: string; value?: string };
  to: { name: string; value?: string };
  onChange: (key: string, value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className="flex items-center gap-2">
        <input
          type="date"
          aria-label={`${legend}, from`}
          name={from.name}
          value={from.value ?? ''}
          onChange={(e) => onChange(from.name, e.target.value)}
          className="field"
        />
        <span className="text-oat text-sm">to</span>
        <input
          type="date"
          aria-label={`${legend}, to`}
          name={to.name}
          value={to.value ?? ''}
          onChange={(e) => onChange(to.name, e.target.value)}
          className="field"
        />
      </div>
      {/* Either end on its own is a valid question: "anything expiring before March" is one. */}
      <span className="hint">{hint} Either end alone works.</span>
    </fieldset>
  );
}
