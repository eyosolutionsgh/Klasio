'use client';

import { useRouter } from 'next/navigation';
import { listHref, one, type ListSearchParams } from '@/lib/list';
import { CalendarIcon } from './icons';

/**
 * A from/to date window for a list.
 *
 * Applies on change rather than behind an "Apply" button. Picking one end of a range is a
 * meaningful query on its own — "everything since term began", "everything up to the audit date" —
 * so waiting for both ends before doing anything would leave the control feeling broken half the
 * time. The API treats a missing end as open, and widens `to` to the end of that day.
 *
 * `max`/`min` cross-constrain the two inputs so the picker itself refuses an inverted range,
 * rather than the list coming back empty and leaving the reader to work out why.
 */
export default function DateRangeFilter({
  base,
  params,
  label = 'Date range',
  fromLabel = 'From',
  toLabel = 'To',
}: {
  base: string;
  params: ListSearchParams;
  label?: string;
  fromLabel?: string;
  toLabel?: string;
}) {
  const router = useRouter();
  const from = one(params.from) ?? '';
  const to = one(params.to) ?? '';

  const field =
    'rounded-lg border border-mist bg-white pl-9 pr-2.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 w-full';

  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-[11px] uppercase tracking-widest text-oat">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:flex-none">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-oat/70">
            <CalendarIcon />
          </span>
          <input
            type="date"
            value={from}
            max={to || undefined}
            aria-label={fromLabel}
            onChange={(e) => router.push(listHref(base, params, { from: e.target.value }))}
            className={field}
          />
        </div>
        <span className="text-sm text-oat" aria-hidden>
          –
        </span>
        <div className="relative min-w-0 flex-1 sm:flex-none">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-oat/70">
            <CalendarIcon />
          </span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            aria-label={toLabel}
            onChange={(e) => router.push(listHref(base, params, { to: e.target.value }))}
            className={field}
          />
        </div>
        {(from || to) && (
          <button
            type="button"
            onClick={() => router.push(listHref(base, params, { from: undefined, to: undefined }))}
            className="rounded-lg border border-mist px-2.5 py-2 text-sm text-oat transition hover:border-brand/40 hover:text-brand"
          >
            Clear
          </button>
        )}
      </div>
    </fieldset>
  );
}
